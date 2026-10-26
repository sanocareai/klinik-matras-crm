import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang diuji hanya pratinjau (baca-saja) dan penolakan SEBELUM menyentuh data (tanpa Idempotency-Key tulis yang sah). Sidik jari data unit uji harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import("/app/src/constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (path, token, body = {}, hdr = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const penulis = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u; const owner = info.find((x) => x.rs.has("OWNER"))?.u;
if (!penulis) { rec("akun berizin (unit:material_write) tersedia", false); process.exit(1); }
const tW = await tokenUntuk(penulis); const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null; const tO = owner ? await tokenUntuk(owner) : null;
// unit terkirim + bahan dengan pemakaian bersih > 0 yang BUKAN dari Material Issue dan tanpa WASTE; serta unit terkirim + bahan dari Material Issue
const langsung = (await prisma.$queryRawUnsafe(`select s.unit_id::text uid, s.material_id::text mid, u.unit_code kode, u.created_at dibuat from stock_movements s join units u on u.id = s.unit_id where u.status::text = 'DELIVERED' and s.type::text = 'ISSUE' and s.material_issue_id is null
    and not exists (select 1 from stock_movements x where x.unit_id = s.unit_id and x.material_id = s.material_id and (x.material_issue_id is not null or x.type::text = 'WASTE'))
    group by s.unit_id, s.material_id, u.unit_code, u.created_at having -sum(s.qty) > 0.5 order by u.created_at desc limit 1`))[0];
const dariMI = (await prisma.$queryRawUnsafe(`select s.unit_id::text uid, s.material_id::text mid, u.unit_code kode, u.created_at dibuat from stock_movements s join units u on u.id = s.unit_id where u.status::text = 'DELIVERED' and s.type::text = 'ISSUE' and s.material_issue_id is not null
    and not exists (select 1 from stock_movements x where x.unit_id = s.unit_id and x.material_id = s.material_id and x.type::text = 'WASTE') group by s.unit_id, s.material_id, u.unit_code, u.created_at having -sum(s.qty) > 0.5 order by u.created_at desc limit 1`))[0];
const unitB = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'CANCELLED' order by created_at desc limit 1`))[0];
const sidik = async (uid) => ({
  mov: await hitung("select count(*)::int n from stock_movements where unit_id = $1::uuid", uid), hpp: await hitung("select count(*)::int n from stock_movement_biaya_operasional b join stock_movements s on s.id = b.movement_id where s.unit_id = $1::uuid", uid),
  kor: await hitung("select count(*)::int n from warehouse_corrections where doc_id = $1::uuid", uid), akt: await hitung("select count(*)::int n from activity_events where entity_id = $1", uid), cmd: await hitung("select count(*)::int n from v2_commands where aggregate_id = $1", uid),
});
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const PRA = (u) => `/api/production/units/${u}/perubahan-pemakaian/pratinjau`; const PASANG = (u) => `/api/production/units/${u}/perubahan-pemakaian`;
if (!langsung) { rec("unit terkirim dengan pemakaian langsung (bukan Material Issue) tersedia untuk uji pratinjau", false); process.exit(1); }
const s0 = await sidik(langsung.uid); const sM0 = dariMI ? await sidik(dariMI.uid) : null;
const T = wib(langsung.dibuat) > hariIni ? hariIni : wib(langsung.dibuat);

rec("pratinjau perubahan: tanpa token 401", (await post(PRA(langsung.uid), null, { materialId: langsung.mid, qtyBaru: 0, tanggalPemakaian: T })).status === 401);
if (tN) rec("pratinjau perubahan: akun tanpa izin 403", (await post(PRA(langsung.uid), tN, { materialId: langsung.mid, qtyBaru: 0, tanggalPemakaian: T })).status === 403); else skip("akun tanpa izin 403", "tidak ada akun tanpa izin aktif (diuji di rehearsal)");
const p = await post(PRA(langsung.uid), tW, { materialId: langsung.mid, qtyBaru: 0, tanggalPemakaian: T });
rec(`pratinjau ubah jumlah (unit terkirim ${langsung.kode}): 200, jalur LANGSUNG, langkah pengembalian dengan dasar harga ISSUE asal, saldo + sidik harga tersedia, baca-saja`, p.status === 200 && p.json?.jalur === "LANGSUNG" && p.json?.langkah?.[0]?.jenis === "RETURN" && p.json?.langkah?.[0]?.hppOperasional?.basis === "HARGA_ISSUE_ASAL" && typeof p.json?.langkah?.[0]?.hppOperasional?.sidik === "string" && p.json?.sidik?.legs?.length === 1 && p.json?.alasanWajib === true, String(p.status));
const tgl = await post(PRA(langsung.uid), tW, { materialId: langsung.mid, qtyBaru: 0 }); rec("pratinjau unit terkirim tanpa tanggal pemakaian dilaporkan ditolak 400", tgl.status === 400 && tgl.json?.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
if (dariMI) { const pm = await post(PRA(dariMI.uid), tW, { materialId: dariMI.mid, qtyBaru: 0, tanggalPemakaian: wib(dariMI.dibuat) > hariIni ? hariIni : wib(dariMI.dibuat) }); rec(`bahan asal Material Issue (unit terkirim ${dariMI.kode}): pratinjau = jalur AJUKAN (persetujuan), bukan langsung`, pm.status === 200 && pm.json?.jalur === "AJUKAN" && pm.json?.dari?.dokumenGudang === true, `${pm.status} ${pm.json?.jalur}`); } else skip("bahan asal Material Issue = AJUKAN", "tidak ada unit terkirim dengan pengeluaran Material Issue (diuji di rehearsal)");
if (unitB) { const b = await post(PRA(unitB.id), tW, { materialId: langsung.mid, qtyBaru: 0 }); rec("unit DIBATALKAN ditolak 409", b.status === 409 && b.json?.code === "UNIT_DIBATALKAN"); } else skip("unit dibatalkan ditolak", "tidak ada unit dibatalkan");
// penegakan server pada POST (ditolak SEBELUM transaksi/penulisan): kunci, alasan, pratinjau
const base = { materialId: langsung.mid, qtyBaru: 0, tanggalPemakaian: T };
rec("POST tanpa Idempotency-Key = 400 IDEMPOTENCY_KEY_INVALID (tidak menulis)", (await post(PASANG(langsung.uid), tW, { ...base, alasan: "smoke: uji penolakan", dilihat: p.json?.sidik })).json?.code === "IDEMPOTENCY_KEY_INVALID");
const kS = "smoke-ubah-tidak-menulis-0001"; rec("POST tanpa alasan = 400 UNIT_ALASAN_PEMBETULAN_WAJIB (tidak menulis)", (await post(PASANG(langsung.uid), tW, { ...base, dilihat: p.json?.sidik }, { "Idempotency-Key": kS })).json?.code === "UNIT_ALASAN_PEMBETULAN_WAJIB");
rec("POST tanpa hasil pratinjau (dilihat) = 400 UNIT_PRATINJAU_WAJIB (tidak menulis)", (await post(PASANG(langsung.uid), tW, { ...base, alasan: "smoke: uji penolakan" }, { "Idempotency-Key": kS })).json?.code === "UNIT_PRATINJAU_WAJIB");
if (tN) rec("POST akun tanpa izin = 403 (tidak menulis)", (await post(PASANG(langsung.uid), tN, { ...base, alasan: "smoke: uji penolakan", dilihat: p.json?.sidik }, { "Idempotency-Key": kS })).status === 403);
// Koreksi Saldo yang sudah live tetap utuh (baca-saja)
if (tO) { const KS = "/api/inventory/adjustments/koreksi-saldo"; const ks = await get(`${KS}/bahan/${langsung.mid}`, tO); rec("Koreksi Saldo utuh: keadaan bahan 200 dengan keadaan saldo valid dan riwayat (array)", ks.status === 200 && ["BELUM_ADA_CATATAN", "NOL_MENURUT_PERGERAKAN", "NOL_TERVERIFIKASI", "POSITIF", "MINUS"].includes(ks.json?.keadaanSaldo) && Array.isArray(ks.json?.riwayat), `${ks.status} ${ks.json?.keadaanSaldo}`); } else skip("Koreksi Saldo utuh", "tidak ada akun Owner aktif");
rec("Koreksi Saldo utuh: tabel konteks dan migrasi terpasang", (await hitung("select count(*)::int n from _prisma_migrations where migration_name like '%koreksi_saldo%' and finished_at is not null")) >= 1 && (await hitung("select count(*)::int n from koreksi_saldo_bahan")) >= 0);

const s1 = await sidik(langsung.uid); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const sM1 = dariMI ? await sidik(dariMI.uid) : null; const bedaM = dariMI ? Object.keys(sM0).filter((k) => sM0[k] !== sM1[k]) : [];
rec("TIDAK ada jejak tulis pada unit uji: pergerakan stok, HPP beku, koreksi, aktivitas, perintah idempotensi sama persis sebelum vs sesudah smoke", beda.length === 0 && bedaM.length === 0, [...beda, ...bedaM].join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
