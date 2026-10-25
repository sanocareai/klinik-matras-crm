import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const { ROLE_PERMISSIONS } = await import("/app/src/constants/permissions.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function userDengan(rolesAda, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if ([...rolesAda].some((r) => rs.has(r)) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
// ADMIN murni = punya ADMIN tetapi TIDAK punya FINANCE/OWNER; FINANCE/OWNER = pemegang izin harga berlaku; SALES murni = tanpa peran berizin
const adminMurni = await userDengan(["ADMIN"], new Set(["FINANCE", "OWNER"]));
const finOwner = (await userDengan(["OWNER"], new Set())) ?? (await userDengan(["FINANCE"], new Set()));
const gudang = await userDengan(["WAREHOUSE"], new Set(["ADMIN", "OWNER", "FINANCE"]));
const sales = await userDengan(["SALES"], new Set(["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "PRODUCTION_LEAD"]));
if (!finOwner) { rec("akun FINANCE/OWNER tersedia", false); process.exit(1); }
const tF = await tokenUntuk(finOwner); const tA = adminMurni ? await tokenUntuk(adminMurni) : null; const tG = gudang ? await tokenUntuk(gudang) : null; const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.clone().json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, res: r }; };
const post = async (path, token, body = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, json: j }; };
const TABEL = ["stock_movements", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "fin_stock_movement_valuation_corrections", "fin_inventory_openings", "fin_inventory_opening_lines", "materials", "units", "unit_usage_notes", "material_harga_berlaku", "stock_movement_biaya_operasional", "biaya_operasional_penerapan"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();

// kode yang berjalan = kode kandidat
rec("kode berjalan: izin eksplisit harga berlaku ada; ADMIN murni tidak memegangnya", (ROLE_PERMISSIONS.FINANCE ?? []).includes("finance:harga_berlaku:edit") && (ROLE_PERMISSIONS.OWNER ?? []).includes("finance:harga_berlaku:approve") && !(ROLE_PERMISSIONS.ADMIN ?? []).includes("finance:harga_berlaku:edit"));
rec("3 tabel rilis ada dan kosong (tidak ada yang mengisi harga saat rilis)", (await hitung("select (select count(*) from material_harga_berlaku) + (select count(*) from stock_movement_biaya_operasional) + (select count(*) from biaya_operasional_penerapan) as n")) === 0);
const mat = (await prisma.material.findFirst({ where: { code: "SPANBON-75GRAM" }, select: { id: true, unit: true } })) ?? (await prisma.material.findFirst({ where: { active: true }, select: { id: true, unit: true } }));
const R = "/api/finance/harga-berlaku"; const ID0 = "00000000-0000-4000-8000-000000000000";

// izin: ditolak SEBELUM menyentuh data
rec("ringkasan harga berlaku: tanpa token 401", (await get(`${R}/bahan/${mat.id}`, null)).status === 401);
rec("simpan harga: tanpa token 401", (await post(R, null)).status === 401);
rec("setujui penerapan: tanpa token 401", (await post(`${R}/penerapan/${ID0}/setujui`, null)).status === 401);
if (tS) rec("ringkasan harga berlaku: SALES 403 (tanpa finance:read)", (await get(`${R}/bahan/${mat.id}`, tS)).status === 403); else skip("SALES 403", "tidak ada akun SALES murni aktif (diuji di tes integrasi)");
if (tG) { rec("ringkasan harga berlaku: Gudang 403", (await get(`${R}/bahan/${mat.id}`, tG)).status === 403); rec("simpan harga: Gudang 403", (await post(R, tG)).status === 403); } else skip("Gudang 403", "tidak ada akun Gudang murni aktif (diuji di tes integrasi)");
if (tA) {
  const ra = await get(`${R}/bahan/${mat.id}`, tA);
  rec("ADMIN murni: ringkasan 200 tetapi hanya-lihat (bolehUbah=false, bolehSetujui=false) + teks izin eksplisit", ra.status === 200 && ra.json?.bolehUbah === false && ra.json?.bolehSetujui === false && /keputusan Owner/.test(ra.json?.izinTeks?.admin ?? ""), String(ra.status));
  rec("ADMIN murni: simpan harga 403 (tidak diperluas ke semua Admin tanpa keputusan Owner)", (await post(R, tA, { materialId: mat.id })).status === 403);
  rec("ADMIN murni: ajukan penerapan 403", (await post(`${R}/penerapan`, tA, { materialId: mat.id })).status === 403);
  rec("ADMIN murni: setujui penerapan 403", (await post(`${R}/penerapan/${ID0}/setujui`, tA, {})).status === 403);
} else skip("ADMIN murni hanya-lihat", "tidak ada akun ADMIN murni aktif (diuji di tes integrasi)");

// baca-saja untuk pemegang izin
const rf = await get(`${R}/bahan/${mat.id}`, tF);
rec("FINANCE/OWNER: ringkasan 200, kosong (belum ada harga), bolehUbah=true", rf.status === 200 && rf.json?.hargaBerlaku === null && rf.json?.bolehUbah === true && rf.json?.bolehSetujui === true && /bukan nilai buku dan bukan HPP final Finance/.test(rf.json?.labelHarga ?? ""), String(rf.status));
const rw = await get(`${R}/bahan/${mat.id}/riwayat`, tF); rec("riwayat 200 dan kosong", rw.status === 200 && (rw.json?.riwayat ?? []).length === 0);
const dasar = { materialId: mat.id, hargaBaru: "100", satuan: mat.unit, alasan: "smoke pratinjau (tidak disimpan)" };
const pm = await post(`${R}/pratinjau`, tF, { ...dasar, berlakuMulai: "2026-10-01T00:00:00Z" });
rec("pratinjau dengan tanggal MUNDUR ditolak 422 WAKTU_MUNDUR (tanpa menulis)", pm.status === 422 && pm.json?.code === "WAKTU_MUNDUR", `${pm.status} ${pm.json?.code}`);
const ps = await post(`${R}/pratinjau`, tF, dasar); rec("pratinjau 'saat disimpan' 200: label Belum didukung bukti, tanpa menulis", ps.status === 200 && ps.json?.saatDisimpan === true && ps.json?.labelBukti === "BELUM_DIDUKUNG_BUKTI");
const psat = await post(`${R}/pratinjau`, tF, { ...dasar, satuan: "PAK-UJI" }); rec("pratinjau satuan selain satuan stok ditolak (SATUAN_BEDA)", psat.status === 422 && psat.json?.code === "SATUAN_BEDA");
const unit = await prisma.unit.findFirst({ select: { id: true, unitCode: true }, orderBy: { createdAt: "desc" } });
if (!unit) skip("jejak unit memuat hppOperasional", "tidak ada unit");
else {
  const j = await get(`/api/units/${unit.id}/jejak-bahan`, tF); rec(`jejak bahan unit ${unit.unitCode} (Finance): hppOperasional ada, terpisah dari ringkasan Finance`, j.status === 200 && !!j.json?.hppOperasional && !!j.json?.ringkasan && /BUKAN nilai persediaan\/jurnal Finance/.test(j.json.hppOperasional.peringatan ?? ""), String(j.status));
  if (tG) { const jg = await get(`/api/units/${unit.id}/jejak-bahan`, tG); rec("jejak bahan unit (Gudang): tanpa angka operasional/harga", jg.status === 200 && jg.json?.hppOperasional === undefined); }
}
const ex = await fetch(BASE + "/api/finance/export/biaya-bahan", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tF }, body: JSON.stringify({ filter: {} }) });
if (ex.status !== 200) rec("ekspor Excel Biaya Bahan 200", false, String(ex.status));
else { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const nm = wb.worksheets.map((s) => s.name); rec("ekspor Excel memuat sheet 'HPP Operasional' TERPISAH + sheet Finance lama utuh", nm.includes("HPP Operasional") && nm.includes("Rincian Pergerakan") && nm.includes("Ringkasan per Unit")); }

// tak ada jejak tulis: semua tabel (lama + baru) sama persis sebelum vs sesudah smoke
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: stok, Material Issue, penerimaan, jurnal, valuasi/koreksi Finance, PSA, katalog, catatan pemakaian, dan 3 tabel rilis sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
