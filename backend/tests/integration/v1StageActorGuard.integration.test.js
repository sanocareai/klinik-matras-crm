// P12C.2 — penegakan penugasan V1 DI SERVER, lewat HTTP nyata (DB uji terisolasi). Validasi ulang GET di klien BUKAN pengganti guard ini.
// Invarian: operator lain / bukan operator / penugasan berubah / tahap basi => ditolak SEBELUM mutasi (nol baris log, nol blokir, baris unit identik, nol aktivitas);
// PIC sah berhasil; ADMIN/OWNER mengikuti kontrak izin (PRODUCTION_EXECUTE_ANY) tanpa memperluas izin peran lain; gerbang QC kontraknya tidak berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PHOTO = ["/media/unit-photos/uji.jpg"];
let seq = 0;
async function actor(roles, { operator = false } = {}) {
  const u = await createTestUser({ roles });
  const op = operator ? await testPrisma.productionOperator.create({ data: { userId: u.user.id } }) : null;
  return { ...u, http: makeClient(server.baseUrl, u.token), op };
}
async function newUnit(lead) {
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Guard" } });
  seq += 1;
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-G${seq}`, value: 1_000_000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `G-${seq}`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Serta", ukuran: "160x200" } });
  assert.equal((await lead.http.patch(`/api/units/${unit.id}/service`, { serviceId: service.id })).status, 200);
  const path = (await lead.http.get(`/api/units/${unit.id}/timeline`)).body.path.map((p) => p.stage);
  return { unit, path };
}
const assign = async (lead, unit, stage, who) => assert.equal((await lead.http.post(`/api/units/${unit.id}/stages/${stage.id}/assign`, { operatorId: who.op.id, workCenterId: null })).status, 200);
// Sidik efek: log tahap, blokir, baris unit utuh, jumlah aktivitas — harus IDENTIK setelah penolakan.
const snap = async (unitId) => JSON.stringify({
  logs: await testPrisma.unitStageLog.count({ where: { unitId } }),
  blockers: await testPrisma.productionBlocker.count({ where: { unitId } }),
  unit: await testPrisma.unit.findUniqueOrThrow({ where: { id: unitId } }),
  activity: await testPrisma.activityEvent.count({ where: { entityId: unitId } }),
});
// Semua aksi tahap yang dikirim satu aktor ke satu unit/tahap.
const attempts = (who, unit, stage) => ({
  start: () => who.http.post(`/api/units/${unit.id}/stages/start`, {}),
  complete: () => who.http.post(`/api/units/${unit.id}/stages/${stage.id}/complete`, { photoUrls: PHOTO, note: "uji" }),
  pause: () => who.http.post(`/api/units/${unit.id}/stages/${stage.id}/pause`, { reason: "BREAK" }),
  resume: () => who.http.post(`/api/units/${unit.id}/stages/${stage.id}/resume`, {}),
  fail: () => who.http.post(`/api/units/${unit.id}/stages/${stage.id}/fail`, { blockReason: "MATERIAL_SHORTAGE", note: "uji" }),
  done: () => who.http.post(`/api/production/units/${unit.id}/done`, { photoUrls: PHOTO, note: "uji" }),
});
async function assertRejectedNoEffect(who, unit, stage, status, code, label) {
  for (const [name, call] of Object.entries(attempts(who, unit, stage))) {
    const before = await snap(unit.id);
    const r = await call();
    assert.equal(r.status, status, `${label}/${name}: status ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code, `${label}/${name}: code`);
    assert.equal(await snap(unit.id), before, `${label}/${name}: ada efek samping pada penolakan`);
  }
}

test("operator lain, bukan-operator, Lead/QC tanpa penugasan: SEMUA aksi (mulai/selesai/jeda/lanjut/hambatan/catat-selesai) ditolak TANPA efek; tahap belum ditugaskan ditolak untuk semua", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]); const qc = await actor(["QC_LEAD"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true });
  const plainWorker = await actor(["PRODUCTION_WORKER"]);
  const { unit, path } = await newUnit(lead);

  // tahap belum ditugaskan: tidak ada yang bisa mulai (409), termasuk PIC mana pun
  await assertRejectedNoEffect(A, unit, path[0], 409, "UNIT_V1_STAGE_NOT_ASSIGNED", "belum-ditugaskan/A");

  await assign(lead, unit, path[0], A);
  await assertRejectedNoEffect(B, unit, path[0], 403, "UNIT_V1_NOT_YOUR_ASSIGNMENT", "operator-lain");
  await assertRejectedNoEffect(plainWorker, unit, path[0], 403, "UNIT_V1_NOT_OPERATOR", "bukan-operator");
  await assertRejectedNoEffect(lead, unit, path[0], 403, "UNIT_V1_NOT_OPERATOR", "lead-tanpa-penugasan");
  await assertRejectedNoEffect(qc, unit, path[0], 403, "UNIT_V1_NOT_OPERATOR", "qc-tanpa-penugasan");

  // operator nonaktif tidak bisa walau penugasan masih atas namanya
  await testPrisma.productionOperator.update({ where: { id: A.op.id }, data: { active: false } });
  await assertRejectedNoEffect(A, unit, path[0], 403, "UNIT_V1_NOT_OPERATOR", "operator-nonaktif");
  await testPrisma.productionOperator.update({ where: { id: A.op.id }, data: { active: true } });

  // tahap hilir milik B tidak menembus tahap sekarang (milik A): B ditolak untuk tahap sekarang, dan stageId hilir = 409 basi
  await assign(lead, unit, path[2], B);
  await assertRejectedNoEffect(B, unit, path[0], 403, "UNIT_V1_NOT_YOUR_ASSIGNMENT", "hilir-B-ke-tahap-sekarang");
  for (const name of ["complete", "pause", "resume", "fail"]) {
    const before = await snap(unit.id);
    const r = await attempts(B, unit, path[2])[name]();
    assert.equal(r.status, 409, `${name}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, "UNIT_V1_STAGE_CHANGED");
    assert.equal(await snap(unit.id), before, `${name}: efek samping pada stageId hilir`);
  }
  // A tidak pernah tersentuh: tahap 0 masih belum dimulai, nol log
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id } }), 0);
});

test("PIC sah berhasil: mulai -> jeda -> lanjut -> hambatan(+selesaikan) -> selesai; log tercatat atas PIC; tahap berikutnya langsung dikunci dari PIC lama", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true });
  const { unit, path } = await newUnit(lead);
  await assign(lead, unit, path[0], A);
  const a = attempts(A, unit, path[0]);
  assert.equal((await a.start()).status, 200);
  assert.equal((await a.pause()).status, 200);
  assert.equal((await a.resume()).status, 200);
  const failed = await a.fail(); assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal((await a.start()).status, 200, "mulai lagi setelah hambatan (retry) oleh PIC yang sama");
  assert.equal((await a.complete()).status, 200);
  const logs = await testPrisma.unitStageLog.findMany({ where: { unitId: unit.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(logs.map((l) => l.action), ["START", "PAUSE", "RESUME", "FAIL", "START", "COMPLETE"]);
  assert.ok(logs.every((l) => l.actorId === A.user.id), "actor_id = PIC yang menekan");

  // tahap berikutnya (path[1]) belum ditugaskan: A (PIC lama) tidak boleh meneruskan diam-diam
  await assertRejectedNoEffect(A, unit, path[1], 409, "UNIT_V1_STAGE_NOT_ASSIGNED", "lanjut-tanpa-penugasan");
  // stageId lama (tahap yang sudah selesai) = basi
  const stale = await a.complete(); assert.equal(stale.status, 409); assert.equal(stale.body.code, "UNIT_V1_STAGE_CHANGED");
});

test("penugasan berubah di tengah jalan: PIC lama ditolak tanpa efek, PIC baru berhasil (satu kartu, tidak ada tombol basi yang lolos ke server)", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true });
  const { unit, path } = await newUnit(lead);
  await assign(lead, unit, path[0], A);
  // klien A "melihat" tombol Mulai (GET), lalu Lead mengalihkan ke B sebelum A menekan
  const seen = (await A.http.get("/api/production/v1-worker-queue?lane=TABLE")).body.items.filter((i) => i.unit.id === unit.id);
  assert.equal(seen.length, 1); assert.equal(seen[0].state, "READY");
  await assign(lead, unit, path[0], B);
  const before = await snap(unit.id);
  const r = await attempts(A, unit, path[0]).start();
  assert.equal(r.status, 403); assert.equal(r.body.code, "UNIT_V1_NOT_YOUR_ASSIGNMENT"); assert.match(r.body.error, /dialihkan/);
  assert.equal(await snap(unit.id), before);
  assert.equal((await A.http.get("/api/production/v1-worker-queue?lane=TABLE")).body.items.filter((i) => i.unit.id === unit.id).length, 0, "kartu A hilang setelah dialihkan");
  assert.equal((await attempts(B, unit, path[0]).start()).status, 200);
  // dialihkan KEMBALI saat B sedang mengerjakan: B tidak bisa menyelesaikan; pemilik baru (A) tidak bisa menyelesaikan atas nama kerja B? -> A (penugasan kini miliknya) boleh meneruskan
  await assign(lead, unit, path[0], A);
  const b = attempts(B, unit, path[0]);
  const bBefore = await snap(unit.id);
  const bDone = await b.complete(); assert.equal(bDone.status, 403); assert.equal(await snap(unit.id), bBefore);
  assert.equal((await attempts(A, unit, path[0]).complete()).status, 200);
});

test("balapan: penugasan dialihkan BERSAMAAN dengan aksi PIC lama — tidak pernah ada START oleh PIC lama setelah penugasan berpindah (kunci unit yang sama)", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true });
  for (let i = 0; i < 6; i += 1) {
    const { unit, path } = await newUnit(lead);
    await assign(lead, unit, path[0], A);
    const [startRes, assignRes] = await Promise.all([
      attempts(A, unit, path[0]).start(),
      lead.http.post(`/api/units/${unit.id}/stages/${path[0].id}/assign`, { operatorId: B.op.id, workCenterId: null }),
    ]);
    assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));
    assert.ok([200, 403, 409].includes(startRes.status), `start: ${startRes.status}`);
    const asg = await testPrisma.stageAssignment.findUniqueOrThrow({ where: { unitId_stageId: { unitId: unit.id, stageId: path[0].id } } });
    assert.equal(asg.operatorId, B.op.id);
    const logs = await testPrisma.unitStageLog.findMany({ where: { unitId: unit.id, action: "START" } });
    if (startRes.status === 200) {
      assert.equal(logs.length, 1); assert.ok(logs[0].createdAt <= asg.updatedAt, "START A harus terjadi SEBELUM penugasan berpindah");
    } else {
      assert.equal(logs.length, 0, `start ditolak (${startRes.status}) tetapi ada log`);
    }
  }
});

test("ADMIN/OWNER mengikuti kontrak izin: boleh mengerjakan tahap yang ditugaskan ke PIC lain (actor_id = penekan), TETAP butuh penugasan; peran lain tidak naik izin", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]); const admin = await actor(["ADMIN"]); const owner = await actor(["OWNER"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true });
  const { unit, path } = await newUnit(lead);
  // belum ditugaskan: ADMIN/OWNER pun ditolak 409 (pagar penugasan tetap berlaku), tanpa efek
  await assertRejectedNoEffect(admin, unit, path[0], 409, "UNIT_V1_STAGE_NOT_ASSIGNED", "admin-belum-ditugaskan");
  await assertRejectedNoEffect(owner, unit, path[0], 409, "UNIT_V1_STAGE_NOT_ASSIGNED", "owner-belum-ditugaskan");
  await assign(lead, unit, path[0], A);
  // ADMIN mengerjakan tahap milik A
  const ad = attempts(admin, unit, path[0]);
  assert.equal((await ad.start()).status, 200);
  assert.equal((await ad.pause()).status, 200);
  assert.equal((await ad.resume()).status, 200);
  // tahap yang dituju basi tetap ditolak untuk ADMIN
  const staleBefore = await snap(unit.id);
  const stale = await admin.http.post(`/api/units/${unit.id}/stages/${path[2].id}/complete`, { photoUrls: PHOTO });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "UNIT_V1_STAGE_CHANGED"); assert.equal(await snap(unit.id), staleBefore);
  assert.equal((await ad.complete()).status, 200);
  const logs = await testPrisma.unitStageLog.findMany({ where: { unitId: unit.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(logs.map((l) => l.action), ["START", "PAUSE", "RESUME", "COMPLETE"]);
  assert.ok(logs.every((l) => l.actorId === admin.user.id), "jejak audit jujur: actor_id = ADMIN penekan, bukan PIC");
  // OWNER pada tahap berikutnya
  await assign(lead, unit, path[1], A);
  const ow = attempts(owner, unit, path[1]);
  assert.equal((await ow.start()).status, 200); assert.equal((await ow.complete()).status, 200);
  assert.ok((await testPrisma.unitStageLog.findMany({ where: { unitId: unit.id, stageId: path[1].id } })).every((l) => l.actorId === owner.user.id));
  // peran tanpa UNIT_STAGE_WRITE tetap 403 dari kontrak izin (guard tidak memberi akses baru)
  for (const role of ["SALES", "WAREHOUSE", "FINANCE"]) {
    const x = await actor([role]); const before = await snap(unit.id);
    const r = await attempts(x, unit, path[2]).start();
    assert.equal(r.status, 403, `${role}: ${JSON.stringify(r.body)}`); assert.equal(await snap(unit.id), before);
  }
});

test("catat-selesai retrospektif (/production/units/:id/done) dijaga sama; PIC sah dan ADMIN berhasil", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]); const admin = await actor(["ADMIN"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true });
  const { unit, path } = await newUnit(lead);
  await assign(lead, unit, path[0], A);
  const before = await snap(unit.id);
  const denied = await attempts(B, unit, path[0]).done();
  assert.equal(denied.status, 403); assert.equal(denied.body.code, "UNIT_V1_NOT_YOUR_ASSIGNMENT"); assert.equal(await snap(unit.id), before);
  const ok = await attempts(A, unit, path[0]).done(); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await assign(lead, unit, path[1], A);
  assert.equal((await attempts(admin, unit, path[1]).done()).status, 200);
});

test("gerbang QC tidak berubah: UNIT_STAGE_WRITE memulai tahap QC tanpa penugasan PIC, putusan tetap QC_WRITE; Corner dijaga seperti Meja", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]); const qc = await actor(["QC_LEAD"]); const admin = await actor(["ADMIN"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const K = await actor(["PRODUCTION_WORKER"], { operator: true }); const X = await actor(["PRODUCTION_WORKER"], { operator: true });
  const { unit, path } = await newUnit(lead);
  const qcIdx = path.findIndex((s) => s.requiresQc);
  assert.ok(qcIdx > 3);
  // majukan lantai sampai gerbang QC lewat PIC A (tiap tahap ditugaskan lalu dikerjakan)
  for (let i = 0; i < qcIdx; i += 1) {
    await assign(lead, unit, path[i], A);
    assert.equal((await attempts(A, unit, path[i]).start()).status, 200, `start ${path[i].code}`);
    assert.equal((await attempts(A, unit, path[i]).complete()).status, 200, `complete ${path[i].code}`);
  }
  // QC_LEAD tanpa operator & tanpa penugasan: memulai gerbang QC tetap boleh (kontrak lama), putusan lewat QC_WRITE
  assert.equal((await qc.http.post(`/api/units/${unit.id}/stages/start`, {})).status, 200);
  assert.equal((await qc.http.post(`/api/units/${unit.id}/stages/${path[qcIdx].id}/qc`, { verdict: "PAS", referenceWeightKg: 72, educationGiven: false, note: "uji", photoUrls: PHOTO })).status, 200);
  // Corner: tahap pasca-QC dijaga penugasan PIC Corner
  const corner = path[qcIdx + 1]; assert.equal(corner.code, "corner_sewing");
  await assertRejectedNoEffect(K, unit, corner, 409, "UNIT_V1_STAGE_NOT_ASSIGNED", "corner-belum-ditugaskan");
  await assign(lead, unit, corner, K);
  await assertRejectedNoEffect(X, unit, corner, 403, "UNIT_V1_NOT_YOUR_ASSIGNMENT", "corner-operator-lain");
  await assertRejectedNoEffect(A, unit, corner, 403, "UNIT_V1_NOT_YOUR_ASSIGNMENT", "corner-pic-meja-lama");
  assert.equal((await attempts(K, unit, corner).start()).status, 200);
  assert.equal((await attempts(admin, unit, corner).pause()).status, 200, "ADMIN (override) menjeda tahap Corner milik K");
  assert.equal((await attempts(K, unit, corner).resume()).status, 200);
  assert.equal((await attempts(K, unit, corner).complete()).status, 200);
});
