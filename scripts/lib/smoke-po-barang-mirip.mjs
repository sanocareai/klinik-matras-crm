import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang dipakai hanya pratinjau cek-duplikat-po (baca-saja) dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, masukan tidak sah).
// Tidak ada PO dan tidak ada material percobaan yang dibuat. Jejak tulis (material, katalog supplier, asal SKU, PO, Harga Berlaku, stok, jurnal) dan isi material nyata harus identik sebelum vs sesudah.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const finAdmin = info.find((x) => bisa(x.rs, P.FINANCE_ADMIN))?.u; const bukanAdmin = info.find((x) => !bisa(x.rs, P.FINANCE_ADMIN))?.u;
if (!finAdmin) { rec("akun Finance Admin (finance:admin) tersedia", false); process.exit(1); }
const tA = await tokenUntuk(finAdmin); const tN = bukanAdmin ? await tokenUntuk(bukanAdmin) : null;
const jejak = async () => ({
  material: await hitung("select count(*)::int n from materials"), katalog: await hitung("select count(*)::int n from fin_supplier_materials"), asal: await hitung("select count(*)::int n from fin_material_sku_origins"),
  po: await hitung("select count(*)::int n from fin_purchase_orders"), poBaris: await hitung("select count(*)::int n from fin_purchase_order_lines"), harga: await hitung("select count(*)::int n from material_harga_berlaku"),
  stok: await hitung("select count(*)::int n from stock_movements"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"),
});
// isi LENGKAP semua material bahan baku (BUS-*): tidak boleh berubah apa pun (delapan BUS-008..015 ikut terjaga)
const sidikMaterial = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(m::text, '|' order by m.id::text)), '-') as n from materials m"))[0].n);
const s0 = await jejak(); const h0 = await sidikMaterial();
const PO = "/api/finance/purchase-orders"; const CEK_PO = `${PO}/sku/cek-duplikat-po`;
const sup = (await prisma.$queryRawUnsafe("select id::text id from fin_suppliers order by created_at asc limit 1"))[0]?.id;
if (!sup) { rec("ada supplier di katalog", false); process.exit(1); }
const mb = (nama) => ({ nama, kategori: "Busa", jenis: "BAHAN_PRODUKSI", spesifikasi: null, satuanBeli: "SHEET", satuanStok: "SHEET" });

// ── pratinjau baca-saja pada katalog NYATA
const nyata = await prisma.$queryRawUnsafe("select id::text id, code, name, unit from materials where active = true and code like 'BUS-%' and name ~ '[0-9]+ ?[xX×] ?[0-9]+' order by (code between 'BUS-008' and 'BUS-015') desc, code limit 8");
if (nyata.length >= 1) {
  const pv = await post(CEK_PO, tA, { supplierId: sup, barisBaru: nyata.map((m, i) => ({ baris: i + 1, materialBaru: { ...mb(m.name), satuanStok: m.unit, satuanBeli: m.unit } })) });
  rec(`cek-duplikat-po (${nyata.length} nama material NYATA): 200 dan setiap baris menunjuk kode materialnya sendiri sebagai SAMA (diblokir, diarahkan ke katalog)`, pv.status === 200 && pv.json?.bolehSimpan === false && (pv.json?.baris ?? []).length === nyata.length && pv.json.baris.every((r, i) => r.diblokir === true && (r.pasti ?? []).some((c) => c.materialId === nyata[i].id)), `${pv.status} ${JSON.stringify((pv.json?.baris ?? []).map((r) => r.pasti?.[0]?.kode))}`.slice(0, 220));
  const m = nyata[0]; const tebal = m.name.replace(/(\d+(?:[.,]\d+)?\s*[xX×]\s*\d+(?:[.,]\d+)?\s*[xX×]\s*)\d+(?:[.,]\d+)?/, (_, depan) => depan + "97");
  if (tebal !== m.name) {
    const pb = await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: { ...mb(tebal), satuanStok: m.unit, satuanBeli: m.unit } }] });
    rec(`varian dengan ketebalan jelas berbeda ("${tebal}") TIDAK diblokir dan TIDAK butuh konfirmasi/alasan; ditampilkan sebagai saran serupa`, pb.status === 200 && pb.json?.bolehSimpan === true && pb.json.baris[0].diblokir === false && pb.json.baris[0].perluKonfirmasi === false && pb.json.baris[0].pasti.length === 0, `${pb.status} ${JSON.stringify(pb.json?.baris?.[0] ?? {}).slice(0, 160)}`);
  } else skip("varian ketebalan berbeda dari nama nyata", "nama material nyata pertama tidak memuat ukuran tiga dimensi (PxLxT)");
} else skip("pratinjau pada material nyata BUS-*", "tidak ada material BUS-* beraturan ukuran di katalog");
const asing = await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: mb("ZZ UJI ASING 997X998X9 CM QQ") }, { baris: 2, materialBaru: mb("ZZ UJI ASING 997X998X9 cm qq") }] });
rec("dua baris yang sama setelah normalisasi pada form yang sama: baris ke-2 ditunjuk sebagai duplikat dalam PO (SATU baris diblokir, baris ke-1 tidak)", asing.status === 200 && asing.json?.bolehSimpan === false && asing.json.baris[0].diblokir === false && asing.json.baris[1].diblokir === true && asing.json.baris[1].dalamPO === true, `${asing.status}`);

// ── penolakan SEBELUM menulis
rec("cek-duplikat-po tanpa token = 401", (await post(CEK_PO, null, { supplierId: sup, barisBaru: [] })).status === 401);
rec("simpan PO tanpa token = 401 (tidak menulis)", (await post(PO, null, { supplierId: sup, lines: [] }, { "Idempotency-Key": "smoke-pbm-tidak-menulis-0001" })).status === 401);
if (tN) { rec("cek-duplikat-po akun non-Admin Finance = 403", (await post(CEK_PO, tN, { supplierId: sup, barisBaru: [] })).status === 403); rec("simpan PO dengan barang baru oleh non-Admin = 403 (tidak menulis)", (await post(PO, tN, { supplierId: sup, orderDate: "2026-10-29", lines: [{ materialBaru: mb("ZZ UJI ASING 997X998X9 CM QQ"), qty: 1, unitPrice: 1 }] }, { "Idempotency-Key": "smoke-pbm-tidak-menulis-0002" })).status === 403); } else skip("akun non-Admin Finance ditolak 403", "tidak ada akun non-Admin aktif (diuji di rehearsal)");
rec("cek-duplikat-po dengan nama kosong = 4xx (tidak menulis)", (await post(CEK_PO, tA, { supplierId: sup, barisBaru: [{ baris: 1, materialBaru: mb("") }] })).status >= 400);

const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const h1 = await sidikMaterial();
rec("TIDAK ada jejak tulis: material, katalog supplier, asal SKU, PO, baris PO, Harga Berlaku, stok, jurnal sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
rec("isi LENGKAP semua baris material (termasuk BUS-008..015) identik sebelum vs sesudah smoke (tidak dibuat ulang/diganti kode/digabung/dihapus)", h0 === h1, h0 === h1 ? "identik" : `${h0} → ${h1}`);
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
