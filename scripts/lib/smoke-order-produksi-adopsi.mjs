// Smoke BACA-SAJA rilis "Order Produksi adopsi Admin" terhadap backend yang SUDAH melayani (container baru; atau server rehearsal bila SMOKE_BASE diisi). Tidak membuat status kerja, rencana bahan, pemakaian bahan, stok, jurnal, job, Run, atau QC.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, status/UUID/kunci tidak valid).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, body, headers = {}, mentah = false) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  if (mentah) return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const admin = cari((r) => r.includes("ADMIN") && punya(r, P.UNIT_READ) && punya(r, P.UNIT_ROUTING_WRITE) && punya(r, P.UNIT_MATERIAL_WRITE) && punya(r, P.ORDER_WRITE));
const hanyaLihat = cari((r) => punya(r, P.UNIT_READ) && !punya(r, P.UNIT_ROUTING_WRITE) && !punya(r, P.UNIT_MATERIAL_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.UNIT_READ));
if (!admin) { rec("akun ADMIN aktif dengan izin Produksi lengkap tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin);
const nol = "00000000-0000-4000-8000-000000000000";
const PR = "/api/production";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  sm: "select count(*)::int n from stock_movements", cmd: "select count(*)::int n from v2_commands", prog: "select count(*)::int n from production_unit_work_progress", plan: "select count(*)::int n from production_unit_material_plans",
  rev: "select count(*)::int n from production_unit_material_plan_revisions", job: "select count(*)::int n from jobs", run: "select count(*)::int n from production_runs_v2", qc: "select count(*)::int n from quality_inspections_v2", jur: "select count(*)::int n from fin_journal_entries", sesi: "select count(*)::int n from stock_counts", sesiBaris: "select count(*)::int n from stock_count_lines",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const nUnit = await hitung("select count(*)::int n from units");

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("panel unit tanpa token → 401", (await api("GET", `${PR}/units/${nol}/adopsi`, null)).status === 401);
rec("ekspor tanpa token → 401", (await api("GET", `${PR}/work-orders/export.xlsx`, null)).status === 401);
rec("catat status kerja tanpa token → 401", (await api("POST", `${PR}/units/${nol}/work-progress`, null, { status: "DIKERJAKAN" })).status === 401);
rec("simpan rencana bahan tanpa token → 401", (await api("PUT", `${PR}/units/${nol}/material-plan`, null, { lines: [] })).status === 401);
if (tanpaBaca) { const s = (await api("GET", `${PR}/work-orders`, tokenUntuk(tanpaBaca))).status; rec("daftar Order Produksi akun tanpa izin baca Unit → 403", s === 403, String(s)); } else skip("daftar 403", "tidak ada akun aktif tanpa izin baca Unit");
if (hanyaLihat) {
  const t = tokenUntuk(hanyaLihat);
  const a = (await api("POST", `${PR}/units/${nol}/work-progress`, t, { status: "DIKERJAKAN" })).status; rec("catat status kerja akun hanya-lihat → 403 (sebelum menyentuh data)", a === 403, String(a));
  const b = (await api("PUT", `${PR}/units/${nol}/material-plan`, t, { lines: [], expectedRevision: 0 })).status; rec("simpan rencana bahan akun hanya-lihat → 403", b === 403, String(b));
  const c = (await api("GET", `${PR}/work-orders`, t)).status; rec("akun hanya-lihat tetap bisa membaca daftar → 200", c === 200, String(c));
} else skip("akun hanya-lihat", "tidak ada akun aktif dengan izin baca tetapi tanpa izin tulis Unit");
const k1 = await api("POST", `${PR}/units/${nol}/work-progress`, tA, { status: "LIAR" });
rec("status kerja tidak valid → 400 (kamus dijaga; tidak menulis)", k1.status === 400 && k1.json?.code === "STATUS_KERJA_TIDAK_VALID", `${k1.status} ${k1.json?.code}`);
rec("UUID unit tidak valid → 400", (await api("POST", `${PR}/units/bukan-uuid/work-progress`, tA, { status: "DIKERJAKAN" })).status === 400);
rec("panel unit tidak ada → 404", (await api("GET", `${PR}/units/${nol}/adopsi`, tA)).status === 404);

// ── Baca: daftar tiga sumbu, panel unit nyata, katalog per kelompok, ekspor xlsx ──
const daftar = await api("GET", `${PR}/work-orders?pageSize=200`, tA);
const baris = daftar.json?.units ?? [];
rec("daftar Order Produksi: 200, total = jumlah unit di database (toleransi 5 unit baru saat smoke berjalan)", daftar.status === 200 && Math.abs((daftar.json?.total ?? -99) - nUnit) <= 5, `total=${daftar.json?.total} unit=${nUnit}`);
rec("daftar: setiap baris memuat status order + posisi + status kerja + tindakan berikutnya", baris.length > 0 && baris.every((u) => u.adopsi?.statusOrder?.label && u.adopsi?.posisi?.key && u.adopsi?.kerja?.key && u.adopsi?.tindakan?.label), `n=${baris.length}`);
rec("daftar: kontrak lama utuh (globalStatus, unitStatusDisplay, productionStatus)", baris.every((u) => u.globalStatus && u.unitStatusDisplay && u.productionStatus));
rec("daftar: tanpa catatan manual → tidak ada status kerja bersumber MANUAL sebelum ada yang mencatat", awal.prog > 0 || baris.every((u) => u.adopsi.kerja.source !== "MANUAL"));
const f = await api("GET", `${PR}/work-orders?statusKerja=BELUM_DIJADWALKAN&pageSize=200`, tA);
rec("filter statusKerja bekerja di server (hasil ⊆ daftar, semuanya Belum dijadwalkan)", f.status === 200 && (f.json?.units ?? []).every((u) => u.adopsi.kerja.key === "BELUM_DIJADWALKAN") && f.json.total <= nUnit, `${f.json?.total}`);
const u1 = baris.find((u) => !["CANCELLED"].includes(u.status)) ?? baris[0];
if (u1) {
  const p = await api("GET", `${PR}/units/${u1.id}/adopsi`, tA);
  rec(`panel unit ${u1.unitCode}: 200, memuat unit + order + adopsi + rencana + pemakaian aktual + riwayat + izin`, p.status === 200 && p.json?.unit?.id === u1.id && p.json?.adopsi?.kerja && p.json?.rencanaBahan && p.json?.pemakaianAktual && Array.isArray(p.json?.riwayat) && p.json?.izin, String(p.status));
  rec("panel: izin Admin lengkap (status order, status kerja, target, rencana, pemakaian aktual)", p.json?.izin?.statusOrder && p.json?.izin?.statusKerja && p.json?.izin?.target && p.json?.izin?.rencanaBahan && p.json?.izin?.pemakaianAktual);
  const r = await api("GET", `${PR}/units/${u1.id}/material-plan`, tA);
  rec("rencana bahan unit: 200 (belum ada rencana = kosong, bukan galat)", r.status === 200 && (r.json?.plan === null || Array.isArray(r.json?.plan?.lines)), String(r.status));
} else skip("panel unit nyata", "tidak ada unit di database");
const kat = await api("GET", `${PR}/material-catalog?limit=40`, tA);
rec("katalog bahan: 200, kelompok Gudang + bahan aktif + saldo tidak diketahui tidak tampil nol", kat.status === 200 && (kat.json?.kelompok?.length ?? 0) >= 8 && (kat.json?.rows ?? []).every((x) => x.saldoDiketahui || (x.saldo === null && x.tersedia === null)), `bahan=${kat.json?.total}`);
const ex = await api("GET", `${PR}/work-orders/export.xlsx`, tA, null, {}, true);
let wbOk = false; let wbInfo = "";
if (ex.status === 200) {
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); const ws = wb.getWorksheet("Ringkasan Unit");
    wbOk = wb.worksheets.length === 4 && Math.abs(ws.rowCount - 1 - nUnit) <= 5 && !!ws.autoFilter && ws.views?.[0]?.ySplit === 1; wbInfo = `sheet=${wb.worksheets.map((s) => s.name).join("|")} baris=${ws.rowCount - 1}/${nUnit}`;
  } catch (e) { wbInfo = "galat baca: " + e.message; }
}
rec("ekspor xlsx: 200, tipe spreadsheet, 4 sheet, baris data = jumlah unit (±5), AutoFilter + freeze header", ex.status === 200 && /spreadsheetml\.sheet/.test(ex.headers.get("content-type") || "") && /attachment; filename="Order-Produksi-\d{8}-\d{4}\.xlsx"/.test(ex.headers.get("content-disposition") || "") && wbOk, `${ex.status} ${wbInfo}`);
// ── Pagar tulis: pintu yang gagal SEBELUM transaksi ──
const mat = await prisma.material.findFirst({ where: { active: true }, select: { id: true } });
if (mat && u1) {
  const s = await api("POST", `/api/units/${u1.id}/materials`, tA, { materialId: mat.id, qty: 1 }, { "Idempotency-Key": "pendek" });
  rec("pemakaian bahan dengan Idempotency-Key terlalu pendek → 400 IDEMPOTENCY_KEY_INVALID (tidak menulis stok)", s.status === 400 && s.json?.code === "IDEMPOTENCY_KEY_INVALID", `${s.status} ${s.json?.code}`);
} else skip("kunci idempoten pendek", "tidak ada bahan aktif atau unit");
// ── Stock Opname penuh (live abf2b75e) terbaca BERSAMA fitur ini: daftar sesi + pratinjau cakupan (baca-saja) ──
const gudang = aktif.find((u) => punya(peran.get(u.id), P.INVENTORY_READ));
if (gudang) {
  const tg = tokenUntuk(gudang);
  const sc = await api("GET", "/api/inventory/stock-counts", tg); rec("Opname: daftar sesi hitung terbaca → 200", sc.status === 200, String(sc.status));
  const pv = await api("POST", "/api/inventory/stock-counts/scope-preview", tg, { mode: "FULL" });
  rec("Opname: pratinjau cakupan penuh (baca-saja) → 200 dan memuat ringkasan bahan", pv.status === 200 && typeof pv.json?.ringkasan?.masuk === "number", `${pv.status} masuk=${pv.json?.ringkasan?.masuk}`);
} else skip("Opname terbaca bersama", "tidak ada akun aktif berizin baca Inventory");
// ── Jalur lama tidak rusak ──
rec("Unit 360 / daftar unit lama tetap 200", (await api("GET", `${PR}/board`, tA)).status === 200);
rec("daftar order (Sales) tetap 200", (await api("GET", "/api/orders?limit=5", tA)).status === 200);
// ── Tidak ada tulisan ──
for (const [k, q] of Object.entries(TULIS)) rec(`smoke tidak menulis: ${k} tetap ${awal[k]}`, (await hitung(q)) === awal[k]);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + baris.length + " unit nyata dibaca");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
