// Smoke BACA-SAJA rilis "Status Produksi + Penerimaan Workshop" terhadap backend yang SUDAH melayani (container baru; atau server rehearsal bila SMOKE_BASE diisi). Tidak membuat penerimaan, koreksi, Run, serah-terima, pergerakan stok, jurnal, job, atau pesan.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, validasi/UUID tidak valid).
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
const admin = cari((r) => r.includes("ADMIN") && punya(r, P.UNIT_READ) && punya(r, P.UNIT_ROUTING_WRITE) && punya(r, P.INVENTORY_WRITE) && punya(r, P.ORDER_WRITE));
const hanyaLihat = cari((r) => punya(r, P.UNIT_READ) && !punya(r, P.INVENTORY_WRITE) && !punya(r, P.UNIT_STAGE_WRITE) && !punya(r, P.UNIT_ROUTING_WRITE));
const tanpaRouting = cari((r) => (punya(r, P.INVENTORY_WRITE) || punya(r, P.UNIT_STAGE_WRITE)) && !punya(r, P.UNIT_ROUTING_WRITE));
const tanpaBaca = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.UNIT_READ));
if (!admin) { rec("akun ADMIN aktif dengan izin Produksi/Gudang lengkap tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin);
const nol = "00000000-0000-4000-8000-000000000000";
const PR = "/api/production";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  sm: "select count(*)::int n from stock_movements", cmd: "select count(*)::int n from v2_commands", rec: "select count(*)::int n from unit_workshop_receipts", kor: "select count(*)::int n from unit_workshop_receipt_corrections",
  job: "select count(*)::int n from jobs", run: "select count(*)::int n from production_runs_v2", qc: "select count(*)::int n from quality_inspections_v2", jur: "select count(*)::int n from fin_journal_entries",
  serah: "select count(*)::int n from unit_custody_handoffs_v2", act: "select count(*)::int n from activity_events", outbox: "select count(*)::int n from domain_outbox", prog: "select count(*)::int n from production_unit_work_progress",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);
const nUnit = await hitung("select count(*)::int n from units");

// ── Pintu: tanpa token / tanpa izin / bentuk salah — gagal SEBELUM menyentuh data ──
rec("daftar kerja tanpa token → 401", (await api("GET", `${PR}/work-list`, null)).status === 401);
rec("ruang kerja unit tanpa token → 401", (await api("GET", `${PR}/units/${nol}/ruang-kerja`, null)).status === 401);
rec("catat penerimaan tanpa token → 401", (await api("POST", `${PR}/units/${nol}/penerimaan-workshop`, null, { fisikDiterima: true })).status === 401);
rec("koreksi penerimaan tanpa token → 401", (await api("POST", `${PR}/units/${nol}/penerimaan-workshop/koreksi`, null, { jenis: "LOCATION" })).status === 401);
if (tanpaBaca) { const s = (await api("GET", `${PR}/work-list`, tokenUntuk(tanpaBaca))).status; rec("daftar kerja akun tanpa izin baca Unit → 403", s === 403, String(s)); } else skip("daftar kerja 403", "tidak ada akun aktif tanpa izin baca Unit");
if (hanyaLihat) {
  const t = tokenUntuk(hanyaLihat);
  const a = (await api("POST", `${PR}/units/${nol}/penerimaan-workshop`, t, { fisikDiterima: true })).status; rec("catat penerimaan akun hanya-lihat → 403 (sebelum menyentuh data)", a === 403, String(a));
  const b = (await api("POST", `${PR}/units/${nol}/penerimaan-workshop/koreksi`, t, { jenis: "LOCATION", alasan: "uji", expectedRevisi: 0 })).status; rec("koreksi penerimaan akun hanya-lihat → 403", b === 403, String(b));
  const c = (await api("GET", `${PR}/work-list`, t)).status; rec("akun hanya-lihat tetap bisa membaca daftar kerja → 200", c === 200, String(c));
} else skip("akun hanya-lihat", "tidak ada akun aktif dengan izin baca tetapi tanpa izin tulis");
if (tanpaRouting) {
  const t = tokenUntuk(tanpaRouting);
  const r = await api("POST", `${PR}/units/${nol}/penerimaan-workshop/koreksi`, t, { jenis: "NOT_RECEIVED", alasan: "uji", expectedRevisi: 0 });
  rec("'belum diterima fisik' oleh akun tanpa izin Admin/Kepala Produksi → 403 KOREKSI_IZIN_DITOLAK", r.status === 403 && r.json?.code === "KOREKSI_IZIN_DITOLAK", `${r.status} ${r.json?.code}`);
} else skip("koreksi 'belum diterima' tanpa izin Admin", "tidak ada akun aktif berizin Gudang/Produksi tanpa izin routing");
const f0 = await api("POST", `${PR}/units/${nol}/penerimaan-workshop`, tA, { fisikDiterima: false });
rec("penerimaan tanpa pernyataan fisik → 400 PENERIMAAN_FISIK_WAJIB (tidak menulis)", f0.status === 400 && f0.json?.code === "PENERIMAAN_FISIK_WAJIB", `${f0.status} ${f0.json?.code}`);
const f1 = await api("POST", `${PR}/units/${nol}/penerimaan-workshop`, tA, { fisikDiterima: "true" });
rec("pernyataan fisik bukan boolean true → 400", f1.status === 400 && f1.json?.code === "PENERIMAAN_FISIK_WAJIB", `${f1.status}`);
const k1 = await api("POST", `${PR}/units/${nol}/penerimaan-workshop/koreksi`, tA, { jenis: "LOCATION", alasan: "  ", expectedRevisi: 0 });
rec("koreksi tanpa alasan → 400 KOREKSI_ALASAN_WAJIB (tidak menulis)", k1.status === 400 && k1.json?.code === "KOREKSI_ALASAN_WAJIB", `${k1.status} ${k1.json?.code}`);
const k2 = await api("POST", `${PR}/units/${nol}/penerimaan-workshop/koreksi`, tA, { jenis: "ASAL", alasan: "uji alasan", expectedRevisi: 0 });
rec("jenis koreksi tidak dikenal → 400 KOREKSI_JENIS_TIDAK_VALID", k2.status === 400 && k2.json?.code === "KOREKSI_JENIS_TIDAK_VALID", `${k2.status} ${k2.json?.code}`);
rec("UUID unit tidak valid → 400", (await api("POST", `${PR}/units/bukan-uuid/penerimaan-workshop`, tA, { fisikDiterima: true })).status === 400);
rec("ruang kerja unit tidak ada → 404", (await api("GET", `${PR}/units/${nol}/ruang-kerja`, tA)).status === 404);
const pk = await api("GET", `${PR}/units/${nol}/penerimaan-workshop/koreksi`, tA);
rec("pratinjau koreksi unit tanpa penerimaan → 404 PENERIMAAN_TIDAK_ADA", pk.status === 404 && pk.json?.code === "PENERIMAAN_TIDAK_ADA", `${pk.status} ${pk.json?.code}`);

// ── Baca: daftar kerja (aktif + riwayat), ruang kerja unit nyata, antrean Gudang, pilihan lokasi, ekspor xlsx ──
const dk = await api("GET", `${PR}/work-list?pageSize=50`, tA);
const orders = dk.json?.orders ?? [];
rec("daftar kerja aktif: 200, memuat hitungan aktif/riwayat dan filter cepat", dk.status === 200 && typeof dk.json?.counts?.aktif === "number" && typeof dk.json?.counts?.riwayat === "number" && dk.json?.filterCounts && "PERLU_TINDAKAN" in dk.json.filterCounts, `aktif=${dk.json?.counts?.aktif} riwayat=${dk.json?.counts?.riwayat}`);
rec("daftar kerja: setiap order memuat status order Sales + unit dengan posisi, status kerja, tindakan", orders.length > 0 && orders.every((o) => o.statusOrder?.label && o.units?.length > 0 && o.units.every((u) => u.posisi?.key && u.kerja?.key && "tindakan" in u)), `n=${orders.length}`);
rec("daftar kerja: tanpa penerimaan di data → tidak ada unit berposisi dari penerimaan petugas", awal.rec > 0 || orders.every((o) => o.units.every((u) => u.posisi?.label !== "Di workshop" || u.posisi?.detail !== "Penerimaan dicatat petugas")));
const rw = await api("GET", `${PR}/work-list?scope=riwayat&pageSize=20`, tA);
rec("daftar kerja riwayat: 200 (order selesai tersedia di Riwayat)", rw.status === 200 && Array.isArray(rw.json?.orders), `total=${rw.json?.total}`);
const fl = await api("GET", `${PR}/work-list?filter=PERLU_TINDAKAN&sort=TARGET&q=a&pageSize=10`, tA);
rec("daftar kerja: filter + urutan + pencarian bekerja di server (200)", fl.status === 200 && fl.json?.filter === "PERLU_TINDAKAN" && fl.json?.sort === "TARGET", `${fl.status}`);
const fb = await api("GET", `${PR}/work-list?filter=ASAL&sort=ASAL`, tA);
rec("filter/urutan tak dikenal jatuh ke bawaan (tidak galat)", fb.status === 200 && fb.json?.filter === "SEMUA" && fb.json?.sort === "PERHATIAN");
const u1 = orders.flatMap((o) => o.units).find((u) => !["CANCELLED", "DELIVERED"].includes(u.status)) ?? orders[0]?.units?.[0];
if (u1) {
  const rk = await api("GET", `${PR}/units/${u1.id}/ruang-kerja`, tA);
  rec(`ruang kerja unit ${u1.unitCode}: 200, memuat order Sales + ketersediaan Dokumentasi dengan alasan jujur + izin`, rk.status === 200 && rk.json?.unit?.id === u1.id && rk.json?.order?.statusOrder?.label && rk.json?.dokumentasi && typeof rk.json.dokumentasi.bolehUnggah === "boolean" && rk.json?.izin, String(rk.status));
  const ad = await api("GET", `${PR}/units/${u1.id}/adopsi`, tA);
  rec(`panel unit ${u1.unitCode}: 200 + penerimaan (null bila belum) + riwayat penerimaan + izin catat/koreksi`, ad.status === 200 && ("penerimaan" in (ad.json ?? {})) && Array.isArray(ad.json?.riwayatPenerimaan) && typeof ad.json?.izin?.catatPenerimaan === "boolean" && typeof ad.json?.izin?.koreksiBelumDiterima === "boolean", String(ad.status));
} else skip("ruang kerja unit nyata", "tidak ada unit aktif");
const mn = await api("GET", `${PR}/penerimaan-workshop/menunggu?limit=20`, tA);
rec("antrean Gudang 'menunggu dicatat diterima': 200 (total + daftar)", mn.status === 200 && typeof mn.json?.total === "number" && Array.isArray(mn.json?.units), `total=${mn.json?.total}`);
const pl = await api("GET", `${PR}/penerimaan-workshop/pilihan`, tA);
rec("pilihan lokasi penerimaan: 200 (lokasi Receiving/WIP + status lokasi workshop bawaan)", pl.status === 200 && Array.isArray(pl.json?.lokasi) && "bawaan" in pl.json, `lokasi=${pl.json?.lokasi?.length} bawaan=${pl.json?.bawaan?.code ?? "belum diatur"}`);
const ex = await api("GET", `${PR}/work-orders/export.xlsx`, tA, null, {}, true);
let wbOk = false; let wbInfo = "";
if (ex.status === 200) {
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(ex.buf); const ws = wb.getWorksheet("Ringkasan Unit");
    wbOk = wb.worksheets.length === 4 && Math.abs(ws.rowCount - 1 - nUnit) <= 5 && !!ws.autoFilter && ws.views?.[0]?.ySplit === 1; wbInfo = `sheet=${wb.worksheets.map((s) => s.name).join("|")} baris=${ws.rowCount - 1}/${nUnit}`;
  } catch (e) { wbInfo = "galat baca: " + e.message; }
}
rec("ekspor xlsx: 200, 4 sheet, baris data = jumlah unit (±5), AutoFilter + freeze header", ex.status === 200 && wbOk, wbInfo);
// ── Jalur lama dan modul terkait tidak rusak ──
const gudang = aktif.find((u) => punya(peran.get(u.id), P.INVENTORY_READ));
if (gudang) {
  const tg = tokenUntuk(gudang);
  const sc = await api("GET", "/api/inventory/stock-counts", tg); rec("Opname: daftar sesi hitung terbaca → 200", sc.status === 200, String(sc.status));
  const pv = await api("POST", "/api/inventory/stock-counts/scope-preview", tg, { mode: "FULL" });
  rec("Opname: pratinjau cakupan penuh (baca-saja) → 200 dan memuat ringkasan bahan", pv.status === 200 && typeof pv.json?.ringkasan?.masuk === "number", `${pv.status} masuk=${pv.json?.ringkasan?.masuk}`);
  const uc = await api("GET", "/api/inventory/unit-custody?status=OFFERED", tg); rec("Gudang: antrean serah-terima unit (custody) terbaca (200/404 sesuai flag, bukan galat server)", uc.status < 500, String(uc.status));
} else skip("Opname/custody terbaca bersama", "tidak ada akun aktif berizin baca Inventory");
rec("daftar Order Produksi (kontrak lama) tetap 200", (await api("GET", `${PR}/work-orders?pageSize=20`, tA)).status === 200);
rec("papan Produksi lama tetap 200", (await api("GET", `${PR}/board`, tA)).status === 200);
rec("daftar order (Sales) tetap 200", (await api("GET", "/api/orders?limit=5", tA)).status === 200);
// ── Tidak ada tulisan ──
for (const [k, q] of Object.entries(TULIS)) rec(`smoke tidak menulis: ${k} tetap ${awal[k]}`, (await hitung(q)) === awal[k]);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP); " + orders.length + " order nyata dibaca");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
