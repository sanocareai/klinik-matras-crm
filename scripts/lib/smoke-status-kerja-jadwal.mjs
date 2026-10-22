// Smoke BACA-SAJA rilis "status kerja Dijadwalkan dari Rencana Admin" terhadap backend yang SUDAH melayani (container baru). TIDAK membuat jadwal, riwayat, Run, penerimaan, stok, job, jurnal, atau pesan.
// Hanya GET (Ringkasan unit, daftar + filter, ekspor Excel) dan penolakan di pintu yang gagal sebelum menyentuh data. Jumlah baris tabel penting dibandingkan sebelum vs sesudah.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 300) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
async function api(method, path, token, mentah = false) {
  const r = await fetch(BASE + path, { method, headers: token ? { Authorization: "Bearer " + token } : {} });
  if (mentah) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const admin = aktif.find((u) => peran.get(u.id).includes("ADMIN") && punya(peran.get(u.id), P.UNIT_READ));
if (!admin) { rec("akun ADMIN aktif dengan izin baca Unit tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin);
const PR = "/api/production";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TULIS = {
  sm: "select count(*)::int n from stock_movements", jad: "select count(*)::int n from production_unit_schedules", ev: "select count(*)::int n from production_unit_schedule_events", plan: "select count(*)::int n from production_run_plans_v2",
  run: "select count(*)::int n from production_runs_v2", job: "select count(*)::int n from jobs", jur: "select count(*)::int n from fin_journal_entries", komp: "select count(*)::int n from unit_component_reuse_entries",
  prog: "select count(*)::int n from production_unit_work_progress", act: "select count(*)::int n from activity_events", unit: "select count(*)::int n from units", mi: "select count(*)::int n from material_issues",
};
const awal = {}; for (const [k, q] of Object.entries(TULIS)) awal[k] = await hitung(q);

rec("health publik sehat", (await api("GET", "/api/health", null)).json?.ok === true);
rec("Ringkasan unit tanpa token → 401", (await api("GET", `${PR}/units/00000000-0000-4000-8000-000000000000/adopsi`, null)).status === 401);

// ── Unit berjadwal Admin AKTIF (tanpa rencana Meja): harus terbaca Dijadwalkan di Ringkasan, daftar, dan Excel ──
const aktifRows = await prisma.$queryRawUnsafe("select s.unit_id::text id, u.unit_code code from production_unit_schedules s join units u on u.id = s.unit_id where s.status = 'ACTIVE' order by s.updated_at desc limit 40");
const NAIK = new Set(["DIKERJAKAN", "DIKERJAKAN_ULANG", "MENUNGGU_QC", "SELESAI", "TERTUNDA", "DIBATALKAN"]);
if (!aktifRows.length) skip("unit berjadwal Admin ACTIVE terbaca 'Dijadwalkan'", "tidak ada jadwal Admin ACTIVE di produksi saat smoke");
const terbaca = [];
for (const u of aktifRows) {
  const r = await api("GET", `${PR}/units/${u.id}/adopsi`, tA); const k = r.json?.adopsi?.kerja;
  terbaca.push({ code: u.code, id: u.id, status: r.status, key: k?.key, source: k?.source, jad: r.json?.adopsi?.jadwal?.sumber, bahan: (r.json?.adopsi?.pemakaianBahan?.baruCatatan ?? 0) + (r.json?.adopsi?.pemakaianBahan?.komponenLamaDipakaiKembali ?? 0) });
}
if (aktifRows.length) {
  rec(`Ringkasan ${aktifRows.length} unit berjadwal Admin ACTIVE: semua 200 dan tidak ada yang 'Belum dijadwalkan'`, terbaca.every((x) => x.status === 200 && x.key && x.key !== "BELUM_DIJADWALKAN"), terbaca.filter((x) => x.key === "BELUM_DIJADWALKAN" || x.status !== 200).map((x) => `${x.code}:${x.status}/${x.key}`).join(" "));
  rec("yang tidak tertimpa fakta lain terbaca 'Dijadwalkan' (sumber 'Dari jadwal') dan jadwalnya ber-sumber ADMIN/V2", terbaca.filter((x) => !NAIK.has(x.key)).every((x) => x.key === "DIJADWALKAN" && (x.jad === "ADMIN" || x.jad === "V2")), terbaca.filter((x) => !NAIK.has(x.key) && x.key !== "DIJADWALKAN").map((x) => `${x.code}:${x.key}`).join(" "));
  rec("jadwal SAJA tidak mengaku ada pemakaian: unit 'Dijadwalkan' berhitungan pemakaian bahan nol", terbaca.filter((x) => x.key === "DIJADWALKAN" && x.source === "JADWAL").every((x) => x.bahan === 0));
  const dij = await api("GET", `${PR}/work-orders?statusKerja=DIJADWALKAN&pageSize=500`, tA);
  const idsDij = new Set((dij.json?.units ?? []).map((x) => x.id));
  rec("daftar + filter 'Dijadwalkan' memuat semua unit berjadwal Admin yang berstatus Dijadwalkan", dij.status === 200 && terbaca.filter((x) => x.key === "DIJADWALKAN").every((x) => idsDij.has(x.id)), `${dij.status} total=${dij.json?.total}`);
  const belum = await api("GET", `${PR}/work-orders?statusKerja=BELUM_DIJADWALKAN&pageSize=500`, tA);
  const idsBelum = new Set((belum.json?.units ?? []).map((x) => x.id));
  rec("daftar + filter 'Belum dijadwalkan' TIDAK memuat unit berjadwal Admin", belum.status === 200 && terbaca.every((x) => !idsBelum.has(x.id)), `${belum.status}`);
  const x = await api("GET", `${PR}/work-orders/export.xlsx?statusKerja=DIJADWALKAN`, tA, true);
  rec("ekspor Excel Order Produksi 200", x.status === 200, String(x.status));
  if (x.status === 200) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf); const ws = wb.getWorksheet("Ringkasan Unit"); const head = ws.getRow(1).values.slice(1);
    const iKode = head.indexOf("Kode Unit") + 1; const iStatus = head.indexOf("Status Kerja (Administratif)") + 1;
    const peta = new Map(); ws.eachRow((row, i) => { if (i > 1) peta.set(row.values[iKode], row.values[iStatus]); });
    rec("Excel memuat kolom status kerja dan menuliskan 'Dijadwalkan' untuk unit berjadwal Admin yang berstatus Dijadwalkan", iKode > 0 && iStatus > 0 && terbaca.filter((t) => t.key === "DIJADWALKAN").every((t) => peta.get(t.code) === "Dijadwalkan"), terbaca.filter((t) => t.key === "DIJADWALKAN" && peta.get(t.code) !== "Dijadwalkan").map((t) => `${t.code}:${peta.get(t.code)}`).join(" "));
  }
}

// ── Jadwal yang sudah dikeluarkan (CLEARED) tidak boleh dibaca sebagai jadwal ──
const bersih = await prisma.$queryRawUnsafe("select s.unit_id::text id, u.unit_code code from production_unit_schedules s join units u on u.id = s.unit_id where s.status = 'CLEARED' order by s.updated_at desc limit 20");
if (!bersih.length) skip("jadwal CLEARED tidak dibaca sebagai jadwal", "tidak ada jadwal CLEARED di produksi saat smoke");
else {
  const hasil = [];
  for (const u of bersih) { const r = await api("GET", `${PR}/units/${u.id}/adopsi`, tA); hasil.push({ code: u.code, key: r.json?.adopsi?.kerja?.key, source: r.json?.adopsi?.kerja?.source, sumber: r.json?.adopsi?.jadwal?.sumber ?? null }); }
  rec(`jadwal CLEARED (${bersih.length} unit): tidak ada yang terbaca 'Dijadwalkan' dari jadwal Admin`, hasil.every((x) => !(x.key === "DIJADWALKAN" && x.source === "JADWAL" && x.sumber !== "V2")), hasil.filter((x) => x.key === "DIJADWALKAN").map((x) => `${x.code}:${x.sumber}`).join(" "));
}

// ── Yang tetap utuh ──
rec("Rencana Produksi: kalender minggu tetap 200", (await api("GET", `${PR}/rencana/minggu`, tA)).status === 200);
rec("Rencana Produksi: antrean tetap 200", (await api("GET", `${PR}/rencana/antrean?tab=SEMUA`, tA)).status === 200);
rec("Daftar Order Produksi tetap 200", (await api("GET", `${PR}/work-orders?pageSize=20`, tA)).status === 200);

// ── Tidak ada tulisan oleh smoke ──
const akhir = {}; for (const [k, q] of Object.entries(TULIS)) akhir[k] = await hitung(q);
// Tabel yang HANYA ditulis oleh alur jadwal/Meja/komponen: smoke ini (dan rilis ini) tidak boleh mengubahnya. Tabel yang juga ditulis pengguna nyata selama rilis (stok, job, jurnal, aktivitas, unit, Material Issue) hanya dilaporkan, tidak menggagalkan.
const KETAT = ["jad", "ev", "plan", "run", "komp", "prog"];
const berubah = KETAT.filter((k) => awal[k] !== akhir[k]);
rec("smoke tidak menulis: jadwal, riwayat jadwal, rencana Meja, Run, komponen lama, progres kerja tidak berubah", berubah.length === 0, berubah.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
const info = Object.keys(awal).filter((k) => !KETAT.includes(k) && awal[k] !== akhir[k]);
if (info.length) console.log("  INFO  tabel yang juga ditulis pengguna nyata berubah selama smoke (bukan oleh smoke ini): " + info.map((k) => `${k}:${awal[k]}->${akhir[k]}`).join(" "));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
