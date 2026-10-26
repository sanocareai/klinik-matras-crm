import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang diuji hanya pratinjau (baca-saja) dan penolakan SEBELUM menyentuh data. Sidik jari data unit uji (stok, catatan sementara, komponen lama, koreksi, aktivitas) harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import("/app/src/constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (path, token, body = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penulis = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
if (!penulis) { rec("akun berizin pembetulan (unit:material_write) tersedia", false); process.exit(1); }
const tW = await tokenUntuk(penulis); const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const unitT = (await prisma.$queryRawUnsafe(`select id::text id, unit_code kode from units where status::text = 'DELIVERED' order by created_at desc limit 1`))[0];
const unitB = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'CANCELLED' order by created_at desc limit 1`))[0];
const unitA = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text not in ('DELIVERED','CANCELLED') order by created_at desc limit 1`))[0];
const bahan = (await prisma.$queryRawUnsafe(`select m.id::text id from materials m where m.active order by (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) desc limit 1`))[0];
if (!unitT || !bahan) { rec("unit terkirim dan bahan uji tersedia", false); process.exit(1); }
const sidik = async () => ({
  mov: await hitung("select count(*)::int n from stock_movements where unit_id = $1::uuid", unitT.id), sem: await hitung("select count(*)::int n from unit_provisional_usages where unit_id = $1::uuid", unitT.id),
  komp: await hitung("select count(*)::int n from unit_component_reuse_entries where unit_id = $1::uuid", unitT.id), kor: await hitung("select count(*)::int n from warehouse_corrections where doc_id = $1::uuid", unitT.id),
  akt: await hitung("select count(*)::int n from activity_events where entity_id = $1", unitT.id), catatan: await hitung("select count(*)::int n from unit_usage_notes where unit_id = $1::uuid", unitT.id),
});
const sebelum = await sidik();
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const PRA = (u) => `/api/production/units/${u}/pembetulan-bahan/pratinjau`;

rec("pratinjau pembetulan: tanpa token 401", (await post(PRA(unitT.id), null, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni })).status === 401);
if (tN) rec("pratinjau pembetulan: akun tanpa izin 403", (await post(PRA(unitT.id), tN, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni })).status === 403); else skip("akun tanpa izin 403", "tidak ada akun tanpa izin aktif (diuji di rehearsal)");
const p = await post(PRA(unitT.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
rec(`pratinjau unit terkirim ${unitT.kode}: 200, tegas 'PENGELUARAN STOK BARU', waktu pencatatan terpisah, struktur dampak lengkap`, p.status === 200 && p.json?.tindakan?.jenis === "PENGELUARAN_STOK_BARU" && p.json?.waktu?.dasarHargaDanJurnal === "WAKTU_PENCATATAN" && !!p.json?.finance?.hasil && !!p.json?.hppOperasional && Array.isArray(p.json?.sudahTercatat?.tertaut) && Array.isArray(p.json?.sudahTercatat?.kemungkinan) && typeof p.json?.boleh === "boolean", String(p.status));
for (const jenis of ["CATATAN_SEMENTARA", "KOMPONEN_LAMA"]) { const c = await post(PRA(unitT.id), tW, { jenis, tanggalPemakaian: hariIni }); rec(`pratinjau ${jenis}: hanya catatan (stok tidak berubah)`, c.status === 200 && c.json?.tindakan?.jenis === "CATATAN_SAJA" && c.json?.stok === null, String(c.status)); }
const tgl = await post(PRA(unitT.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1 }); rec("pratinjau tanpa tanggal pemakaian dilaporkan ditolak 400", tgl.status === 400 && tgl.json?.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
if (unitB) { const b = await post(PRA(unitB.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni }); rec("unit DIBATALKAN ditolak 409 (tidak diperluas)", b.status === 409 && b.json?.code === "UNIT_DIBATALKAN"); } else skip("unit dibatalkan ditolak", "tidak ada unit dibatalkan");
if (unitA) { const a = await post(PRA(unitA.id), tW, { materialId: bahan.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni }); rec("unit AKTIF ditolak 409 (hanya unit terkirim)", a.status === 409 && a.json?.code === "UNIT_BELUM_TERKIRIM"); } else skip("unit aktif ditolak", "tidak ada unit aktif");
// penegakan server pada POST (ditolak SEBELUM transaksi/penulisan; tanpa Idempotency-Key)
const m1 = await post(`/api/units/${unitT.id}/materials`, tW, { materialId: bahan.id, qty: 1 }); rec("POST pengeluaran pada unit terkirim TANPA alasan = 400 UNIT_ALASAN_PEMBETULAN_WAJIB (tidak menulis)", m1.status === 400 && m1.json?.code === "UNIT_ALASAN_PEMBETULAN_WAJIB");
const m2 = await post(`/api/units/${unitT.id}/materials`, tW, { materialId: bahan.id, qty: 1, alasanPembetulan: "smoke: uji penolakan" }); rec("POST tanpa tanggal pemakaian dilaporkan = 400 UNIT_TANGGAL_PEMAKAIAN_WAJIB (tidak menulis)", m2.status === 400 && m2.json?.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
const m3 = await post(`/api/units/${unitT.id}/materials`, tW, { materialId: bahan.id, qty: 1, alasanPembetulan: "smoke: uji penolakan", tanggalPemakaian: hariIni }); rec("POST tanpa saldo yang dilihat di pratinjau = 400 UNIT_PRATINJAU_WAJIB (transaksi dibatalkan, tidak menulis)", m3.status === 400 && m3.json?.code === "UNIT_PRATINJAU_WAJIB");
const s1 = await post(`/api/production/units/${unitT.id}/provisional-usages`, tW, { name: "Smoke tanpa alasan XQZ", qty: 1, uom: "KG" }); rec("pemakaian sementara pada unit terkirim tanpa alasan = ditolak 409 (UNIT_TIDAK_AKTIF)", s1.status === 409 && s1.json?.code === "UNIT_TIDAK_AKTIF");
const ad = await get(`/api/production/units/${unitT.id}/adopsi`, tW); const baris = ad.json?.pemakaianAktual?.baris ?? [];
if (ad.status === 200 && baris.length) rec("data order: riwayat pemakaian membawa kolom 'dilaporkan' (null untuk pencatatan biasa)", baris.every((b) => Object.hasOwn(b, "dilaporkan"))); else if (ad.status === 200) skip("kolom 'dilaporkan' pada riwayat", "unit uji belum punya pemakaian"); else rec("GET adopsi unit terkirim 200", false, String(ad.status));

const sesudah = await sidik(); const beda = Object.keys(sebelum).filter((k) => sebelum[k] !== sesudah[k]);
rec("TIDAK ada jejak tulis pada unit uji: pergerakan stok, catatan sementara, komponen lama, koreksi, catatan historis, aktivitas sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
