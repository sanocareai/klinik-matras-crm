// REHEARSAL GUARD ROLLBACK Rencana Produksi (jadwal mingguan) — dijalankan DI DALAM container image kandidat terhadap KLON DB rehearsal KHUSUS guard (hasil restore backup, SUDAH dimigrasi, tabel jadwal kosong). TIDAK pernah menyentuh database production.
// Setiap FASE mengubah keadaan jadwal Admin sedikit demi sedikit; skrip rilis menjalankan guard rollback (baca-saja) di antara fase dan memeriksa keputusannya serta bahwa guard tidak mengubah data.
// Server = app Express MINIMAL (buildTestApp: tanpa cron/worker/WAHA). Hook pesan pelanggan = penghitung. Unit sintetis berkode tetap RH-GRD-X/Y/Z agar bisa ditemukan lagi oleh fase lain.
// FASE: g1 (unit X dijadwalkan Admin = ACTIVE) | g2 (X diaktifkan ke Pelaksanaan Meja = ADOPTED) | g3 (unit Y dijadwalkan = ACTIVE) | g3b (Y dikeluarkan = CLEARED) | g4 (unit Z dijadwalkan = ACTIVE) | g5 (rencana Meja X dibatalkan di KLON = ADOPTED tanpa rencana sah)
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
const { custodyHooks } = await import("/app/src/services/unitCustodyCommandService.js");
const FASE = process.env.FASE;
const V2 = "/api/production-v2"; const PR = "/api/production";
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 240) : ""}`); };
custodyHooks.unitReceivedAtWorkshop = () => {}; // tidak ada pesan pelanggan
const sv = await startTestServer(buildTestApp()); const base = sv.baseUrl;
async function pengguna(nama, roles) {
  const email = `rh-grd-${nama}@rehearsal.invalid`; let u = await prisma.user.findUnique({ where: { email } });
  if (!u) u = await prisma.user.create({ data: { name: `Rehearsal guard ${nama}`, email, passwordHash: "x", role: roles[0] } });
  for (const r of roles) await prisma.userRole.upsert({ where: { userId_role: { userId: u.id, role: r } }, update: {}, create: { userId: u.id, role: r } }).catch(() => {});
  return { user: u, token: jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
}
const A = await pengguna("admin", ["ADMIN"]); const G = await pengguna("gudang", ["WAREHOUSE"]);
async function call(u, method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: "Bearer " + u.token, ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j };
}
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
let seq = 0; const idem = (t) => ({ "Idempotency-Key": `rh-grd-${t}-${Date.now().toString(36)}-${++seq}-${Math.floor(Math.random() * 1e6)}-aaaa` });
const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay(); const add = (k, d) => new Date(new Date(`${k}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10);
const HARI0 = (() => { let k = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); while (dow(k) === 0) k = add(k, 1); return k; })();
const HK = (nn) => { let k = HARI0; let c = 0; while (c < nn) { k = add(k, 1); if (dow(k) !== 0) c += 1; } return k; };

let lokA = await prisma.storageLocation.findFirst({ where: { active: true, locationType: { in: ["RECEIVING_AREA", "WIP_AREA"] } }, orderBy: { code: "asc" } });
if (!lokA) { const wh = await prisma.warehouse.create({ data: { code: `RH-GRD-WH`, name: "Rehearsal Gudang" } }); lokA = await prisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "RH-A", locationType: "RECEIVING_AREA", code: `RH-GRD-LOK` } }); }
async function unitDari(tag) { // cari, atau buat bila belum ada (unit sudah diterima di workshop agar bisa diaktifkan ke Pelaksanaan Meja)
  const kode = `RH-GRD-${tag}`; const ada = await prisma.unit.findUnique({ where: { unitCode: kode } }); if (ada) return ada;
  const cust = await prisma.customer.create({ data: { name: `Rehearsal guard ${tag}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await prisma.order.create({ data: { customerId: cust.id, orderNumber: `RH-GRD-${tag}`, value: 100, category: "LAYANAN", status: "PROCESSING", pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 100, sortOrder: 1 }] } } });
  const unit = await prisma.unit.create({ data: { unitCode: kode, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Rehearsal", ukuran: "160x200" } });
  const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await prisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: 1, locationId: lokA.id, receivedById: G.user.id } });
  return unit;
}
const jadwalkan = (unit, nHari) => call(A, "POST", `${PR}/units/${unit.id}/jadwal`, { productionDate: HK(nHari), stationCode: "TABLE_1", expectedRevision: 0 }, idem("jdw"));
const baris = (unit) => prisma.productionUnitSchedule.findUnique({ where: { unitId: unit.id } });
const efekLain = async () => JSON.stringify([await n("select count(*)::int n from production_runs_v2"), await n("select count(*)::int n from stock_movements"), await n("select count(*)::int n from fin_journal_entries"), await n("select count(*)::int n from jobs")]);

if (FASE === "g1") {
  const X = await unitDari("X"); const e0 = await efekLain(); const r = await jadwalkan(X, 9);
  cek("g1: satu jadwal Admin dibuat untuk unit X (201, status ACTIVE) tanpa Run/stok/jurnal/job baru", r.status === 201 && (await baris(X))?.status === "ACTIVE" && (await efekLain()) === e0, `${r.status}`);
} else if (FASE === "g2") {
  const X = await unitDari("X"); const K = await unitDari("K"); /* anggota kohort lain: kohort tidak boleh kosong agar penulis Pelaksanaan Meja aktif */ const wc = await prisma.workCenter.upsert({ where: { code: "RH-GRD-WC" }, update: {}, create: { code: "RH-GRD-WC", name: "Rehearsal guard workshop" } });
  const opU = await pengguna("operator", ["PRODUCTION_WORKER"]); const op = (await prisma.productionOperator.findFirst({ where: { userId: opU.user.id } })) ?? await prisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: opU.user.id, primaryWorkCenterId: wc.id, active: true } });
  for (const kf of ["production_v2_writer", "production_v2_reader"]) {
    const f = await prisma.v2FeatureFlag.findUnique({ where: { key: kf } }); const d = { enabled: true, scope: "GLOBAL", config: { ...(f?.config ?? {}), unitIds: [...new Set([...(f?.config?.unitIds ?? []), K.id])] }, reason: "rehearsal guard klon" };
    await prisma.v2FeatureFlag.upsert({ where: { key: kf }, create: { key: kf, ...d }, update: d });
  }
  const akt = await call(A, "POST", `${V2}/plans`, { unitId: X.id, productionDate: HK(9), stationCode: "TABLE_2", priority: 0, workCenterId: wc.id, operatorId: op.id, activateUnit: true }, idem("akt"));
  const s = await baris(X); const plan = s?.adoptedPlanId ? await prisma.productionRunPlan.findUnique({ where: { id: s.adoptedPlanId }, include: { run: true } }) : null;
  cek("g2: unit X diaktifkan ke Pelaksanaan Meja: jadwal Admin ADOPTED menunjuk rencana Meja yang sah (milik unit X, tidak dibatalkan)", akt.status === 201 && s?.status === "ADOPTED" && !!plan && plan.run.unitId === X.id && plan.status !== "CANCELLED", `${akt.status} ${s?.status}`);
} else if (FASE === "g3") {
  const Y = await unitDari("Y"); const r = await jadwalkan(Y, 10);
  cek("g3: jadwal Admin kedua (unit Y) dibuat: ACTIVE", r.status === 201 && (await baris(Y))?.status === "ACTIVE", `${r.status}`);
} else if (FASE === "g3b") {
  const Y = await unitDari("Y"); const s = await baris(Y);
  const r = await call(A, "POST", `${PR}/units/${Y.id}/jadwal/keluarkan`, { expectedRevision: s.revision }, idem("kel"));
  cek("g3b: unit Y dikeluarkan dari jadwal: CLEARED, riwayat tetap", r.status === 201 && (await baris(Y))?.status === "CLEARED" && (await n(`select count(*)::int n from production_unit_schedule_events where unit_id = '${Y.id}'`)) === 2, `${r.status}`);
} else if (FASE === "g4") {
  const Z = await unitDari("Z"); const r = await jadwalkan(Z, 11);
  cek("g4: jadwal Admin unit Z dibuat: ACTIVE (dipakai untuk membuktikan bahaya kode lama)", r.status === 201 && (await baris(Z))?.status === "ACTIVE", `${r.status}`);
} else if (FASE === "g5") {
  const X = await unitDari("X"); const s = await baris(X);
  await prisma.$executeRawUnsafe(`update production_run_plans_v2 set status = 'CANCELLED' where id = '${s.adoptedPlanId}'`); // HANYA di klon rehearsal
  cek("g5: rencana Meja pengambil-alih unit X dibatalkan di klon (jadwal tetap ADOPTED)", (await baris(X)).status === "ADOPTED" && (await prisma.productionRunPlan.findUnique({ where: { id: s.adoptedPlanId } })).status === "CANCELLED");
} else { console.log(`FAIL FASE tidak dikenal: ${FASE}`); gagal += 1; }
console.log(`RH_GUARD_FASE ${FASE} gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
