// QA Redesain Gudang — Permintaan bahan → Pengeluaran material → Pemakaian: server backend ASLI (buildTestApp) di atas database SANDBOX terisolasi (nama wajib mengandung "test"), data uji deterministik.
// Semua bahan "SBX-…", unit "SBX-U…" = DATA SANDBOX. Dokumen v1 dibuat lewat createMaterialIssue (kode produksi) lalu diberi status/tanggal; dokumen ISSUED punya pergerakan stok bertaut unit.
// Rute /qa/* hanya ada di server uji ini: /qa/state (bukti DB), /qa/seed-v2 (membangun permintaan V2 lewat HTTP ke backend asli, mengikuti tes integrasi P4).
//   TEST_DATABASE_URL=postgresql://klinik:…@localhost:5432/klinik_matras_test_gudang_mi_qa  JWT_SECRET=… PORT=4481 OUT=C:/tmp/gud-qa/mi node frontend/qa-harness/gudang-mi-server.mjs
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { makeClient } from "../../backend/tests/integration/setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../backend/src/services/finance/accounts.js";
import { createMaterialIssue } from "../../backend/src/routes/materialIssue.js";
import { computeStockSnapshot } from "../../backend/src/services/inventoryLedger.js";
import { V2_FLAGS } from "../../backend/src/services/v2FeatureFlags.js";

const PORT = Number(process.env.PORT || 4481); const OUT = process.env.OUT || "C:/tmp/gud-qa/mi"; const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
const hari = (n) => new Date(Date.now() - n * 86_400_000);

const T = {};
for (const [k, roles, nama] of [["gudang", ["WAREHOUSE"], "Gudang Sandbox"], ["gudang2", ["WAREHOUSE"], "Gudang Dua"], ["owner", ["OWNER"], "Owner Sandbox"], ["finance", ["FINANCE"], "Finance Sandbox"], ["admin", ["ADMIN"], "Admin Sandbox"],
  ["sales", ["SALES"], "Sales Sandbox"], ["lihat", ["PRODUCTION_LEAD"], "Pemimpin Produksi Sandbox"], ["produksi", ["PRODUCTION_WORKER"], "Pekerja Produksi Sandbox"], ["perencana", ["PRODUCTION_LEAD"], "Perencana Sandbox"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles, divisions: k.startsWith("gudang") ? ["WAREHOUSE"] : [] } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));

// ── Bahan
const M = {}; const mk = async (k, kode, name, unit, saldo, extra = {}) => { const m = await createTestMaterial({ code: `SBX-${kode}`, name, unit, itemGroup: extra.itemGroup ?? "BUSA", ...extra }); M[k] = m; if (saldo !== null) await seedBalance(m.id, saldo); return m; };
await mk("busa", "BUSA-A", "Busa HR Foam A", "KG", 100, { vendor: "PT Busa" });
await mk("kain", "KAIN-B", "Kain Oscar B", "METER", 30, { itemGroup: "KAIN" });
await mk("lem", "LEM-C", "Lem Aibon C", "PCS", 3, { itemGroup: "LEM" });
await mk("desimal", "DES-D", "Resin Takaran D", "KG", 0.4, { itemGroup: "LEM" });
await mk("belum", "BELUM-E", "Bahan Belum Ada Catatan E", "PCS", null, { itemGroup: "AKSESORI" });
await mk("perleng", "PERLENG-F", "Perlengkapan Stok F", "PCS", 20, { itemGroup: "AKSESORI", kind: "PERLENGKAPAN_STOK" });
await mk("kayu", "KAYU-G", "Kayu Racuk G", "PCS", 60, { itemGroup: "KAYU" });
for (let i = 1; i <= 18; i++) await mk(`paku${i}`, `PAKU-${String(i).padStart(2, "0")}`, `Paku ${i} cm`, "PACK", 50 + i, { itemGroup: "PAKU" });

// ── Unit & order (V1: tanpa ProductionRun, sehingga pencatatan langsung Produksi diizinkan)
const U = {}; let nOrder = 0;
for (const [k, pel] of [["a", "Pelanggan Satu"], ["b", "Pelanggan Dua"], ["c", "Pelanggan Tiga"], ["d", "Pelanggan Empat"]]) {
  const customer = await testPrisma.customer.create({ data: { name: pel } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `SBX-ORD-${++nOrder}`, value: 1000, category: "LAYANAN" } });
  U[k] = await testPrisma.unit.create({ data: { unitCode: `SBX-U${k.toUpperCase()}1`, orderId: order.id, seq: 1, status: "IN_PRODUCTION" } });
}

// ── Dokumen v1 (variasi status/sumber/prioritas/peminta/tanggal)
const D = {}; const TUA = []; // tanggal dibuat dimundurkan SETELAH semua dokumen dibuat (nomor MI-DDMMYY-NN dihitung dari dokumen hari ini)
async function dok(kunci, { sourceType = "PRODUCTION_WORK_ORDER", unit = null, requester = "gudang", lines, status = "DRAFT", priority = "NORMAL", requiredDate, department, sourceReference, umur = 1, diterbitkan = false, notes }) {
  const d = await createMaterialIssue({ sourceType, unitId: unit ? U[unit].id : undefined, department, sourceReference, priority, requiredDate, notes, lines: lines.map(([m, qty]) => ({ materialId: M[m].id, requestedQty: qty })) }, T[requester].user.id);
  const data = { status }; TUA.push({ id: d.id, umur });
  if (["APPROVED", "READY_TO_PICK", "PICKED", "ISSUED"].includes(status)) { data.approvedById = T.owner.user.id; data.approvedAt = hari(umur); }
  if (status === "ISSUED") { data.issuedById = T.gudang.user.id; data.issuedAt = hari(Math.max(umur - 1, 0)); }
  await testPrisma.materialIssue.update({ where: { id: d.id }, data });
  if (status === "ISSUED") {
    for (const l of d.lines) {
      const qty = diterbitkan ? l.requestedQty / 2 : l.requestedQty;
      await testPrisma.stockMovement.create({ data: { materialId: l.materialId, type: "ISSUE", qty: -qty, note: `Material Issue ${d.issueNumber}`, materialIssueId: d.id, unitId: unit ? U[unit].id : null, createdById: T.gudang.user.id, createdAt: hari(Math.max(umur - 1, 0)) } });
      await testPrisma.materialIssueLine.update({ where: { id: l.id }, data: { issuedQty: qty } });
    }
  }
  if (status === "CANCELLED") await testPrisma.materialIssue.update({ where: { id: d.id }, data: { notes: "Dibatalkan: seed" } });
  D[kunci] = d; return d;
}
const tgl = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
await dok("draf", { unit: "a", lines: [["busa", 10], ["kain", 5]], status: "DRAFT", priority: "NORMAL", requiredDate: tgl(3), department: "Line A", umur: 1 });
await dok("menunggu", { unit: "b", lines: [["lem", 2]], status: "WAITING_APPROVAL", priority: "HIGH", requiredDate: tgl(2), umur: 2, requester: "gudang2" });
await dok("disetujui", { unit: "a", lines: [["busa", 20], ["desimal", 0.25]], status: "APPROVED", priority: "URGENT", requiredDate: tgl(1), umur: 3 });
await dok("siap", { unit: "c", lines: [["kain", 12]], status: "READY_TO_PICK", priority: "NORMAL", umur: 4 });
await dok("diambil", { unit: "d", lines: [["busa", 8], ["lem", 1]], status: "PICKED", priority: "LOW", umur: 5, requester: "gudang2" });
await dok("diambil2", { unit: "d", lines: [["lem", 6]], status: "PICKED", umur: 5 }); // stok kurang (lem saldo 3, direservasi dokumen lain) → uji kondisi stok kurang
await dok("keluar", { unit: "a", lines: [["kayu", 10]], status: "ISSUED", umur: 6 });
await dok("keluarSebagian", { unit: "b", lines: [["busa", 10]], status: "ISSUED", umur: 7, diterbitkan: true });
await dok("batal", { unit: "c", lines: [["kayu", 4]], status: "CANCELLED", umur: 8 });
await dok("manual", { sourceType: "MANUAL", lines: [["kayu", 2]], status: "DRAFT", sourceReference: "TIKET-77", department: "Perawatan", umur: 2 });
await dok("sampel", { sourceType: "SAMPLE_REQUEST", lines: [["kain", 1]], status: "DRAFT", umur: 9, requester: "gudang2" });
await dok("belum", { unit: "a", lines: [["belum", 2]], status: "DRAFT", umur: 10 });
await dok("perlengkapan", { sourceType: "MAINTENANCE_REQUEST", lines: [["perleng", 2]], status: "DRAFT", umur: 11 });
// pengisi agar daftar panjang (60 dokumen) — dokumen khusus di atas tetap terjangkau lewat filter
for (let i = 1; i <= 50; i++) await dok(`isi${i}`, { unit: ["a", "b", "c", "d"][i % 4], lines: [[`paku${(i % 18) + 1}`, 2 + (i % 5)]], status: i % 6 === 0 ? "ISSUED" : i % 5 === 0 ? "CANCELLED" : "DRAFT", umur: 12 + (i % 20), requester: i % 2 ? "gudang" : "gudang2", priority: ["LOW", "NORMAL", "HIGH"][i % 3] });
// satu dokumen di ujung daftar (paling lama) dengan bahan & peminta khas → uji cakupan filter di luar bagian atas
await dok("tua", { unit: "d", lines: [["kayu", 1]], status: "DRAFT", umur: 400, requester: "gudang2", department: "Dokumen Tertua" });
const urutHari = {};
for (const x of TUA) {
  const t = hari(x.umur); const dd = String(t.getUTCDate()).padStart(2, "0"); const mm = String(t.getUTCMonth() + 1).padStart(2, "0"); const yy = String(t.getUTCFullYear()).slice(-2); const k = dd + mm + yy; urutHari[k] = (urutHari[k] ?? 0) + 1;
  await testPrisma.materialIssue.update({ where: { id: x.id }, data: { createdAt: t, updatedAt: t, issueNumber: `MI-${k}-${String(urutHari[k]).padStart(2, "0")}-S${x.id.slice(0, 3)}`.replace(/-S.*$/, "") } });
}
// pencatatan LANGSUNG oleh Produksi pada unit A (jalur terpisah; tidak bertaut dokumen) — bahan KAYU sama dengan dokumen 'keluar' → peringatan kemungkinan ganda
await testPrisma.stockMovement.create({ data: { materialId: M.kayu.id, type: "ISSUE", qty: -3, note: "Dicatat langsung Produksi (seed)", unitId: U.a.id, createdById: T.produksi.user.id, createdAt: hari(1) } });

fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify({ M: Object.fromEntries(Object.entries(M).map(([k, v]) => [k, v.id])), U: Object.fromEntries(Object.entries(U).map(([k, v]) => [k, v.id])), D: Object.fromEntries(Object.entries(D).map(([k, v]) => [k, { id: v.id, nomor: v.issueNumber }])) }, null, 2));

const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/qa/state", async (req, res) => {
  const snap = await computeStockSnapshot(testPrisma);
  const stok = Object.fromEntries(snap.filter((s) => s.code.startsWith("SBX-")).map((s) => [s.code, { id: s.materialId, saldo: s.balance, dicadangkan: s.reserved, tersedia: s.available }]));
  const docs = await testPrisma.materialIssue.findMany({ include: { lines: true }, orderBy: { createdAt: "desc" } });
  const dokumen = Object.fromEntries(docs.map((d) => [d.id, { nomor: d.issueNumber, status: d.status, dibuat: d.createdAt, peminta: d.requestedById, sumber: d.sourceType, prioritas: d.priority, dibutuhkan: d.requiredDate, dikeluarkan: d.issuedAt, departemen: d.department, catatan: d.notes, revision: d.revision, plan: d.productionPlanId, unitId: d.unitId, approvedById: d.approvedById, baris: d.lines.map((l) => ({ materialId: l.materialId, diminta: l.requestedQty, keluar: l.issuedQty, lokasi: l.sourceLocation })) }]));
  const mv = await testPrisma.stockMovement.findMany({ where: { material: { code: { startsWith: "SBX-" } } }, select: { id: true, type: true, qty: true, materialId: true, unitId: true, materialIssueId: true, note: true } });
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "material_issue" }, select: { eventType: true, entityId: true } });
  const evUnit = await testPrisma.activityEvent.findMany({ where: { eventType: { startsWith: "PRODUCTION_MATERIAL_ISSUE" } }, select: { eventType: true, entityId: true } });
  res.json({ stok, dokumen, dokumenTotal: docs.length, gerak: mv, gerakTotal: mv.length, gerakIssue: mv.filter((m) => m.type === "ISSUE").length, aktivitas: ev, aktivitasUnit: evUnit, jurnal: await testPrisma.finJournalEntry.count(), perintahV2: await testPrisma.v2Command.count(), cadanganV2: await testPrisma.materialReservation.groupBy({ by: ["status"], _count: true }).catch(() => []) });
});
app.post("/qa/gerak-adj", async (req, res) => { // sesuaikan saldo (uji stok kurang saat serah/keluar) — hanya di server uji
  const { materialId, qty } = req.body; await testPrisma.stockMovement.create({ data: { materialId, type: "ADJUSTMENT", qty, note: "QA: penyesuaian uji", reason: "QA", createdById: T.gudang.user.id } }); res.json({ ok: true });
});

// ── V2: bangun permintaan Produksi (P4) lewat HTTP ke backend ASLI (meniru tes integrasi productionMaterialIssue)
let seq = 0; const key = (v) => ({ "Idempotency-Key": `qa-mi-${v}-${Date.now()}-${++seq}-0001` });
const kohort = []; // flag V2 = COHORT unit (tidak ada GLOBAL): tiap unit V2 uji ditambahkan ke cohort writer & reader
async function setFlag(flagKey, enabled) { const data = { enabled, scope: "GLOBAL", config: { unitIds: [...kohort] }, reason: "QA sandbox" }; await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data }); }
async function unitV2(tag) {
  const driver = await createTestUser({ roles: ["DRIVER"] }); const dapi = makeClient(BASE, driver.token);
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan V2 ${tag}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `SBX-V2-${tag}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `SBX-V2U-${tag}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const route = await testPrisma.route.create({ data: { code: `SBX-RTE-${tag}`, date: new Date(), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date() } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  kohort.push(unit.id); await setFlag(V2_FLAGS.PRODUCTION_WRITER, true); await setFlag(V2_FLAGS.PRODUCTION_READER, true);
  const t = `acc-${tag}`;
  await dapi.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${t}-s`)); await dapi.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${t}-a`));
  const done = await dapi.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${t}-c`));
  if (done.status !== 200) throw new Error("armada complete: " + JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-QA-${tag}`, name: "Gudang QA" } });
  const loc = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-QA-${tag}` } });
  const acc = await makeClient(BASE, T.gudang.token).post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: loc.id, expectedRevision: 1 }, key(`${t}-x`));
  if (acc.status !== 200) throw new Error("custody accept: " + JSON.stringify(acc.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  return { unit, run };
}
async function rencanaV2(tag, specs, { ajukan = true } = {}) {
  const { unit, run } = await unitV2(tag); const plan = makeClient(BASE, T.perencana.token); const gud = makeClient(BASE, T.gudang.token);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-QA-${tag}`, name: "Workshop QA" } });
  const operator = await testPrisma.productionOperator.upsert({ where: { userId: T.perencana.user.id }, create: { workLanes: ["TABLE", "CORNER"], userId: T.perencana.user.id }, update: { active: true } });
  const created = await plan.post("/api/production-planning/plans", { runId: run.id }, key(`c-${tag}`)); const planId = created.body.planId;
  const as = await plan.post(`/api/production-planning/plans/${planId}/assign`, { workCenterId: workCenter.id, operatorId: operator.id, targetStartAt: new Date(Date.now() + 3_600_000).toISOString(), targetCompleteAt: new Date(Date.now() + 18_000_000).toISOString(), expectedRevision: 1 }, key(`a-${tag}`));
  if (as.status !== 200) throw new Error("assign: " + JSON.stringify(as.body));
  const bom = await plan.post(`/api/production-planning/plans/${planId}/bom`, { lines: specs.map(([m, qty]) => ({ materialId: M[m].id, qty })), expectedRevision: as.body.revision }, key(`b-${tag}`));
  if (bom.status !== 200) throw new Error("bom: " + JSON.stringify(bom.body));
  const res2 = await gud.post(`/api/production-planning/plans/${planId}/reserve`, { expectedRevision: bom.body.revision }, key(`r-${tag}`));
  if (res2.status !== 200) throw new Error("reserve: " + JSON.stringify(res2.body));
  let req = null; if (ajukan) { req = await plan.post(`/api/production-planning/plans/${planId}/material-request`, {}, key(`q-${tag}`)); if (req.status !== 201) throw new Error("request: " + JSON.stringify(req.body)); }
  return { planId, unitId: unit.id, unitCode: unit.unitCode, issueId: req?.body?.issueId ?? null, issueNumber: req?.body?.issueNumber ?? null };
}
app.post("/qa/seed-v2", async (req, res) => {
  try { const tag = String(req.body?.tag ?? Date.now()); const specs = req.body?.specs ?? [["busa", 5], ["kain", 2]]; res.json(await rencanaV2(tag, specs, { ajukan: req.body?.ajukan !== false })); }
  catch (e) { console.error(e); res.status(500).json({ error: String(e?.message ?? e) }); }
});
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-mi] server siap di ${BASE} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
