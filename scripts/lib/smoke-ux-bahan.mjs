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
const D = await import("/app/src/lib/domain/productionWorkStatus.js");
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const BERIZIN = new Set(["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
async function userDengan(role, tanpa) {
  for (const u of await prisma.user.findMany({ where: { active: true } })) { const rs = await rolesDari(u); if (rs.has(role) && ![...rs].some((r) => tanpa.has(r))) return u; }
  return null;
}
const adm = (await userDengan("ADMIN", new Set())) ?? (await userDengan("OWNER", new Set()));
const sales = await userDengan("SALES", BERIZIN);
if (!adm) { rec("akun ADMIN tersedia", false); process.exit(1); }
const tA = await tokenUntuk(adm); const tS = sales ? await tokenUntuk(sales) : null;
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const B = (k) => Number(process.env[k]);
const get = async (path, token) => { const r = await fetch(BASE + path, { headers: token ? { Authorization: "Bearer " + token } : {} }); let j = null; try { j = await r.clone().json(); } catch { /* bukan JSON */ } return { status: r.status, json: j, res: r }; };
const post = (path, token) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: "{}" });
const TABEL = ["stock_movements", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "materials", "units", "production_runs_v2", "production_run_plans_v2", "qc_fit_tests", "production_unit_schedules", "production_unit_work_progress", "unit_component_reuse_entries", "material_proposals", "unit_provisional_usages"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const sebelum = await fp();

// kode yang berjalan = kode kandidat
rec("kode berjalan: sumber status kerja PEMAKAIAN_SEMENTARA tersedia", D.WORK_SOURCE.PEMAKAIAN_SEMENTARA === "PEMAKAIAN_SEMENTARA" && /perlu rekonsiliasi Gudang/.test(D.WORK_SOURCE_LABEL.PEMAKAIAN_SEMENTARA));
// tabel rilis terpasang dan KOSONG
rec("2 tabel rilis ada dan kosong (tidak ada yang membuat data saat rilis)", (await hitung("select (select count(*) from material_proposals) + (select count(*) from unit_provisional_usages) as n")) === 0);

// izin: ditolak SEBELUM menyentuh data
const ID0 = "00000000-0000-4000-8000-000000000000";
rec("usul bahan: tanpa token 401", (await post("/api/production/material-proposals", null)).status === 401);
rec("catat pemakaian sementara: tanpa token 401", (await post(`/api/production/units/${ID0}/provisional-usages`, null)).status === 401);
rec("keputusan usulan: tanpa token 401", (await post(`/api/production/material-proposals/${ID0}/decision`, null)).status === 401);
rec("rekonsiliasi: tanpa token 401", (await post(`/api/production/provisional-usages/${ID0}/reconcile`, null)).status === 401);
if (tS) {
  rec("usul bahan: SALES (hanya-lihat) 403", (await post("/api/production/material-proposals", tS)).status === 403);
  rec("catat pemakaian sementara: SALES 403", (await post(`/api/production/units/${ID0}/provisional-usages`, tS)).status === 403);
  rec("keputusan usulan: SALES 403", (await post(`/api/production/material-proposals/${ID0}/decision`, tS)).status === 403);
  rec("antrean usulan: SALES 403", (await get("/api/production/material-proposals", tS)).status === 403);
} else skip("izin SALES 403 (usul/catat/keputusan/antrean)", "tidak ada akun SALES murni aktif (diuji di tes integrasi)");

// baca-saja: antrean, cek kembar, katalog, panel unit, ekspor
const aU = await get("/api/production/material-proposals", tA); const aS = await get("/api/production/provisional-usages", tA);
rec("antrean usulan (Admin) 200 dan kosong", aU.status === 200 && (aU.json?.rows ?? []).length === 0, String(aU.status));
rec("antrean pemakaian sementara (Admin) 200 dan kosong", aS.status === 200 && (aS.json?.rows ?? []).length === 0, String(aS.status));
const kembar = await get("/api/production/material-duplicates?name=busa", tA);
rec("cek duplikasi nama (baca-saja) 200", kembar.status === 200 && Array.isArray(kembar.json?.kandidat), String(kembar.status));
const kat = await get("/api/production/material-catalog?limit=5", tA);
rec("katalog bahan 200 (kategori tetap)", kat.status === 200 && Array.isArray(kat.json?.kelompok), String(kat.status));
const unit = await prisma.unit.findFirst({ where: { status: { in: ["RECEIVED", "IN_PRODUCTION"] } }, select: { id: true, unitCode: true }, orderBy: { createdAt: "desc" } });
if (!unit) skip("panel unit memuat pemakaianSementara + izin", "tidak ada unit aktif saat ini (diuji di rehearsal salinan dan tes integrasi)");
else {
  const a1 = await get(`/api/production/units/${unit.id}/adopsi`, tA); const a2 = await get(`/api/production/units/${unit.id}/adopsi`, tA);
  rec(`panel unit ${unit.unitCode} (Admin) 200: pemakaianSementara ada dan kosong; izin usul/catat/putuskan tersedia`, a1.status === 200 && Array.isArray(a1.json?.pemakaianSementara?.items) && a1.json.pemakaianSementara.items.length === 0 && a1.json.izin?.usulBahan === true && a1.json.izin?.catatPemakaianSementara === true, String(a1.status));
  rec("membuka panel dua kali identik (status kerja tidak berubah karena dibuka)", JSON.stringify(a1.json?.adopsi?.kerja) === JSON.stringify(a2.json?.adopsi?.kerja));
  if (tS) { const as = await get(`/api/production/units/${unit.id}/adopsi`, tS); rec("panel unit (SALES hanya-lihat) 200 dan izin catat/usul = false", as.status === 200 && as.json?.izin?.usulBahan === false && as.json?.izin?.catatPemakaianSementara === false && as.json?.izin?.putuskanUsulan === false); }
}
const ex = await get("/api/production/work-orders/export.xlsx?scope=semua", tA);
if (ex.status !== 200) rec("ekspor Excel Order Produksi 200", false, String(ex.status));
else { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.res.arrayBuffer())); rec("ekspor Excel memuat sheet 'Pemakaian Sementara' (kosong) dan sheet lama", wb.worksheets.map((s) => s.name).includes("Pemakaian Sementara") && wb.worksheets.map((s) => s.name).includes("Ringkasan Unit")); }

// tak ada jejak tulis: semua tabel (lama + baru) sama persis sebelum vs sesudah smoke
const sesudah = await fp(); const beda = TABEL.filter((t) => sebelum[t].n !== sesudah[t].n || sebelum[t].h !== sesudah[t].h);
rec("TIDAK ada jejak tulis: stok, Material Issue, penerimaan, jurnal, katalog bahan, Run, QC, jadwal, catatan kerja, komponen lama, usulan, dan pemakaian sementara sama persis sebelum vs sesudah smoke", beda.length === 0, beda.join(",") || "identik");
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
