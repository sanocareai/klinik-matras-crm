// REHEARSAL PENUH Rencana Produksi (jadwal mingguan) — dijalankan DI DALAM container image kandidat terhadap KLON DB rehearsal (hasil restore backup production, SUDAH dimigrasi). TIDAK pernah menyentuh database production.
// Server yang dipakai adalah app Express MINIMAL (buildTestApp: router asli tanpa cron/worker/WAHA/Socket.IO) — TIDAK memuat src/index.js, jadi tidak ada pesan WhatsApp, job, atau efek samping luar.
// Hook pesan pelanggan diganti penghitung (tidak ada pesan yang pernah dikirim). Pagar: nama database WAJIB mengandung "test" (tests/integration/setup/env.js); skrip rilis menamai DB rehearsal rehearsal_rjm_test_*.
// FASE (env FASE): smoke | skenario
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
const { custodyHooks } = await import("/app/src/services/unitCustodyCommandService.js");
const FASE = process.env.FASE || "skenario";
const V2 = "/api/production-v2"; const PR = "/api/production";
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 240) : ""}`); };
const pesan = []; custodyHooks.unitReceivedAtWorkshop = (id) => { pesan.push(id); }; // tidak ada pesan pelanggan yang dikirim: hanya dihitung
const sv = await startTestServer(buildTestApp()); const base = sv.baseUrl;

if (FASE === "smoke") {
  const kode = await new Promise((res) => { const c = spawn(process.execPath, ["/rh/smoke-rencana-jadwal-mingguan.mjs"], { env: { ...process.env, SMOKE_BASE: base }, stdio: "inherit" }); c.on("exit", res); });
  console.log(`RH_SMOKE kode=${kode}`); await sv.close(); process.exit(kode === 0 ? 0 : 1);
}

async function pengguna(nama, roles) {
  const email = `rh-${nama}@rehearsal.invalid`; let u = await prisma.user.findUnique({ where: { email } });
  if (!u) u = await prisma.user.create({ data: { name: `Rehearsal ${nama}`, email, passwordHash: "x", role: roles[0] } });
  for (const r of roles) await prisma.userRole.upsert({ where: { userId_role: { userId: u.id, role: r } }, update: {}, create: { userId: u.id, role: r } }).catch(() => {});
  return { user: u, token: jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "6h" }) };
}
const U = { A: await pengguna("admin-a", ["ADMIN"]), S: await pengguna("sales-s", ["SALES"]), G: await pengguna("gudang-g", ["WAREHOUSE"]) };
async function call(u, method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j };
}
const G = (u, p) => call(u, "GET", p); const P = (u, p, b = {}, h) => call(u, "POST", p, b, h);
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TABEL = { sm: "stock_movements", job: "jobs", run: "production_runs_v2", qc: "quality_inspections_v2", jur: "fin_journal_entries", stg: "unit_stage_logs", cust: "unit_custody_handoffs_v2", rsv: "material_reservations_v2", mi: "material_issues", op: "production_operation_runs_v2", rec: "unit_workshop_receipts", outbox: "domain_outbox", plan: "production_run_plans_v2" };
const efek = async () => Object.fromEntries(await Promise.all(Object.entries(TABEL).map(async ([k, t]) => [k, await n(`select count(*)::int n from ${t}`)])));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let seq = 0; const idem = (t) => ({ "Idempotency-Key": `rh-rjm-${t}-${Date.now().toString(36)}-${++seq}-${Math.floor(Math.random() * 1e6)}-aaaa` });
const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay(); const add = (k, d) => new Date(new Date(`${k}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10);
const HARI0 = (() => { let k = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); while (dow(k) === 0) k = add(k, 1); return k; })();
const HK = (nn) => { let k = HARI0; let c = 0; while (c < nn) { k = add(k, 1); if (dow(k) !== 0) c += 1; } return k; };
const MINGGU = (() => { let k = add(HARI0, 1); while (dow(k) !== 0) k = add(k, 1); return k; })();
const awalUnit = await n("select count(*)::int n from units");
cek("klon rehearsal memuat data production nyata (unit + pergerakan stok)", awalUnit > 0 && (await n("select count(*)::int n from stock_movements")) > 0, `unit=${awalUnit}`);
cek("tabel jadwal di klon kosong sebelum skenario (migrasi tanpa backfill)", (await n("select count(*)::int n from production_unit_schedules")) === 0 && (await n("select count(*)::int n from production_unit_schedule_events")) === 0);

// data sintetis (di KLON)
const RUN = Date.now();
let lokA = await prisma.storageLocation.findFirst({ where: { active: true, locationType: { in: ["RECEIVING_AREA", "WIP_AREA"] } }, orderBy: { code: "asc" } });
if (!lokA) { const wh = await prisma.warehouse.create({ data: { code: `RH-WH-${RUN % 1e6}`, name: "Rehearsal Gudang" } }); lokA = await prisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "RH-A", locationType: "RECEIVING_AREA", code: `RH-RJM-A-${RUN % 1e6}` } }); }
async function mk(tag, { status = "PROCESSING", unitStatus = "RECEIVED", diterima = false } = {}) {
  const cust = await prisma.customer.create({ data: { name: `Rehearsal ${tag} ${RUN}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await prisma.order.create({ data: { customerId: cust.id, orderNumber: `RH-RJM-${tag}-${RUN % 1e7}`, value: 100, category: "LAYANAN", status, pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 100, sortOrder: 1 }] } } });
  const unit = await prisma.unit.create({ data: { unitCode: `RH-RJM-${tag}-U${RUN % 1e6}`, orderId: order.id, seq: 1, status: unitStatus, merk: "Rehearsal", ukuran: "160x200" } });
  const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  if (diterima) await prisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: 1, locationId: lokA.id, receivedById: U.G.user.id } });
  return { cust, order, unit };
}
const jad = (u, k, b = {}, h) => P(u, `${PR}/units/${k.unit.id}/jadwal`, { productionDate: HK(2), stationCode: "TABLE_1", expectedRevision: 0, ...b }, h ?? idem("jdw"));
const K1 = await mk("K1"); const K2 = await mk("K2", { diterima: true }); const K3 = await mk("K3", { diterima: true }); const K4 = await mk("K4", { diterima: true }); const K5 = await mk("K5", { diterima: true }); const K6 = await mk("K6", { diterima: true }); const KV = await mk("KV", { diterima: true }); const KL = await mk("KL", { diterima: true });
const mingguView = async (start) => (await G(U.A, `${PR}/rencana/minggu?start=${start}`)).body;

// ── 1. kalender: aturan hari kerja ──
const m0 = await mingguView(HARI0);
cek("SINTETIS: kalender minggu 72 slot (Senin–Sabtu 12/hari; Minggu libur kapasitas 0; ringkasan konsisten)", m0.kapasitas.totalMinggu === 72 && m0.ringkasan.slotKerja === 72 && m0.days.length === 7 && m0.days.filter((d) => !d.hariKerja).every((d) => d.kapasitas === 0 && d.libur) && m0.days.filter((d) => d.hariKerja).every((d) => d.kapasitas === 12) && m0.ringkasan.hariKerja === 6, JSON.stringify(m0.ringkasan));
cek("SINTETIS: hari Minggu ditolak untuk Rencana Admin (422 JADWAL_HARI_LIBUR) tanpa menulis", await (async () => { const e0 = await efek(); const r = await jad(U.A, K1, { productionDate: MINGGU }); return r.status === 422 && r.body?.code === "JADWAL_HARI_LIBUR" && same(e0, await efek()) && (await n("select count(*)::int n from production_unit_schedules")) === 0; })());

// ── 2. jadwal Admin pada unit BELUM diterima: tanpa Run dan tanpa efek operasional ──
const e0 = await efek();
const r1 = await jad(U.A, K1, { stationCode: "TABLE_2", targetDate: HK(4), priority: "HIGH" });
cek("SINTETIS: jadwal Admin unit belum diterima: 201, satu baris + riwayat, status unit tidak berubah", r1.status === 201 && r1.body.revision === 1 && (await n(`select count(*)::int n from production_unit_schedules where unit_id = '${K1.unit.id}'`)) === 1 && (await prisma.unit.findUnique({ where: { id: K1.unit.id } })).status === "RECEIVED" && (await G(U.A, `${PR}/units/${K1.unit.id}/jadwal`)).body.events.length === 1, JSON.stringify(r1.body).slice(0, 120));
const e1 = await efek();
cek("SINTETIS: jadwal Admin TIDAK membuka Run/tahap/QC/custody/penerimaan/stok/Material Issue/jurnal/job/outbox/rencana Meja dan tidak ada pesan pelanggan", same(e0, e1) && pesan.length === 0, JSON.stringify(e1));
const hr = (await G(U.A, `${PR}/rencana/hari?date=${HK(2)}`)).body; const it1 = hr.stations.find((s) => s.code === "TABLE_2")?.items.find((i) => i.unitId === K1.unit.id);
cek("SINTETIS: kalender menandai unit belum diterima secara jujur dan berlabel Rencana Admin", it1?.sumber === "ADMIN" && it1.sumberLabel === "Rencana Admin" && it1.diterima === false && it1.targetSelesai === HK(4) && it1.prioritas.key === "HIGH");

// ── 3. klik ganda / serentak / revisi basi ──
const kunci = { "Idempotency-Key": `rh-rjm-ganda-${RUN}-aaaaaaaa` };
const a = await jad(U.A, K2, {}, kunci); const b2 = await jad(U.A, K2, {}, kunci);
cek("SINTETIS: klik ganda (kunci sama) = satu perubahan; kunci sama isian beda ditolak", a.status === 201 && b2.status === 200 && b2.body.replayed === true && (await jad(U.A, K2, { stationCode: "TABLE_3" }, kunci)).body?.code === "IDEMPOTENCY_KEY_REUSED" && (await n(`select count(*)::int n from production_unit_schedule_events where unit_id = '${K2.unit.id}'`)) === 1);
const par = await Promise.all([1, 2, 3].map((i) => jad(U.A, K3, { stationCode: "TABLE_3" }, idem(`par${i}`))));
cek("SINTETIS: permintaan serentak = tepat satu menang, sisanya 409 revisi basi", par.filter((r) => r.status === 201).length === 1 && par.filter((r) => r.status === 409).length === 2 && (await n(`select count(*)::int n from production_unit_schedules where unit_id = '${K3.unit.id}'`)) === 1, par.map((r) => r.status).join());

// ── 4. pindah hari/meja = baris yang sama; kapasitas penuh ──
const pindah = await jad(U.A, K2, { productionDate: HK(3), stationCode: "TABLE_4", expectedRevision: 1 });
cek("SINTETIS: pindah hari/meja memperbarui baris yang sama (revisi naik, tidak menggandakan unit)", pindah.status === 201 && pindah.body.kind === "RESCHEDULED" && pindah.body.revision === 2 && (await n(`select count(*)::int n from production_unit_schedules where unit_id = '${K2.unit.id}'`)) === 1);
const slotPenuh = HK(5);
for (const k of [K4, K5, K6]) await jad(U.A, k, { productionDate: slotPenuh, stationCode: "TABLE_1" });
const penuh = await jad(U.A, KV, { productionDate: slotPenuh, stationCode: "TABLE_1" });
cek("SINTETIS: kapasitas meja penuh: 3 unit per meja, unit ke-4 ditolak 409 PLAN_STATION_FULL", penuh.status === 409 && penuh.body?.code === "PLAN_STATION_FULL" && (await mingguView(slotPenuh)).days.find((d) => d.date === slotPenuh).stations.find((s) => s.code === "TABLE_1").count >= 3);

// ── 5. undo ──
const rw = (await G(U.A, `${PR}/units/${K2.unit.id}/jadwal`)).body; const evT = rw.events.at(-1);
const und = await P(U.A, `${PR}/units/${K2.unit.id}/jadwal/undo`, { eventId: evT.id }, idem("undo"));
cek("SINTETIS: undo salah-pindah mengembalikan tanggal+meja, tercatat UNDONE; undo ulang ditolak; riwayat tidak dihapus", evT.undoable === true && und.status === 201 && und.body.productionDate === HK(2) && und.body.stationCode === "TABLE_1" && (await P(U.A, `${PR}/units/${K2.unit.id}/jadwal/undo`, { eventId: evT.id }, idem("undo2"))).status === 409 && (await G(U.A, `${PR}/units/${K2.unit.id}/jadwal`)).body.events.length === 3);

// ── 6. antrean per tindakan ──
const ant = (await G(U.A, `${PR}/rencana/antrean?tab=SEMUA&pageSize=100`)).body;
cek("SINTETIS: antrean per tindakan: tab saling lepas, unit terjadwal masuk Terjadwal, setiap kartu beralasan", ["SIAP", "KEPUTUSAN", "MENUNGGU_TIBA", "TERJADWAL"].reduce((s, t) => s + ant.counts[t], 0) === ant.counts.SEMUA && ant.counts.TERJADWAL >= 5 && ant.items.every((i) => i.alasan && i.bahan?.key));

// ── 7. izin ──
cek("SINTETIS: akun hanya-lihat (Sales) boleh membaca tetapi tidak menjadwalkan/undo/keluarkan (403)", (await G(U.S, `${PR}/rencana/minggu`)).status === 200 && (await jad(U.S, K1, { expectedRevision: 1 })).status === 403 && (await P(U.S, `${PR}/units/${K1.unit.id}/jadwal/keluarkan`, { expectedRevision: 1 }, idem("s"))).status === 403 && (await G(U.S, `${PR}/rencana/minggu`)).body.izin.jadwalkan === false);

// ── 8. aktivasi Meja mengambil alih jadwal Admin (satu sumber kebenaran) + unit milik Meja ditolak ──
const wc = await prisma.workCenter.create({ data: { code: `RH-WC-${RUN % 1e6}`, name: "Rehearsal Workshop" } });
const opU = await pengguna("operator-o", ["PRODUCTION_WORKER"]); const op = await prisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: opU.user.id, primaryWorkCenterId: wc.id, active: true } });
for (const kf of ["production_v2_writer", "production_v2_reader"]) {
  const f = await prisma.v2FeatureFlag.findUnique({ where: { key: kf } }); const ids = [...new Set([...(f?.config?.unitIds ?? []), KL.unit.id])]; // cohort = unit LAIN; unit yang diuji belum diaktifkan
  const d = { enabled: true, scope: "GLOBAL", config: { ...(f?.config ?? {}), unitIds: ids }, reason: "rehearsal klon" };
  await prisma.v2FeatureFlag.upsert({ where: { key: kf }, create: { key: kf, ...d }, update: d });
}
const runSebelum = await n("select count(*)::int n from production_runs_v2");
const akt = await P(U.A, `${V2}/plans`, { unitId: K3.unit.id, productionDate: HK(3), stationCode: "TABLE_2", priority: 0, workCenterId: wc.id, operatorId: op.id, activateUnit: true }, idem("akt"));
const sch3 = await prisma.productionUnitSchedule.findUnique({ where: { unitId: K3.unit.id } });
cek("SINTETIS: aktivasi Meja mengambil alih jadwal Admin: ADOPTED + event ADOPTED, Run hanya karena aktivasi eksplisit, tidak ada dua jadwal", akt.status === 201 && sch3.status === "ADOPTED" && !!sch3.adoptedPlanId && (await n("select count(*)::int n from production_runs_v2")) === runSebelum + 1 && (await n(`select count(*)::int n from production_unit_schedule_events where unit_id = '${K3.unit.id}' and kind = 'ADOPTED'`)) === 1, `${akt.status}`);
const m3 = (await mingguView(HK(3))).days.find((d) => d.date === HK(3));
cek("SINTETIS: unit yang sudah dikelola Meja ditolak dijadwalkan Admin (409 UNIT_V2_OWNED) dan tampil berlabel Pelaksanaan Meja", (await jad(U.A, K3, { expectedRevision: 2 })).body?.code === "UNIT_V2_OWNED" && m3.v2 >= 1 && (await G(U.A, `${PR}/rencana/hari?date=${HK(3)}`)).body.stations.flatMap((s) => s.items).some((i) => i.unitId === K3.unit.id && i.sumber === "V2" && i.sumberLabel === "Pelaksanaan Meja"));

// ── 9. ekspor Excel ──
const ex = await P(U.A, `${V2}/rencana/export`, { from: HK(2), to: HK(5), stations: [], includeUnscheduled: false });
const rA = ex.body?.rows?.find((x) => x.unitCode === K1.unit.unitCode); const rV = ex.body?.rows?.find((x) => x.unitCode === K3.unit.unitCode);
cek("SINTETIS: ekspor Excel memuat Rencana Admin + Pelaksanaan Meja pada satu tabel (tanggal, meja, PIC, status rencana, mode pelaksanaan); baca-saja", ex.status === 200 && ex.body.columns.length === 29 && rA?.sumberJadwal === "Rencana Admin" && rA.modePelaksanaan === "Hanya jadwal (belum dibuka di Meja)" && rA.tanggal === HK(2) && rA.meja === "Meja 2" && rV?.sumberJadwal === "Pelaksanaan Meja" && typeof rA.no === "number", `${ex.status} ${rA?.sumberJadwal}/${rV?.sumberJadwal}`);

// ── 10. keluarkan ──
cek("SINTETIS: keluarkan dari jadwal = status CLEARED (riwayat tetap), tidak tampil di kalender", (await P(U.A, `${PR}/units/${K1.unit.id}/jadwal/keluarkan`, { expectedRevision: 1 }, idem("kel"))).status === 201 && (await prisma.productionUnitSchedule.findUnique({ where: { unitId: K1.unit.id } })).status === "CLEARED" && !(await G(U.A, `${PR}/rencana/hari?date=${HK(2)}`)).body.stations.flatMap((s) => s.items).some((i) => i.unitId === K1.unit.id));

// ── 10b. komponen LAMA dari unit pelanggan (BUKAN stok) ──
{
  const KK = await mk("KK", { diterima: true }); const KX = await mk("KX", { diterima: true });
  const body = { name: "Pegas bongkaran sisi kiri", qty: 12, uom: "PCS", condition: "Bagus", workPart: "Rangka pegas bawah", outcome: "REUSED" };
  const kp = (u, b, k, m = "") => P(U.A, `${PR}/units/${u.unit.id}/komponen-lama${m}`, b, { "Idempotency-Key": k });
  const eK0 = await efek(); const smK = await n("select count(*)::int n from stock_movements"); const saldoK = (await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float8 s from stock_movements"))[0].s; const valK = await n("select count(*)::int n from fin_stock_movement_valuations");
  const kunciK = `rh-rjm-komp-${RUN}-aaaaaaaa`; const k1 = await kp(KK, body, kunciK); const k1b = await kp(KK, body, kunciK);
  cek("SINTETIS: komponen lama dari unit ini: 201, klik ganda (kunci sama) = SATU baris, kunci sama isian beda ditolak 409", k1.status === 201 && k1b.status === 200 && (await kp(KK, { ...body, qty: 99 }, kunciK)).status === 409 && (await n(`select count(*)::int n from unit_component_reuse_entries where unit_id = '${KK.unit.id}'`)) === 1, `${k1.status}/${k1b.status}`);
  cek("SINTETIS: komponen lama TIDAK mengubah saldo, pergerakan stok, Material Issue, reservasi, jurnal, job, penilaian biaya, atau pesan", same(eK0, await efek()) && (await n("select count(*)::int n from stock_movements")) === smK && (await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float8 s from stock_movements"))[0].s === saldoK && (await n("select count(*)::int n from fin_stock_movement_valuations")) === valK && pesan.length === 0);
  const itemId = k1.body.item.itemId;
  const kr = await kp(KK, { expectedVersion: 1, data: { ...body, qty: 10 }, reason: "Salah hitung, seharusnya 10" }, `rh-rjm-kor-${RUN}-aaaaaaaa`, `/${itemId}/koreksi`);
  const kb = await kp(KK, { expectedVersion: 2, reason: "Ternyata tidak jadi dipakai" }, `rh-rjm-bat-${RUN}-aaaaaaaa`, `/${itemId}/batal`);
  const bar = await prisma.$queryRawUnsafe(`select version, kind from unit_component_reuse_entries where item_id = '${itemId}' order by version`);
  cek("SINTETIS: koreksi + batal berjejak: versi 1 CREATED → 2 CORRECTED → 3 VOIDED, riwayat tidak dihapus; koreksi dengan versi basi ditolak", kr.status === 201 && kb.status === 201 && JSON.stringify(bar.map((x) => [x.version, x.kind])) === JSON.stringify([[1, "CREATED"], [2, "CORRECTED"], [3, "VOIDED"]]) && (await kp(KK, { expectedVersion: 1, data: body, reason: "basi" }, `rh-rjm-basi-${RUN}-aaaaaaaa`, `/${itemId}/koreksi`)).status === 409);
  const kerjaDari = async (u) => (await G(U.A, `${PR}/units/${u.unit.id}/adopsi`)).body.adopsi.kerja; const KD = await mk("KD", { diterima: true });
  await kp(KD, { ...body, outcome: "DISCARDED", workPart: "" }, `rh-rjm-kd-${RUN}-aaaaaaaa`); const kK = await kerjaDari(KK); const kD = await kerjaDari(KD);
  cek("SINTETIS: status kerja otomatis — komponen 'dipakai kembali' = Sudah dikerjakan tanpa jadwal (tetap walau dibatalkan, fakta historis); 'dibuang' tidak mengubah; tanpa jadwal fiktif", kK.key === "DIKERJAKAN" && kK.label === "Sudah dikerjakan" && kK.source === "PEMAKAIAN_BAHAN" && kK.faktaJadwal === "Dikerjakan tanpa jadwal" && kD.key === "BELUM_DIJADWALKAN" && (await n(`select count(*)::int n from production_unit_schedules where unit_id in ('${KK.unit.id}','${KD.unit.id}')`)) === 0 && (await n(`select count(*)::int n from production_unit_work_progress where unit_id in ('${KK.unit.id}','${KD.unit.id}')`)) === 0);
  const lintas = await kp(KX, { reason: "lintas unit", expectedVersion: 1 }, `rh-rjm-lin-${RUN}-aaaaaaaa`, `/${itemId}/batal`);
  cek("SINTETIS: tanpa lintas unit — komponen unit lain tidak dapat diubah lewat unit ini (404) dan parameter unit asal tidak ada jalurnya", lintas.status === 404 && (await kp(KX, { ...body, unitAsalId: KK.unit.id, source: "OTHER_UNIT" }, `rh-rjm-asl-${RUN}-aaaaaaaa`)).status === 201 && (await n(`select count(*)::int n from unit_component_reuse_entries where unit_id = '${KX.unit.id}' and source = 'OWN_UNIT'`)) === 1);
  cek("SINTETIS: dilepas tanpa dipakai (dibuang/dikembalikan/disimpan) bukan pemakaian; total terpisah dari bahan baru", await (async () => { const a = await kp(KX, { name: "Webbing rusak", qty: 3, uom: "METER", condition: "Robek", outcome: "DISCARDED" }, `rh-rjm-bwg-${RUN}-aaaaaaaa`); const g = (await G(U.A, `${PR}/units/${KX.unit.id}/komponen-lama`)).body; return a.status === 201 && g.total.pemakaianKembali.jumlahItem === 1 && g.total.dilepasTidakDipakai.dibuang === 1 && (await G(U.A, `${PR}/units/${KX.unit.id}/adopsi`)).body.pemakaianAktual.baris.length === 0; })());
  cek("SINTETIS: akun hanya-lihat (Sales) membaca komponen lama tetapi tidak mencatat (403)", (await G(U.S, `${PR}/units/${KX.unit.id}/komponen-lama`)).status === 200 && (await P(U.S, `${PR}/units/${KX.unit.id}/komponen-lama`, body, { "Idempotency-Key": `rh-rjm-sal-${RUN}-aaaaaaaa` })).status === 403);
}

// ── 11. data NYATA (di klon): unit sungguhan dijadwalkan lalu dibatalkan; data lain tidak berubah ──
const nyata = (await G(U.A, `${PR}/rencana/antrean?tab=SIAP&pageSize=100`)).body.items.find((i) => !String(i.unitCode).startsWith("RH-RJM") && !i.v2 && i.jalur === "ADMIN" && i.revisiJadwal === 0);
if (nyata) {
  const e2 = await efek(); const rN = await P(U.A, `${PR}/units/${nyata.unitId}/jadwal`, { productionDate: HK(6), stationCode: "TABLE_4", expectedRevision: 0 }, idem("nyata")); const ePas = await efek();
  cek(`DATA NYATA (klon): unit ${nyata.unitCode} dijadwalkan Admin tanpa Run/stok/job/jurnal/penerimaan; terbaca di Status Produksi + Order Produksi`, rN.status === 201 && same(e2, ePas) && (await G(U.A, `${PR}/units/${nyata.unitId}/adopsi`)).body.adopsi.jadwal?.sumber === "ADMIN", `${rN.status}`);
  const kN = await P(U.A, `${PR}/units/${nyata.unitId}/jadwal/keluarkan`, { expectedRevision: 1 }, idem("nyata2"));
  cek("DATA NYATA (klon): unit nyata dikeluarkan lagi; antrean mengembalikannya ke Siap/Menunggu tanpa mengubah data unit", kN.status === 201 && same(e2, await efek()));
} else console.log("INFO tidak ada unit nyata yang cocok untuk pemeriksaan data nyata di klon (dilewati)");
console.log(`INFO klon: unit=${await n("select count(*)::int n from units")} jadwal=${await n("select count(*)::int n from production_unit_schedules")} riwayat=${await n("select count(*)::int n from production_unit_schedule_events")}`);
console.log(`RH_SKENARIO gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
