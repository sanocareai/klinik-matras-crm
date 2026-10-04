// P12C.1 — antrean V1 per PIC (GET /api/production/v1-worker-queue) lewat HTTP nyata di DB uji terisolasi: penugasan -> mulai -> selesai -> serah ke PIC berikutnya
// sampai QC dan Corner. Invarian di SETIAP langkah: kartu tidak hilang, tidak ganda, tidak bocor ke PIC/lini lain; baca-saja (nol tulisan); nol artefak V2.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PHOTO = ["/media/unit-photos/uji.jpg"];
async function actor(roles, { operator = false } = {}) {
  const u = await createTestUser({ roles });
  const op = operator ? await testPrisma.productionOperator.create({ data: { userId: u.user.id } }) : null;
  return { ...u, http: makeClient(server.baseUrl, u.token), op };
}

test("assignment -> mulai -> selesai -> serah PIC berikutnya -> QC -> Corner: tak ada kartu hilang/ganda/bocor di setiap langkah", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]); const qc = await actor(["QC_LEAD"]); const sales = await actor(["SALES"]);
  const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true }); const K = await actor(["PRODUCTION_WORKER"], { operator: true });
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Antrean" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: "ORD-Q1", value: 1_000_000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: "Q-1", orderId: order.id, seq: 1, status: "RECEIVED", merk: "Serta", ukuran: "160x200" } });
  assert.equal((await lead.http.patch(`/api/units/${unit.id}/service`, { serviceId: service.id })).status, 200);
  const timeline = async () => (await lead.http.get(`/api/units/${unit.id}/timeline`)).body;
  const path = (await timeline()).path.map((p) => p.stage);
  const idx = (code) => path.findIndex((s) => s.code === code);
  assert.ok(idx("fit_test") > 4 && idx("corner_sewing") === idx("fit_test") + 1 && idx("finished") === idx("corner_sewing") + 1, "jalur nyata: ... QC -> corner_sewing -> finished");

  const rowBefore = JSON.stringify((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })));
  const queue = async (who, lane = "TABLE") => (await who.http.get(`/api/production/v1-worker-queue?lane=${lane}`)).body.items.filter((i) => i.unit.id === unit.id);
  const views = async () => ({ A: await queue(A), B: await queue(B), K: await queue(K, "CORNER"), KT: await queue(K), AC: await queue(A, "CORNER"), BC: await queue(B, "CORNER") });
  const one = (v, who) => { assert.ok(v[who].length <= 1, `${who}: kartu ganda (${v[who].length})`); return v[who][0] || null; };
  const noOthers = (v, ...allowed) => { for (const who of ["A", "B", "K", "KT", "AC", "BC"]) if (!allowed.includes(who)) assert.equal(v[who].length, 0, `kartu bocor ke ${who}`); };
  const assign = async (stage, who) => assert.equal((await lead.http.post(`/api/units/${unit.id}/stages/${stage.id}/assign`, { operatorId: who.op.id, workCenterId: null })).status, 200);
  const start = async (who) => assert.equal((await who.http.post(`/api/units/${unit.id}/stages/start`, {})).status, 200);
  const complete = async (who, stage) => { const r = await who.http.post(`/api/units/${unit.id}/stages/${stage.id}/complete`, { photoUrls: PHOTO, note: "selesai (uji)" }); assert.equal(r.status, 200, `${stage.code}: ${JSON.stringify(r.body)}`); };

  // 1. tanpa penugasan: tidak ada kartu untuk siapa pun
  let v = await views(); noOthers(v);
  // 2. penugasan sah yang BELUM dimulai -> siap dikerjakan
  await assign(path[0], A); v = await views();
  assert.equal(one(v, "A").state, "READY"); assert.equal(one(v, "A").stage.code, path[0].code); noOthers(v, "A");
  // 3. PIC lain ditugaskan di tahap hilir -> menunggu prasyarat (tahap target + pemegangnya)
  await assign(path[2], B); v = await views();
  const bWait = one(v, "B");
  assert.equal(bWait.state, "WAITING_PREREQUISITE"); assert.equal(bWait.stage.code, path[2].code); assert.equal(bWait.prerequisite.stage.code, path[0].code);
  assert.equal(bWait.prerequisite.state, "READY"); assert.equal(bWait.prerequisite.assigned, true); assert.equal(bWait.prerequisite.assignee, A.user.name);
  assert.equal(one(v, "A").state, "READY", "kartu A tetap satu"); noOthers(v, "A", "B");
  // 4. mulai (+ jeda/lanjut): keadaan mengikuti engine; prasyarat B ikut berubah
  await start(A); v = await views();
  assert.equal(one(v, "A").state, "IN_PROGRESS"); assert.equal(one(v, "B").prerequisite.state, "IN_PROGRESS");
  assert.equal((await A.http.post(`/api/units/${unit.id}/stages/${path[0].id}/pause`, { reason: "BREAK" })).status, 200);
  assert.equal(one(await views(), "A").state, "PAUSED");
  assert.equal((await A.http.post(`/api/units/${unit.id}/stages/${path[0].id}/resume`, {})).status, 200);
  assert.equal(one(await views(), "A").state, "IN_PROGRESS");
  // 5. selesai: tahap berikutnya belum ditugaskan -> PIC terakhir (A) menunggu penugasan berikutnya; B menunggu prasyarat yang belum ditugaskan
  await complete(A, path[0]); v = await views();
  const aWait = one(v, "A");
  assert.equal(aWait.state, "WAITING_ASSIGNMENT"); assert.equal(aWait.waitingFor.code, path[1].code); assert.equal(aWait.stage.code, path[0].code);
  assert.equal(one(v, "B").state, "WAITING_PREREQUISITE"); assert.equal(one(v, "B").prerequisite.stage.code, path[1].code); assert.equal(one(v, "B").prerequisite.assigned, false);
  noOthers(v, "A", "B");
  // 6. dialihkan ke B: kartu A hilang, B siap dikerjakan (satu kartu, bukan dua)
  await assign(path[1], B); v = await views();
  assert.equal(v.A.length, 0, "dialihkan: A tidak lagi punya kartu"); assert.equal(one(v, "B").state, "READY"); assert.equal(one(v, "B").stage.code, path[1].code); noOthers(v, "B");
  // 7. B mengerjakan dua tahap berturut-turut (tahap hilir sudah miliknya): tanpa celah/kartu ganda
  await start(B); await complete(B, path[1]); v = await views();
  assert.equal(one(v, "B").state, "READY"); assert.equal(one(v, "B").stage.code, path[2].code); noOthers(v, "B");
  await start(B); await complete(B, path[2]); v = await views();
  assert.equal(one(v, "B").state, "WAITING_ASSIGNMENT"); assert.equal(one(v, "B").waitingFor.code, path[3].code); noOthers(v, "B");
  // 8. sisa tahap lantai sebelum QC: serah bergantian A <-> B; di setiap langkah tepat satu pemegang aktif
  let holder = B; let other = A; let i = 3;
  while (path[i].code !== "fit_test") {
    await assign(path[i], other); v = await views();
    const [hn, on] = other === A ? ["A", "B"] : ["B", "A"];
    assert.equal(one(v, hn).state, "READY"); assert.equal(v[on === "A" ? "A" : "B"].length, 0, "pemegang lama kehilangan kartu hanya SETELAH dialihkan");
    noOthers(v, hn);
    await start(other); assert.equal(one(await views(), hn).state, "IN_PROGRESS");
    await complete(other, path[i]); v = await views();
    [holder, other] = [other, holder]; i += 1;
    if (path[i].code !== "fit_test") { assert.equal(one(v, holder === A ? "A" : "B").state, "WAITING_ASSIGNMENT"); noOthers(v, holder === A ? "A" : "B"); }
  }
  // 9. gerbang QC belum ditugaskan: PIC terakhir menunggu penugasan berikutnya; QC memutus -> lantai tidak lagi memegang kartu
  v = await views(); const hn = holder === A ? "A" : "B";
  assert.equal(one(v, hn).state, "WAITING_ASSIGNMENT"); assert.equal(one(v, hn).waitingFor.code, "fit_test"); noOthers(v, hn);
  await start(holder);
  assert.equal((await qc.http.post(`/api/units/${unit.id}/stages/${path[i].id}/qc`, { verdict: "PAS", referenceWeightKg: 72, educationGiven: false, note: "uji", photoUrls: PHOTO })).status, 200);
  v = await views(); noOthers(v);
  // 10. Corner membaca penugasan tahap Corner KANONIK: hanya K di lini CORNER; lini TABLE kosong
  const cornerStage = path[idx("corner_sewing")]; const finishedStage = path[idx("finished")];
  await assign(cornerStage, K); v = await views();
  assert.equal(one(v, "K").state, "READY"); assert.equal(one(v, "K").stage.code, "corner_sewing"); assert.equal(one(v, "K").lane, "CORNER"); noOthers(v, "K");
  assert.equal(v.KT.length, 0, "tahap Corner TIDAK muncul di lini Meja");
  await start(K); await complete(K, cornerStage); v = await views();
  assert.equal(one(v, "K").state, "WAITING_ASSIGNMENT"); assert.equal(one(v, "K").lane, "CORNER"); assert.equal(one(v, "K").waitingFor.code, "finished"); noOthers(v, "K");
  await assign(finishedStage, K); assert.equal(one(await views(), "K").state, "READY");
  await start(K); assert.equal(one(await views(), "K").state, "IN_PROGRESS");
  await complete(K, finishedStage); v = await views(); noOthers(v);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");

  // baca-saja & nol artefak V2 & izin/validasi
  const reads = await queue(A); assert.equal(reads.length, 0);
  assert.equal((await lead.http.get("/api/production/v1-worker-queue")).body.operator, null, "bukan operator -> kosong");
  const salesView = await sales.http.get("/api/production/v1-worker-queue"); // SALES berizin UNIT_READ tetapi bukan operator: tidak ada penugasan -> kosong, tanpa kebocoran
  assert.equal(salesView.status, 200); assert.deepEqual(salesView.body, { operator: null, lane: "TABLE", items: [] });
  assert.equal((await makeClient(server.baseUrl, null).get("/api/production/v1-worker-queue")).status, 401, "tanpa login ditolak");
  assert.equal((await A.http.get("/api/production/v1-worker-queue?lane=HACK")).status, 400);
  assert.equal(Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from production_runs_v2"))[0].c), 0, "nol Run V2");
  assert.notEqual(rowBefore, "", "sanity");
});

test("kandidat dibaca HANYA lewat penugasan milik operator pemanggil; unit cohort V2 tidak dimuat (antrean V2 yang memuatnya); GET tidak mengubah baris unit", async () => {
  const lead = await actor(["PRODUCTION_LEAD"]); const A = await actor(["PRODUCTION_WORKER"], { operator: true }); const B = await actor(["PRODUCTION_WORKER"], { operator: true });
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const customer = await testPrisma.customer.create({ data: { name: "Pak Cohort" } });
  const mk = async (code, seq) => { const o = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-${code}`, value: 1, category: "LAYANAN" } }); return testPrisma.unit.create({ data: { unitCode: code, orderId: o.id, seq, status: "IN_PRODUCTION" } }); };
  const u1 = await mk("Q-V1", 1); const u2 = await mk("Q-V2", 2);
  for (const u of [u1, u2]) assert.equal((await lead.http.patch(`/api/units/${u.id}/service`, { serviceId: service.id })).status, 200);
  const first = (await lead.http.get(`/api/units/${u1.id}/timeline`)).body.path[0].stage;
  for (const u of [u1, u2]) assert.equal((await lead.http.post(`/api/units/${u.id}/stages/${first.id}/assign`, { operatorId: A.op.id, workCenterId: null })).status, 200);
  const before = JSON.stringify(await testPrisma.unit.findMany({ orderBy: { unitCode: "asc" } }));
  const qa = async () => (await A.http.get("/api/production/v1-worker-queue?lane=TABLE")).body.items.map((i) => i.unit.unitCode).sort();
  assert.deepEqual(await qa(), ["Q-V1", "Q-V2"]);
  assert.deepEqual((await B.http.get("/api/production/v1-worker-queue?lane=TABLE")).body.items, [], "PIC lain tidak melihat penugasan A");
  for (const key of [V2_FLAGS.PRODUCTION_READER]) await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: true, scope: "GLOBAL", config: { unitIds: [u2.id] }, reason: "uji" }, update: { enabled: true, config: { unitIds: [u2.id] } } });
  assert.deepEqual(await qa(), ["Q-V1"], "unit cohort V2 keluar dari antrean V1 (tidak ganda dengan antrean V2)");
  assert.equal(JSON.stringify(await testPrisma.unit.findMany({ orderBy: { unitCode: "asc" } })), before, "GET baca-saja: baris unit identik");
});
