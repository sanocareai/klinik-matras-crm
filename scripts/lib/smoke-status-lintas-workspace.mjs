// Smoke BACA-SAJA rilis "Status lintas workspace" terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membatalkan/mengubah order, Run, rencana, permintaan bahan, stok, jurnal, atau PO.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, order tidak ada).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import((await import("node:url")).pathToFileURL("/app/src/constants/permissions.js").href);
const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:4000";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
const info = (n) => console.log(`  INFO  ${n}`);
async function api(method, path, token, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* bukan JSON */ }
  return { status: r.status, json };
}
const aktif = await prisma.user.findMany({ where: { active: true } });
const peran = new Map();
for (const u of aktif) peran.set(u.id, [...new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)])]);
const punya = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));
const tokenUntuk = (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: peran.get(u.id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
const cari = (fn) => aktif.find((u) => fn(peran.get(u.id)));
const admin = cari((r) => r.includes("ADMIN") && punya(r, P.ORDER_WRITE)) ?? cari((r) => punya(r, P.ORDER_WRITE));
const tanpaIzin = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.ORDER_WRITE) && !punya(r, P.ORDER_READ));
if (!admin) { rec("akun dengan izin tulis Order tersedia", false); process.exit(1); }
const tA = tokenUntuk(admin); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const keadaan = async () => ({
  statusOrder: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from \"Order\" group by 1 order by 1")),
  statusUnit: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from units group by 1 order by 1")),
  statusRun: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from production_runs_v2 group by 1 order by 1")),
  rencana: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from production_run_plans_v2 group by 1 order by 1")),
  reservasi: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from material_reservations_v2 group by 1 order by 1").catch(() => [])),
  permintaanBahan: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from material_issues group by 1 order by 1").catch(() => [])),
  jejakSelaras: await hitung("select count(*)::int n from activity_events where event_type = 'PRODUCTION_FOLLOWS_ORDER'"),
  pergerakan: await hitung("select count(*)::int n from stock_movements"),
  transisiOrder: await hitung("select count(*)::int n from order_status_transitions"),
  job: await hitung("select count(*)::int n from jobs"),
  jobUnit: await hitung("select count(*)::int n from job_units"),
  retur: await hitung("select count(*)::int n from production_material_returns_v2"),
});
const awal = await keadaan();

// ── Pintu: tanpa token / tanpa izin / order tidak ada (semua gagal SEBELUM menyentuh data) ──
rec("ubah status order tanpa token → 401", (await api("PATCH", `/api/orders/${nol}`, null, { status: "CANCELLED" })).status === 401);
rec("batalkan order tanpa token → 401", (await api("POST", `/api/orders/${nol}/cancel`, null, { reason: "uji smoke" })).status === 401);
if (tanpaIzin) rec("ubah status order akun tanpa izin Order → 403", (await api("PATCH", `/api/orders/${nol}`, tokenUntuk(tanpaIzin), { status: "CANCELLED" })).status === 403); else skip("ubah status 403", "tidak ada akun aktif tanpa izin Order");
const patchTak = await api("PATCH", `/api/orders/${nol}`, tA, { status: "CANCELLED", statusOverrideNote: "uji smoke" });
rec("ubah status order yang tidak ada → 404 (tanpa menulis)", patchTak.status === 404, `${patchTak.status} ${patchTak.json?.error ?? ""}`);
const batalTak = await api("POST", `/api/orders/${nol}/cancel`, tA, { reason: "uji smoke" });
rec("batalkan order yang tidak ada → 404 (tanpa menulis)", batalTak.status === 404, `${batalTak.status} ${batalTak.json?.error ?? ""}`);

// ── Route Planner: POST /jobs menolak sebelum menyentuh data (unit tidak ada / tanpa token) ──
rec("buat job tanpa token → 401", (await api("POST", "/api/armada/jobs", null, { type: "DELIVERY", unitIds: [nol] })).status === 401);
const jobTak = await api("POST", "/api/armada/jobs", tA, { type: "DELIVERY", unitIds: [nol], scheduledDate: "2099-01-01" });
rec("buat job untuk unit yang tidak ada → 400 (tanpa menulis)", jobTak.status === 400, `${jobTak.status} ${jobTak.json?.error ?? ""}`);

// ── Riwayat Unit 360: sumber + nama PIC pada unit nyata ──
const unitRun = await prisma.$queryRawUnsafe("select u.id::text id, u.unit_code code from units u join production_runs_v2 r on r.unit_id = u.id order by r.created_at desc limit 5");
if (unitRun.length === 0) skip("riwayat Unit 360", "tidak ada unit ber-Run di produksi");
let diperiksa = 0; let berpelaku = 0; let jenisSumber = new Set();
for (const u of unitRun) {
  const r = await api("GET", `/api/production-v2/units/${u.id}/overview`, tA);
  if (r.status !== 200) { if (r.status === 404) continue; rec(`Unit 360 ${u.code}: 200`, false, String(r.status)); continue; }
  diperiksa += 1;
  const a = r.json?.activity;
  rec(`Unit 360 ${u.code}: riwayat berbentuk benar (sumber, kalimat, waktu, kolom pelaku; urut naik)`, Array.isArray(a) && a.every((x) => x.source && x.label && x.at && "actor" in x) && a.every((x, i) => i === 0 || new Date(a[i - 1].at).getTime() <= new Date(x.at).getTime()), `baris=${a?.length}`);
  for (const x of a ?? []) { jenisSumber.add(x.source); if (x.actor) berpelaku += 1; }
}
if (diperiksa > 0) { rec("riwayat nyata memuat nama pelaku pada sebagian baris", berpelaku > 0, `berpelaku=${berpelaku}; sumber=${[...jenisSumber].join(",")}`); }
else if (unitRun.length > 0) skip("riwayat Unit 360", "unit ber-Run di luar cohort pembaca");

// ── Yang tetap utuh ──
rec("Route Planner: papan DELIVERY tetap 200", (await api("GET", "/api/armada/board?type=DELIVERY", tA)).status === 200);
const lap = await api("GET", "/api/production-v2/admin-override/report", tA);
rec("Admin override: laporan tetap 200", lap.status === 200, String(lap.status));
rec("Gudang: koreksi cakupan tetap 200", (await api("GET", "/api/inventory/koreksi/cakupan", tA)).status === 200);
rec("Aktivitas generik tetap 200 (GET /api/activity)", (await api("GET", `/api/activity?entityType=order&entityId=${nol}`, tA)).status === 200);
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tA)).status === 200);

// ── Tidak ada tulisan oleh smoke ──
const akhir = await keadaan();
rec("smoke tidak menulis: status order/unit/Run/rencana/reservasi/permintaan bahan, jejak penyelarasan, pergerakan stok, transisi order, job, job_units, dan antrean retur bahan tidak berubah", JSON.stringify(akhir) === JSON.stringify(awal), JSON.stringify({ awal, akhir }));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
