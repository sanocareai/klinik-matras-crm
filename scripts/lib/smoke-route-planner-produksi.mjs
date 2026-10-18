// Smoke BACA-SAJA rilis "status produksi tidak menahan pengiriman" terhadap backend yang SUDAH melayani (dijalankan di container baru). Tidak membuat/mengubah job, rute, unit, Run, stok, jurnal, atau PO.
// Penolakan diuji hanya pada pintu yang gagal SEBELUM menyentuh data (tanpa token, tanpa izin, unit tidak ada).
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
const dispatcher = cari((r) => punya(r, P.JOB_WRITE) && r.includes("ADMIN")) ?? cari((r) => punya(r, P.JOB_WRITE));
const tanpaIzin = cari((r) => r.every((x) => ROLE_PERMISSIONS[x]) && !punya(r, P.JOB_WRITE) && !punya(r, P.JOB_OWN_WRITE));
if (!dispatcher) { rec("akun dengan izin tulis Job tersedia", false); process.exit(1); }
const tD = tokenUntuk(dispatcher); const nol = "00000000-0000-4000-8000-000000000000";
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const keadaan = async () => ({
  job: await hitung("select count(*)::int n from jobs"), jobUnit: await hitung("select count(*)::int n from job_units"), rute: await hitung("select count(*)::int n from routes"),
  rilisRun: await hitung("select count(*)::int n from production_runs_v2 where delivery_released_at is not null"),
  statusUnit: JSON.stringify(await prisma.$queryRawUnsafe("select status::text s, count(*)::int n from units group by 1 order by 1")),
  aktivitasDispatch: await hitung("select count(*)::int n from activity_events where event_type = 'PRODUCTION_DISPATCHED_BEFORE_DONE'"),
  pergerakan: await hitung("select count(*)::int n from stock_movements"),
});
const awal = await keadaan();

// ── Pintu: tanpa token / tanpa izin / unit tidak ada (semua gagal SEBELUM menyentuh data) ──
rec("papan pengiriman tanpa token → 401", (await api("GET", "/api/armada/board?type=DELIVERY", null)).status === 401);
rec("buat job tanpa token → 401", (await api("POST", "/api/armada/jobs", null, { type: "DELIVERY", unitIds: [nol] })).status === 401);
if (tanpaIzin) rec("buat job akun tanpa izin Job → 403", (await api("POST", "/api/armada/jobs", tokenUntuk(tanpaIzin), { type: "DELIVERY", unitIds: [nol] })).status === 403); else skip("buat job 403", "tidak ada akun aktif tanpa izin Job");
const tak = await api("POST", "/api/armada/jobs", tD, { type: "DELIVERY", unitIds: [nol], scheduledDate: "2026-12-31" });
rec("buat job untuk unit yang tidak ada → 400 (tanpa membuat job)", tak.status === 400, `${tak.status} ${tak.json?.error ?? ""}`);
rec("buat job tanpa unit → 400", (await api("POST", "/api/armada/jobs", tD, { type: "DELIVERY", unitIds: [] })).status === 400);

// ── Aturan baru terlihat di papan: unit produksi yang sah ada di `available` (sama dengan hitungan SQL independen) ──
const papan = await api("GET", "/api/armada/board?type=DELIVERY", tD);
const sqlProduksi = await prisma.$queryRawUnsafe("select u.id::text id, u.unit_code code from units u join \"Order\" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','READY') and o.penjualan_karyawan_id is null and not exists (select 1 from job_units ju join jobs j on j.id = ju.job_id where ju.unit_id = u.id and j.type = 'DELIVERY' and j.status in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED','RESCHEDULED'))");
rec("papan DELIVERY: 200 dan bentuk lama utuh (jobs, available, availableMenunggu kosong untuk klien lama)", papan.status === 200 && Array.isArray(papan.json?.jobs) && Array.isArray(papan.json?.available) && Array.isArray(papan.json?.availableMenunggu) && papan.json.availableMenunggu.length === 0, String(papan.status));
const idAvail = new Set((papan.json?.available ?? []).map((u) => u.id));
const hilang = sqlProduksi.filter((u) => !idAvail.has(u.id));
rec(`papan DELIVERY: semua ${sqlProduksi.length} unit produksi yang sah (RECEIVED/IN_PRODUCTION, order biasa PROCESSING/READY, tanpa job aktif) ada di available`, hilang.length === 0, hilang.length ? `hilang: ${hilang.map((u) => u.code).join(",")}` : "");
const rika = await prisma.unit.findFirst({ where: { unitCode: "RES-03102026-018-U1" }, select: { id: true, status: true, order: { select: { status: true } } } });
if (rika) info(`RES-03102026-018-U1 (dibaca saja): unit ${rika.status}, order ${rika.order?.status}; ${idAvail.has(rika.id) ? "TAMPIL di available papan pengiriman" : "tidak di available (belum memenuhi syarat/ sudah punya job aktif)"}`);
const lama = await api("GET", "/api/armada/board?type=DELIVERY&termasukMenunggu=1", tD);
rec("klien lama (?termasukMenunggu=1): 200 dan availableMenunggu kosong", lama.status === 200 && lama.json?.availableMenunggu?.length === 0);
const pick = await api("GET", "/api/armada/board?type=PICKUP", tD);
rec("papan PICKUP tidak berubah bentuk: 200", pick.status === 200 && Array.isArray(pick.json?.available));
if (pick.status === 200) rec("papan PICKUP: tidak memuat unit produksi (hanya AWAITING_PICKUP)", (pick.json.available ?? []).every((u) => u.status === "AWAITING_PICKUP"));

// ── Yang tetap utuh ──
const lap = await api("GET", "/api/production-v2/admin-override/report", tD);
rec("Admin override: laporan tetap 200 (fitur override tidak berubah)", lap.status === 200 && Array.isArray(lap.json?.items), String(lap.status));
const sw = await api("GET", "/api/production-v2/admin-override/switch", tD);
rec("Admin override: saklar tetap terbaca (200) dan tidak dinyalakan oleh rilis ini", sw.status === 200, `${sw.status} aktif=${sw.json?.enabled}`);
rec("Gudang: koreksi cakupan tetap 200", (await api("GET", "/api/inventory/koreksi/cakupan", tD)).status === 200);
rec("Finance: daftar PO tetap 200", (await api("GET", "/api/finance/purchase-orders", tD)).status === 200);

// ── Tidak ada tulisan oleh smoke ──
const akhir = await keadaan();
rec("smoke tidak menulis: job, job_unit, rute, Run yang dilepas, status unit, aktivitas dispatch, dan pergerakan stok tidak berubah", JSON.stringify(akhir) === JSON.stringify(awal), JSON.stringify({ awal, akhir }));
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
