// REHEARSAL PENUH Status Produksi + Penerimaan Workshop — dijalankan DI DALAM container image kandidat terhadap KLON DB rehearsal (hasil restore backup production, SUDAH dimigrasi). TIDAK pernah menyentuh database production.
// Server yang dipakai adalah app Express MINIMAL (buildTestApp: router asli tanpa cron/worker/WAHA/Socket.IO) — TIDAK memuat src/index.js, jadi tidak ada pesan WhatsApp, job, atau efek samping luar.
// Pengiriman pesan pelanggan dicegat oleh transport uji (ujiNotifikasi.transport): tidak ada pesan yang pernah dikirim.
// Pagar: nama database WAJIB mengandung "test" (tests/integration/setup/env.js); skrip rilis menamai DB rehearsal rehearsal_spp_test_*.
// FASE (env FASE): smoke | skenario
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
await import("/app/tests/integration/setup/env.js");
const { prisma } = await import("/app/src/db.js");
const { buildTestApp, startTestServer } = await import("/app/tests/integration/setup/testApp.js");
const FASE = process.env.FASE || "skenario";
const PR = "/api/production"; const V2 = "/api/production-v2";
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d !== "" ? " — " + String(d).slice(0, 240) : ""}`); };
const sv = await startTestServer(buildTestApp()); const base = sv.baseUrl;

// FASE smoke = BACA-SAJA murni: TIDAK membuat pengguna rehearsal atau baris apa pun di DB (pengguna dibuat hanya pada fase skenario, di klon).
if (FASE === "smoke") {
  const kode = await new Promise((res) => { const c = spawn(process.execPath, ["/rh/smoke-status-produksi-penerimaan.mjs"], { env: { ...process.env, SMOKE_BASE: base }, stdio: "inherit" }); c.on("exit", res); });
  console.log(`RH_SMOKE kode=${kode}`); await sv.close(); process.exit(kode === 0 ? 0 : 1);
}

async function pengguna(nama, roles) {
  const email = `rh-${nama}@rehearsal.invalid`; let u = await prisma.user.findUnique({ where: { email } });
  if (!u) u = await prisma.user.create({ data: { name: `Rehearsal ${nama}`, email, passwordHash: "x", role: roles[0] } });
  for (const r of roles) await prisma.userRole.upsert({ where: { userId_role: { userId: u.id, role: r } }, update: {}, create: { userId: u.id, role: r } }).catch(() => {});
  return { user: u, token: jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "6h" }) };
}
const U = { A: await pengguna("admin-a", ["ADMIN"]), G: await pengguna("gudang-g", ["WAREHOUSE"]), G2: await pengguna("gudang-h", ["WAREHOUSE"]), S: await pengguna("sales-s", ["SALES"]), L: await pengguna("lead-l", ["PRODUCTION_LEAD"]) };
async function call(u, method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j, headers: r.headers };
}
const G = (u, p) => call(u, "GET", p); const P = (u, p, b = {}, h) => call(u, "POST", p, b, h); const PA = (u, p, b) => call(u, "PATCH", p, b);
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TABEL = { sm: "stock_movements", job: "jobs", run: "production_runs_v2", qc: "quality_inspections_v2", jur: "fin_journal_entries", stg: "unit_stage_logs", cust: "unit_custody_handoffs_v2", rsv: "material_reservations_v2", mi: "material_issues", op: "production_operation_runs_v2" };
const efek = async () => Object.fromEntries(await Promise.all(Object.entries(TABEL).map(async ([k, t]) => [k, await n(`select count(*)::int n from ${t}`)])));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const idem = (t) => ({ "Idempotency-Key": `rh-spp-${t}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}-aaaa` });

// ═════════ SKENARIO (menulis ke KLON DB rehearsal; dibuang di akhir) ═════════
const jumlahUnit0 = await n("select count(*)::int n from units");
cek("klon rehearsal memuat data production nyata (unit + pergerakan stok)", jumlahUnit0 > 0 && (await n("select count(*)::int n from stock_movements")) > 0, `unit=${jumlahUnit0}`);
cek("tabel penerimaan di klon kosong sebelum skenario (migrasi tanpa backfill)", (await n("select count(*)::int n from unit_workshop_receipts")) === 0 && (await n("select count(*)::int n from unit_workshop_receipt_corrections")) === 0);

// lokasi penerimaan: pakai lokasi nyata (Receiving/WIP) bila ada; selain itu sintetis di klon
let lokA = await prisma.storageLocation.findFirst({ where: { active: true, locationType: { in: ["RECEIVING_AREA", "WIP_AREA"] } }, orderBy: { code: "asc" } });
const gudangAda = lokA ? null : await prisma.warehouse.create({ data: { code: `RH-WH-${Date.now() % 1e6}`, name: "Rehearsal Gudang" } });
if (!lokA) lokA = await prisma.storageLocation.create({ data: { warehouseId: gudangAda.id, zone: "RH-A", locationType: "RECEIVING_AREA", code: `RH-SPP-A-${Date.now() % 1e6}` } });
const lokB = await prisma.storageLocation.create({ data: { warehouseId: lokA.warehouseId, zone: "RH-B", locationType: "WIP_AREA", code: `RH-SPP-B-${Date.now() % 1e6}` } });
const lokSalah = await prisma.storageLocation.create({ data: { warehouseId: lokA.warehouseId, zone: "RH-X", locationType: "RAW_MATERIAL_AREA", code: `RH-SPP-X-${Date.now() % 1e6}` } });

// data sintetis (di KLON): pelanggan + order + unit + pickup selesai
const RUN = Date.now();
async function mkOrder(tag, { status = "PICKUP", locked = true } = {}) {
  const cust = await prisma.customer.create({ data: { name: `Rehearsal ${tag} ${RUN}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await prisma.order.create({ data: { customerId: cust.id, orderNumber: `RH-SPP-${tag}-${RUN % 1e7}`, value: 100, category: "LAYANAN", status, pickupConfirmedDate: new Date(), ...(locked ? { statusLocked: true, statusOverrideAt: new Date(), statusOverrideNote: "rehearsal manual" } : {}), items: { create: [{ layananName: "Service Fondasi", harga: 100, sortOrder: 1 }] } } });
  const unit = await prisma.unit.create({ data: { unitCode: `RH-SPP-${tag}-U${RUN % 1e6}`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Rehearsal", ukuran: "160x200" } });
  const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await prisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return { cust, order, unit };
}
const K1 = await mkOrder("K1"); const K2 = await mkOrder("K2", { status: "PROCESSING", locked: false }); const K3 = await mkOrder("K3", { status: "PROCESSING", locked: false });
const baris = async (k) => (await G(U.A, `${PR}/work-list?q=${encodeURIComponent(k.order.orderNumber)}`)).body.orders.find((o) => o.orderId === k.order.id);
const terima = (u, k, b = {}, h) => P(u, `${PR}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: lokA.id, ...b }, h);
const kor = (u, k, b) => P(u, `${PR}/units/${k.unit.id}/penerimaan-workshop/koreksi`, b, idem("kor"));

// ── 1. antrean + penolakan + penerimaan biasa tanpa Run ──
let b0 = await baris(K1);
cek("SINTETIS: daftar kerja: unit pickup selesai tampil 'Sudah dijemput', status order Sales Pengambilan terkunci apa adanya", b0?.units[0].posisi.key === "SUDAH_DIJEMPUT" && b0.statusOrder.label === "Pengambilan" && b0.statusOrder.terkunci === true && b0.units[0].alurMeja === null, JSON.stringify(b0?.statusOrder));
cek("SINTETIS: antrean Gudang memuat unit sebelum diterima", (await G(U.G, `${PR}/penerimaan-workshop/menunggu?q=${K1.unit.unitCode}`)).body.units.some((u) => u.unitId === K1.unit.id));
cek("SINTETIS: penerimaan tanpa izin (Sales) ditolak 403", (await terima(U.S, K1)).status === 403);
cek("SINTETIS: penerimaan tanpa pernyataan fisik ditolak 400 (tidak menulis)", (await terima(U.G, K1, { fisikDiterima: false })).status === 400);
cek("SINTETIS: lokasi bukan area penerimaan ditolak 422", (await terima(U.G, K1, { locationId: lokSalah.id })).status === 422);
const e0 = await efek();
const par = await Promise.all([1, 2, 3].map(() => terima(U.G, K1, { note: "rehearsal" })));
cek("SINTETIS: klik ganda/serentak = SATU penerimaan (satu 201, sisanya idempoten)", par.filter((r) => r.status === 201).length === 1 && par.every((r) => [200, 201].includes(r.status)) && (await n(`select count(*)::int n from unit_workshop_receipts where unit_id = '${K1.unit.id}'`)) === 1, par.map((r) => r.status).join(","));
cek("SINTETIS: penerimaan biasa TIDAK membuka Run/serah-terima/stok/job/jurnal/QC/tahap/reservasi", same(e0, await efek()), JSON.stringify(await efek()));
const rc = await prisma.unitWorkshopReceipt.findFirst({ where: { unitId: K1.unit.id } });
cek("SINTETIS: penerimaan tercatat dengan pelaku, waktu, lokasi; status unit tidak berubah", rc?.receivedById === U.G.user.id && rc.locationId === lokA.id && Math.abs(Date.now() - rc.receivedAt.getTime()) < 120_000 && (await prisma.unit.findUnique({ where: { id: K1.unit.id } })).status === "RECEIVED");
b0 = await baris(K1);
cek("SINTETIS: daftar kerja sesudah diterima: Di workshop, Tahap Meja tidak dikarang, perhatian = status Sales masih Pengambilan", b0.units[0].posisi.key === "DI_WORKSHOP" && b0.units[0].alurMeja === null && b0.ringkas.perhatian.kode === "ORDER_MASIH_PENGAMBILAN", `${b0.units[0].posisi.key} ${b0.ringkas.perhatian?.kode}`);
const ad = (await G(U.A, `${PR}/units/${K1.unit.id}/adopsi`)).body;
cek("SINTETIS: panel unit: tindakan Ubah status order ke Diproses + penyebab 'dikunci manual' + penerimaan dengan nama pelaku", ad.adopsi.tindakan.aksi === "UBAH_ORDER_DIPROSES" && /dikunci manual/.test(ad.adopsi.penghalang?.teks ?? "") && ad.penerimaan?.receivedBy?.name === "Rehearsal gudang-g");
cek("STATUS ORDER dari Produksi: PATCH ke Diproses lewat jalur Sales (catatan tersimpan, tanpa job/Run)", await (async () => { const eb = await efek(); const r = await PA(U.A, `/api/orders/${K1.order.id}`, { status: "PROCESSING", statusOverrideNote: "rehearsal: unit sudah diterima" }); const o = await prisma.order.findUnique({ where: { id: K1.order.id } }); return r.status === 200 && o.status === "PROCESSING" && o.statusOverrideNote === "rehearsal: unit sudah diterima" && same(eb, await efek()); })());
cek("SINTETIS: Sales melihat status order yang SAMA di daftar kerja", (await (async () => { const r = await G(U.S, `${PR}/work-list?q=${encodeURIComponent(K1.order.orderNumber)}`); return r.status === 200 && r.body.orders.find((o) => o.orderId === K1.order.id)?.statusOrder.label === "Diproses"; })()));

// ── 2. koreksi ──
const pre = (await G(U.A, `${PR}/units/${K1.unit.id}/penerimaan-workshop/koreksi`)).body;
cek("SINTETIS: pratinjau koreksi: revisi 0, kedua jenis boleh, tanpa dampak yang menghalangi", pre.revisi === 0 && pre.boleh.LOCATION === true && pre.boleh.NOT_RECEIVED === true);
cek("SINTETIS: koreksi tanpa alasan ditolak 400; revisi basi ditolak 409", (await kor(U.G, K1, { jenis: "LOCATION", locationId: lokB.id, alasan: " ", expectedRevisi: 0 })).status === 400 && (await kor(U.G, K1, { jenis: "LOCATION", locationId: lokB.id, alasan: "uji basi", expectedRevisi: 5 })).status === 409);
const k1 = await P(U.G2, `${PR}/units/${K1.unit.id}/penerimaan-workshop/koreksi`, { jenis: "LOCATION", locationId: lokB.id, alasan: "Rehearsal: salah letak", expectedRevisi: 0 }, { "Idempotency-Key": `rh-spp-lokasi-${RUN}-0001` });
const k1b = await P(U.G2, `${PR}/units/${K1.unit.id}/penerimaan-workshop/koreksi`, { jenis: "LOCATION", locationId: lokB.id, alasan: "Rehearsal: salah letak", expectedRevisi: 0 }, { "Idempotency-Key": `rh-spp-lokasi-${RUN}-0001` });
const cr = await prisma.unitWorkshopReceiptCorrection.findMany({ where: { unitId: K1.unit.id } });
cek("SINTETIS: koreksi lokasi menyimpan pelaku, alasan, nilai lama + baru; klik ganda (kunci sama) = satu baris; catatan asli utuh", k1.status === 201 && k1b.status === 200 && cr.length === 1 && cr[0].actorId === U.G2.user.id && cr[0].oldValue.locationId === lokA.id && cr[0].newValue.locationId === lokB.id && (await prisma.unitWorkshopReceipt.findFirst({ where: { unitId: K1.unit.id } })).locationId === lokA.id);
cek("SINTETIS: koreksi 'belum diterima fisik' oleh Gudang ditolak 403; Admin boleh → unit kembali ke antrean + KPI kosong", await (async () => {
  const g = await kor(U.G, K1, { jenis: "NOT_RECEIVED", alasan: "Rehearsal: belum sampai", expectedRevisi: 1 }); const a = await kor(U.A, K1, { jenis: "NOT_RECEIVED", alasan: "Rehearsal: belum sampai", expectedRevisi: 1 });
  const antre = (await G(U.G, `${PR}/penerimaan-workshop/menunggu?q=${K1.unit.unitCode}`)).body.units.some((u) => u.unitId === K1.unit.id); const bb = await baris(K1);
  return g.status === 403 && a.status === 201 && antre && bb.units[0].posisi.key === "SUDAH_DIJEMPUT";
})());
cek("SINTETIS: penerimaan ulang sesudah koreksi = penerimaan kedua (seq 2); catatan lama tetap tersimpan", await (async () => { const r = await terima(U.G2, K1, { locationId: lokB.id }); const rs = await prisma.unitWorkshopReceipt.findMany({ where: { unitId: K1.unit.id }, orderBy: { seq: "asc" } }); return r.status === 201 && rs.map((x) => x.seq).join() === "1,2"; })());
cek("SINTETIS: riwayat penerimaan append-only di database (ubah/hapus ditolak trigger)", await (async () => { let a = false; let b2 = false; try { await prisma.unitWorkshopReceipt.updateMany({ where: { unitId: K1.unit.id }, data: { note: "ubah" } }); } catch { a = true; } try { await prisma.unitWorkshopReceiptCorrection.deleteMany({ where: { unitId: K1.unit.id } }); } catch { b2 = true; } return a && b2; })());

// ── 3. aktivasi V2 sesudah penerimaan: satu penerimaan, tanpa 'Unit Tiba' ganda ──
const wc = await prisma.workCenter.create({ data: { code: `RH-WC-${RUN % 1e6}`, name: "Rehearsal Workshop" } });
const opU = await pengguna("operator-o", ["PRODUCTION_WORKER"]); const op = await prisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: opU.user.id, primaryWorkCenterId: wc.id, active: true } });
const KLAIN = await mkOrder("KL", { status: "PROCESSING", locked: false });
for (const kf of ["production_v2_writer", "production_v2_reader"]) {
  const f = await prisma.v2FeatureFlag.findUnique({ where: { key: kf } }); const ids = [...new Set([...(f?.config?.unitIds ?? []), KLAIN.unit.id])]; // cohort = unit LAIN (seperti production: hanya canary); K2 yang diuji BELUM diaktifkan
  const d = { enabled: true, scope: "GLOBAL", config: { ...(f?.config ?? {}), unitIds: ids }, reason: "rehearsal klon" };
  await prisma.v2FeatureFlag.upsert({ where: { key: kf }, create: { key: kf, ...d }, update: d });
}
cek("SINTETIS: penerimaan unit K2 (di cohort Produksi V2) tanpa Run", (await terima(U.G, K2)).status === 201 && (await n(`select count(*)::int n from production_runs_v2 where unit_id = '${K2.unit.id}'`)) === 0);
const tgl = new Date(Date.now() + 6 * 864e5 + 7 * 3600e3).toISOString().slice(0, 10);
const akt = await P(U.A, `${V2}/plans`, { unitId: K2.unit.id, productionDate: tgl, stationCode: "TABLE_1", priority: 0, workCenterId: wc.id, operatorId: op.id, activateUnit: true }, idem("akt"));
const runK2 = await prisma.productionRun.findFirst({ where: { unitId: K2.unit.id } });
cek("SINTETIS: aktivasi V2 sesudah penerimaan: Run langsung ACTIVE; TEPAT satu penerimaan, satu serah-terima, satu peristiwa 'diterima di workshop'", akt.status === 201 && runK2?.status === "ACTIVE" && (await n(`select count(*)::int n from unit_workshop_receipts where unit_id = '${K2.unit.id}'`)) === 1 && (await n(`select count(*)::int n from unit_custody_handoffs_v2 where unit_id = '${K2.unit.id}'`)) === 1 && (await n(`select count(*)::int n from domain_outbox where aggregate_id = '${K2.unit.id}' and event_type = 'production.unit.received-workshop'`)) === 1, `${akt.status} ${JSON.stringify(akt.body).slice(0, 100)}`);
cek("SINTETIS: 'Unit Tiba' dan klik ulang Catat diterima sesudah aktivasi tidak menggandakan penerimaan", (await P(U.L, `${V2}/units/${K2.unit.id}/confirm-arrival`, {}, idem("tiba"))).status >= 400 && (await terima(U.G, K2)).body?.alreadyReceived === true && (await n(`select count(*)::int n from unit_custody_handoffs_v2 where unit_id = '${K2.unit.id}'`)) === 1);
const bk = await kor(U.A, K2, { jenis: "NOT_RECEIVED", alasan: "Rehearsal: coba batal", expectedRevisi: 0 });
cek("SINTETIS: 'belum diterima' pada unit yang sudah punya pekerjaan DITOLAK 409 KOREKSI_PERLU_JALUR_RESMI dengan daftar dampak; Run tidak dibalik", bk.status === 409 && bk.body?.code === "KOREKSI_PERLU_JALUR_RESMI" && Array.isArray(bk.body?.detail?.dampak) && (await prisma.productionRun.findFirst({ where: { unitId: K2.unit.id } }))?.status === "ACTIVE");
const lokK = await kor(U.G, K2, { jenis: "LOCATION", locationId: lokB.id, alasan: "Rehearsal: koreksi lokasi sesudah aktivasi", expectedRevisi: 0 });
const hoK = await prisma.unitCustodyHandoff.findFirst({ where: { unitId: K2.unit.id } });
cek("SINTETIS: koreksi lokasi sesudah aktivasi mengoreksi lokasi serah-terima lewat penulis custody; status handoff/Run tidak berubah", lokK.status === 201 && hoK.locationId === lokB.id && hoK.status === "ACCEPTED");
const bj = await baris(K2);
cek("SINTETIS: daftar kerja: unit K2 tampil Tahap Meja dari Run nyata (bukan dikarang) dan Di workshop", bj.units[0].alurMeja?.status === "ACTIVE" && bj.units[0].posisi.key === "DI_WORKSHOP");

// ── 4. dokumentasi dari ruang kerja: bukti DOC, tanpa tahap/QC/serah ──
const rkK2 = (await G(U.A, `${PR}/units/${K2.unit.id}/ruang-kerja`)).body;
cek("SINTETIS: ruang kerja unit alur Meja: dokumentasi tersedia + boleh unggah (Admin)", rkK2.dokumentasi?.tersedia === true && rkK2.dokumentasi?.bolehUnggah === true && !!rkK2.dokumentasi.runId);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const fd = new FormData(); fd.append("runId", rkK2.dokumentasi.runId); fd.append("files", new Blob([png], { type: "image/png" }), "rehearsal.png");
const up = await fetch(base + `${V2}/documentation/upload`, { method: "POST", headers: { Authorization: "Bearer " + U.A.token }, body: fd }); const upj = await up.json().catch(() => ({}));
const ev0 = await n("select count(*)::int n from production_step_evidence_v2"); const e1 = await efek();
const sub = await P(U.A, `${V2}/documentation/runs/${rkK2.dokumentasi.runId}/submit`, { category: "INITIAL_CONDITION", items: (upj.items ?? []).map((i, ix) => ({ url: i.url, order: ix + 1 })) }, idem("dok"));
cek("SINTETIS: dokumentasi Admin tercatat sebagai bukti DOC; TIDAK menyelesaikan tahap, meluluskan QC, atau membuat serah Gudang", up.status === 201 && sub.status === 201 && (await n("select count(*)::int n from production_step_evidence_v2")) === ev0 + 1 && (await n("select count(*)::int n from quality_inspections_v2")) === e1.qc && (await n("select count(*)::int n from unit_stage_logs")) === e1.stg && (await n("select count(*)::int n from unit_custody_handoffs_v2")) === e1.cust, `${up.status} ${sub.status}`);

// ── 5. notifikasi pelanggan: saklar OFF/ON tanpa pesan production ──
const { ujiNotifikasi } = await import("/app/src/services/customerNotifications.js");
const pesan = []; ujiNotifikasi.transport = async (m) => { pesan.push(m); };
const envAsli = process.env.NODE_ENV; process.env.NODE_ENV = "development"; // pengait uji hanya hidup di luar production (dan transport mencegat semuanya)
try {
  ujiNotifikasi.paksaAktif = false; const K4 = await mkOrder("K4", { status: "PROCESSING", locked: false }); await terima(U.G, K4); await tidur(250);
  cek("SINTETIS: notifikasi OFF → tidak ada pesan pelanggan untuk penerimaan", pesan.length === 0);
  ujiNotifikasi.paksaAktif = true; await terima(U.G, K3); await tidur(300); await terima(U.G, K3); await tidur(250);
  cek("SINTETIS: notifikasi ON → SATU pesan faktual 'sudah kami terima di workshop' (transport uji; tidak ke WhatsApp); klik ulang tidak mengirim lagi", pesan.length === 1 && /sudah kami terima di workshop Sano Care/.test(pesan[0].text) && !/sampai dengan selamat|segera mulai/.test(pesan[0].text), pesan[0]?.text?.slice(0, 80));
  const sebelum = pesan.length; await kor(U.G, K3, { jenis: "LOCATION", locationId: lokB.id, alasan: "Rehearsal koreksi notif", expectedRevisi: 0 }); await tidur(250);
  cek("SINTETIS: koreksi tidak mengirim pesan pelanggan", pesan.length === sebelum);
  process.env.NODE_ENV = "production"; const K5 = await mkOrder("K5", { status: "PROCESSING", locked: false }); await terima(U.G, K5); await tidur(250);
  cek("SINTETIS: NODE_ENV=production mengabaikan pengait uji (flag asli OFF berlaku; tidak ada pesan)", pesan.length === sebelum);
} finally { process.env.NODE_ENV = envAsli; ujiNotifikasi.paksaAktif = null; ujiNotifikasi.transport = null; }

// ── 6. ekspor + data NYATA (di klon) ──
const ex = await fetch(base + `${PR}/work-orders/export.xlsx`, { headers: { Authorization: "Bearer " + U.A.token } });
let xlsxOk = false; try { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer())); const ws = wb.getWorksheet("Ringkasan Unit"); const kol = ws.getRow(1).values.slice(1); const ic = kol.indexOf("Kode Unit"); xlsxOk = ex.status === 200 && ws.getColumn(ic + 1).values.some((v) => v === K1.unit.unitCode); } catch { /* gagal baca */ }
cek("SINTETIS: ekspor xlsx memuat unit ini (konsisten dengan daftar)", xlsxOk);
const nyataList = (await G(U.A, `${PR}/work-list?pageSize=100&filter=BELUM_DITERIMA`)).body;
const nyata = nyataList.orders.flatMap((o) => o.units.map((u) => ({ o, u }))).find(({ o, u }) => !String(u.unitCode).startsWith("RH-SPP") && u.posisi.key === "SUDAH_DIJEMPUT" && u.status === "RECEIVED" && !u.alurMeja && !u.inProductionV2);
if (nyata) {
  const e2 = await efek(); const rN = await P(U.G, `${PR}/units/${nyata.u.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: lokA.id }); const ePas = await efek();
  const dN = await G(U.A, `${PR}/work-list?q=${encodeURIComponent(nyata.o.orderNumber)}`); const uN = dN.body.orders.find((o) => o.orderId === nyata.o.orderId)?.units.find((x) => x.id === nyata.u.id);
  cek(`DATA NYATA (klon): penerimaan unit ${nyata.u.unitCode} tanpa Run/stok/job/jurnal; daftar kerja menampilkan Di workshop`, rN.status === 201 && same(e2, ePas) && uN?.posisi.key === "DI_WORKSHOP", `${rN.status} ${uN?.posisi.key}`);
  const kN = await kor(U.A, { unit: nyata.u }, { jenis: "NOT_RECEIVED", alasan: "Rehearsal: batalkan pada klon", expectedRevisi: 0 });
  const uN2 = (await G(U.A, `${PR}/work-list?q=${encodeURIComponent(nyata.o.orderNumber)}`)).body.orders.find((o) => o.orderId === nyata.o.orderId)?.units.find((x) => x.id === nyata.u.id);
  cek(`DATA NYATA (klon): koreksi 'belum diterima' mengembalikan unit ke Sudah dijemput; catatan asli tetap tersimpan`, kN.status === 201 && uN2?.posisi.key === "SUDAH_DIJEMPUT" && (await n(`select count(*)::int n from unit_workshop_receipts where unit_id = '${nyata.u.id}'`)) === 1, `${kN.status}`);
} else console.log("INFO tidak ada unit nyata berposisi 'Sudah dijemput' tanpa alur Meja di klon (pemeriksaan data nyata dilewati)");
console.log(`INFO klon: unit=${await n("select count(*)::int n from units")} penerimaan=${await n("select count(*)::int n from unit_workshop_receipts")} koreksi=${await n("select count(*)::int n from unit_workshop_receipt_corrections")}`);
console.log(`RH_SKENARIO gagal=${gagal}`);
await sv.close(); await prisma.$disconnect(); process.exit(gagal ? 1 : 0);
