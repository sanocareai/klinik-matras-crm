// P12A — seeder/reset staging QA-PV2 (jalur tulis ASLI lewat HTTP): 12 unit matriks demo, idempoten, lifecycle end-to-end, reset aman, akses Demo Mode (server),
// dan penjaga bentuk: kunci payload snapshot Mode Demo = kunci payload endpoint nyata.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { createTestUser } from "./setup/fixtures.js";
import { makeClient } from "./setup/httpClient.js";
import { makeKit } from "../../scripts/staging/qaPv2Kit.js";
import { PREFIX, BASELINE_TABLES } from "../../scripts/staging/qaPv2Safety.js";
import * as S from "../../scripts/staging/qaPv2Seed.js";
import { getDocumentationDetail } from "../../src/services/productionDocumentationService.js";

let server; let ctx; let dataDir; let W;
const here = path.dirname(fileURLToPath(import.meta.url));
test.before(async () => {
  await truncateAll(); await S.wipeNonBaseline({ prisma: testPrisma, dataDir: os.tmpdir() });
  await testPrisma.$executeRawUnsafe("DELETE FROM work_centers"); // FK default_work_center_id = ON DELETE SET NULL (baseline tidak hilang); tes lain dapat meninggalkan work center // DB uji sekali pakai: mulai bersih walau file tes lain meninggalkan baris
  server = await startTestServer(buildTestApp());
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-pv2-"));
  ctx = { prisma: testPrisma, kit: makeKit({ baseUrl: server.baseUrl, jwtSecret: process.env.JWT_SECRET }), baseUrl: server.baseUrl, dataDir, log: () => {} };
});
test.after(async () => { await S.resetQaPv2(ctx, { yes: true }).catch(() => {}); await server.close(); await testPrisma.$disconnect(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const count = async () => ({
  units: await testPrisma.unit.count(), orders: await testPrisma.order.count(), customers: await testPrisma.customer.count(), runs: await testPrisma.productionRun.count(),
  evidence: await testPrisma.productionStepEvidence.count(), users: await testPrisma.user.count(), materials: await testPrisma.material.count(), plans: await testPrisma.productionRunPlan.count(),
  moves: await testPrisma.stockMovement.count(),
});
const byCode = (n) => testPrisma.unit.findUniqueOrThrow({ where: { unitCode: `${PREFIX}-U${String(n).padStart(2, "0")}` } });

test("master + akun: semua peran wajib ada, prefix QA-PV2, kredensial acak hanya di berkas 0600 (tidak dicetak), idempoten", async () => {
  const logs = []; const quiet = { ...ctx, log: (m) => logs.push(m) };
  W = await S.ensureMaster(quiet);
  const roles = Object.fromEntries(Object.values(W.accounts).map((a) => [a.key, a.role]));
  assert.equal(roles.owner, "OWNER"); assert.equal(roles.admin, "ADMIN"); assert.equal(roles.lead, "PRODUCTION_LEAD"); assert.equal(roles.qc, "QC_LEAD"); assert.equal(roles.gudang, "WAREHOUSE"); assert.equal(roles.dokumentasi, "PRODUCTION_DOCUMENTER");
  for (const k of ["meja1", "meja2", "meja3", "meja4", "corner1", "corner2"]) assert.equal(roles[k], "PRODUCTION_WORKER");
  assert.equal(W.operators.TABLE.length, 4); assert.equal(W.operators.CORNER.length, 2);
  const users = await testPrisma.user.findMany(); assert.ok(users.every((u) => u.email.startsWith("qa-pv2-") && u.email.endsWith("@staging.invalid") && u.name.startsWith(PREFIX)));
  const file = path.join(dataDir, "qa-pv2-credentials.json"); const creds = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(Object.keys(creds).length, S.ACCOUNTS.length); assert.ok(Object.values(creds).every((p) => p.length >= 12));
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(logs).includes(Object.values(creds)[0]), false, "password tidak pernah dicetak");
  const hash0 = (await testPrisma.user.findFirstOrThrow({ where: { email: "qa-pv2-owner@staging.invalid" } })).passwordHash;
  const bcrypt = (await import("bcryptjs")).default; assert.equal(await bcrypt.compare(creds["qa-pv2-owner@staging.invalid"], hash0), true, "login memakai password dari berkas");
  const again = await S.ensureMaster(ctx); const c0 = await count();
  assert.equal((await testPrisma.user.findFirstOrThrow({ where: { email: "qa-pv2-owner@staging.invalid" } })).passwordHash, hash0, "idempoten: password tak berubah");
  assert.equal(c0.users, users.length); assert.equal(Object.keys(again.materials).length, S.MATERIALS.length);
  const rotated = await S.ensureMaster(ctx, { rotate: true }); assert.notEqual((await testPrisma.user.findFirstOrThrow({ where: { email: "qa-pv2-owner@staging.invalid" } })).passwordHash, hash0); W = rotated;
  for (const m of await testPrisma.material.findMany()) assert.ok(m.code.startsWith(`${PREFIX}-`)); assert.equal((await testPrisma.workCenter.findMany()).every((w) => w.code.startsWith(`${PREFIX}-`)), true);
});

test("matriks 12 unit lewat jalur tulis asli: setiap keadaan wajib hadir, semua ber-prefix, cohort berisi 12 unit, dan seed ulang tidak mengubah apa pun (idempoten)", async () => {
  const res = await S.seedMatrix(ctx, W); assert.equal(res.length, 12); assert.ok(res.every((r) => r.existed === false));
  const c1 = await count(); assert.equal(c1.units, 12);
  for (const u of await testPrisma.unit.findMany()) assert.match(u.unitCode, /^QA-PV2-U\d{2}$/);
  for (const o of await testPrisma.order.findMany()) assert.match(o.orderNumber, /^QA-PV2-RES-\d{4}$/);
  for (const c of await testPrisma.customer.findMany()) assert.ok(c.name.startsWith(`${PREFIX} `));
  const runOf = async (n) => testPrisma.productionRun.findFirstOrThrow({ where: { unitId: (await byCode(n)).id }, include: { plan: true } });
  assert.equal((await runOf(1)).status, "PENDING_ARRIVAL", "U01 dalam perjalanan");
  for (const n of [2, 3]) { const r = await runOf(n); assert.equal(r.status, "ACTIVE"); assert.equal(r.plan.productionDate, null, `U${n} belum dijadwalkan`); assert.equal(r.plan.stationCode, null); }
  assert.equal((await runOf(2)).plan.priority, 1); assert.equal((await runOf(3)).plan.priority, 2);
  const stationOf = async (n) => (await runOf(n)).plan.stationCode;
  assert.deepEqual([await stationOf(4), await stationOf(5), await stationOf(6), await stationOf(7), await stationOf(8), await stationOf(9), await stationOf(10), await stationOf(11)], ["TABLE_1", "TABLE_2", "TABLE_2", "TABLE_3", "TABLE_3", "TABLE_4", "TABLE_4", "TABLE_1"]);
  // U12 = Akan Masuk — Pickup Terjadwal: pickup terjadwal (belum dijemput), BELUM punya Run -> forecast, bukan WIP
  const u12 = await byCode(12); assert.equal(await testPrisma.productionRun.count({ where: { unitId: u12.id } }), 0, "U12 belum punya Run");
  const j12 = await testPrisma.job.findFirstOrThrow({ where: { units: { some: { unitId: u12.id } } } }); assert.equal(j12.type, "PICKUP"); assert.equal(j12.status, "ASSIGNED", "U12 pickup terjadwal, belum dijemput");
  assert.deepEqual([...new Set((await testPrisma.productionRunPlan.findMany({ where: { stationCode: { not: null } } })).map((p) => p.priority))].sort(), [0, 1, 2], "prioritas normal, tinggi, mendesak");
  assert.equal((await runOf(4)).currentPhase, "PROCESS"); assert.equal(await testPrisma.diagnosisReport.count({ where: { runId: (await runOf(4)).id } }), 0, "U04 diagnosis belum lengkap");
  assert.equal((await testPrisma.productionMaterialShortage.findFirstOrThrow({ where: { runId: (await runOf(5)).id } })).status, "OPEN", "U05 menunggu bahan");
  assert.equal((await runOf(7)).currentPhase, "QC", "U07 menunggu QC"); assert.equal(await testPrisma.qualityInspection.count({ where: { runId: (await runOf(7)).id } }), 0);
  assert.equal((await testPrisma.qualityInspection.findFirstOrThrow({ where: { runId: (await runOf(8)).id } })).result, "FAIL_REWORK", "U08 QC gagal/rework");
  const u9 = await runOf(9); assert.ok(await testPrisma.productionStepEvidence.findFirst({ where: { runId: u9.id, stepNo: 10, stepCode: { not: { startsWith: "DOC_" } } } }), "U09 sudah di Corner");
  const u10 = await runOf(10); assert.equal((await testPrisma.productionMaterialReturn.findFirstOrThrow({ where: { runId: u10.id } })).status, "PENDING", "U10 menunggu retur");
  const u11 = await runOf(11); assert.equal((await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: u11.unitId, direction: "FINISHED_GOODS" } })).status, "ACCEPTED", "U11 siap kirim");
  const cohort = (await testPrisma.v2FeatureFlag.findUniqueOrThrow({ where: { key: "production_v2_reader" } })).config.unitIds; assert.equal(cohort.length, 12);
  const docs = async (n) => (await getDocumentationDetail(testPrisma, (await runOf(n)).id, { unitIds: cohort })).docs.flags.lengkap;
  assert.equal(await docs(11), true, "dokumentasi lengkap"); assert.equal(await docs(6), false, "dokumentasi kurang");
  // jejak foto fixture aman: URL pickup hanya /media/job-photos/QA-PV2-*; tidak ada URL eksternal
  for (const j of await testPrisma.job.findMany()) assert.ok((j.proofPhotoUrls || []).every((u) => /^\/media\/job-photos\/QA-PV2-pod-\d{2}\.png$/.test(u)), JSON.stringify(j.proofPhotoUrls));
  // idempoten
  const again = await S.seedMatrix(ctx, W); assert.ok(again.every((r) => r.existed === true)); assert.deepEqual(await count(), c1);
  // tidak ada jalur outbound: semua baris outbox PENDING (tanpa consumer eksternal), tidak ada yang ditandai terkirim
  const outbox = await testPrisma.domainOutbox.groupBy({ by: ["status"], _count: true }); assert.deepEqual(outbox.map((o) => o.status), ["PENDING"], JSON.stringify(outbox));
});

test("lifecycle end-to-end baru: pickup → tiba → rencana → diagnosis/BOM → bahan → proses → QC → Corner → barang jadi diterima; dapat diulang (unit berikutnya)", async () => {
  const r1 = await S.runLifecycle(ctx, W, { stage: "siap_kirim" }); assert.equal(r1.existed, false); assert.match(r1.code, /^QA-PV2-U10\d$/);
  const unit = await testPrisma.unit.findUniqueOrThrow({ where: { id: r1.unitId } }); const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  assert.equal(run.status, "COMPLETED");
  const steps = (await testPrisma.productionStepEvidence.findMany({ where: { runId: run.id, NOT: { stepCode: { startsWith: "DOC_" } } } })).map((e) => e.stepNo);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) assert.ok(steps.includes(n), `tahap ${n}`);
  assert.equal((await testPrisma.qualityInspection.findFirstOrThrow({ where: { runId: run.id } })).result, "PASS");
  assert.ok(await testPrisma.materialIssue.findFirst({ where: { unitId: unit.id, status: "ISSUED" } }), "bahan diserahkan Gudang");
  assert.ok(await testPrisma.plannedBOMLine.count({ where: { plan: { runId: run.id } } }) >= 2, "BOM");
  assert.equal(await testPrisma.productionMaterialReturn.count({ where: { runId: run.id } }), 0, "tanpa sisa → tanpa retur");
  assert.equal((await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } })).status, "ACCEPTED");
  assert.equal((await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } })).status, "ACCEPTED");
  const r2 = await S.runLifecycle(ctx, W, { stage: "menunggu_retur", docs: "kurang", station: "TABLE_2" }); assert.notEqual(r2.code, r1.code); assert.equal(r2.existed, false);
  assert.equal((await testPrisma.productionMaterialReturn.findFirstOrThrow({ where: { unitId: r2.unitId } })).status, "PENDING");
});

test("Demo Mode — server: hanya ADMIN/OWNER (200); peran lain 403; tanpa token 401; endpoint tidak menulis apa pun", async () => {
  const c0 = await count(); const events0 = await testPrisma.domainOutbox.count();
  const who = async (role) => { const u = await createTestUser({ roles: [role] }); return makeClient(server.baseUrl, u.token); };
  for (const [role, want] of [["ADMIN", 200], ["OWNER", 200], ["PRODUCTION_LEAD", 403], ["WAREHOUSE", 403], ["QC_LEAD", 403], ["PRODUCTION_WORKER", 403], ["PRODUCTION_DOCUMENTER", 403], ["FINANCE", 403], ["SALES", 403], ["DRIVER", 403]]) {
    const r = await (await who(role)).get("/api/production-v2/demo/access"); assert.equal(r.status, want, role);
    if (want === 200) { assert.deepEqual(r.body, { allowed: true, readOnly: true, label: "MODE DEMO — bukan data operasional" }); assert.equal(JSON.stringify(r.body).includes("QA-PV2"), false, "tidak membocorkan dataset"); }
  }
  assert.equal((await makeClient(server.baseUrl, null).get("/api/production-v2/demo/access")).status, 401);
  for (const m of ["post", "patch", "delete"]) { const r = await (await who("ADMIN"))[m]("/api/production-v2/demo/access", {}); assert.ok([404, 405].includes(r.status), `${m} → ${r.status}`); }
  assert.deepEqual({ ...(await count()), users: 0 }, { ...c0, users: 0 }, "tidak ada data berubah (selain akun uji yang dibuat tes)"); assert.equal(await testPrisma.domainOutbox.count(), events0);
});

test("penjaga bentuk: kunci payload snapshot Mode Demo = kunci payload endpoint nyata (command-center, board, antrean Gudang, antrean dokumentasi, antrean QC, meta KPI)", async () => {
  const snap = JSON.parse(fs.readFileSync(path.resolve(here, "../../../frontend/src/features/production/demo/demoSnapshot.json"), "utf8"));
  const owner = W.accounts.owner; const kit = ctx.kit;
  const keys = (x) => (Array.isArray(x) ? ["[]"] : Object.keys(x || {}).sort());
  const compare = async (url, realUrl = url) => {
    const real = await kit.get(owner, `/api${realUrl}`); const demo = snap.entries.find((e) => e.url === url)?.data;
    assert.ok(demo, `snapshot memuat ${url}`); assert.deepEqual(keys(demo), keys(real), `kunci ${url}`);
    return { real, demo };
  };
  const cc = await compare("/production-v2/command-center");
  const colKeys = (p) => Object.keys(p.columns[0]).sort(); assert.deepEqual(colKeys(cc.demo), colKeys(cc.real), "kolom command-center");
  const item = (p) => Object.keys(p.columns.flatMap((c) => c.items)[0]).sort(); assert.deepEqual(item(cc.demo), item(cc.real), "kartu command-center");
  await compare(`/production-v2/board?date=${snap.today}`, `/production-v2/board?date=${S_today()}`);
  await compare("/production-v2/warehouse/queue"); await compare("/production-v2/documentation/queue?filter=ALL"); await compare("/production-planning/qc/queue?tab=REWORK");
  await compare("/production-v2/reports/meta"); await compare("/production-v2/targets");
  const sum = await compare(`/production-v2/reports/summary?from=${snap.today}&to=${snap.today}&granularity=day`.replace(/from=[^&]+&to=[^&]+/, `from=${snap.entries.find((e) => /reports\/summary/.test(e.url)).url.match(/from=([^&]+)/)[1]}&to=${snap.entries.find((e) => /reports\/summary/.test(e.url)).url.match(/to=([^&]+)/)[1]}`), "/production-v2/reports/summary?granularity=day");
  assert.deepEqual(keys(sum.demo.metrics[0]), keys(sum.real.metrics[0]), "bentuk metrik KPI");
});
function S_today() { return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); }

test("reset aman: wajib --yes; menolak bila ada data non-QA-PV2; hanya mengosongkan data staging (baseline utuh), menghapus lokasi/gudang ber-prefix; idempoten; seed ulang berhasil", async () => {
  await assert.rejects(S.resetQaPv2(ctx, { yes: false }), /--yes/);
  await testPrisma.user.deleteMany({ where: { email: { not: { startsWith: "qa-pv2-" } } } }); // akun uji dari tes Demo Mode di atas = data non-QA-PV2
  const foreign = await testPrisma.customer.create({ data: { name: "Budi Pelanggan Asli" } });
  await assert.rejects(S.resetQaPv2(ctx, { yes: true }), /DITOLAK.*customers=1/);
  assert.ok((await count()).units > 12, "ditolak = tidak ada yang terhapus"); await testPrisma.customer.delete({ where: { id: foreign.id } });
  const baselineBefore = { svc: await testPrisma.serviceCatalog.count(), stages: await testPrisma.routingStage.count(), wh: await testPrisma.warehouse.count({ where: { code: { not: { startsWith: PREFIX } } } }) };
  const r1 = await S.resetQaPv2(ctx, { yes: true }); assert.ok(r1.truncated > 100); assert.deepEqual(r1.deletedByPrefix, ["work_centers"]);
  const c = await count(); assert.deepEqual(c, { units: 0, orders: 0, customers: 0, runs: 0, evidence: 0, users: 0, materials: 0, plans: 0, moves: 0 });
  assert.equal(await testPrisma.warehouse.count({ where: { code: { startsWith: PREFIX } } }), 0); assert.equal(await testPrisma.storageLocation.count({ where: { code: { startsWith: PREFIX } } }), 0); assert.equal(await testPrisma.workCenter.count(), 0);
  assert.deepEqual({ svc: await testPrisma.serviceCatalog.count(), stages: await testPrisma.routingStage.count(), wh: await testPrisma.warehouse.count({ where: { code: { not: { startsWith: PREFIX } } } }) }, baselineBefore, "baseline migration tidak tersentuh");
  assert.equal(await testPrisma.v2FeatureFlag.count(), 0); assert.equal(fs.existsSync(path.join(dataDir, "qa-pv2-credentials.json")), false);
  const r2 = await S.resetQaPv2(ctx, { yes: true }); assert.ok(r2.truncated > 100, "reset kedua (idempoten) tidak gagal");
  const W2 = await S.ensureMaster(ctx); const res = await S.seedMatrix(ctx, W2); assert.equal(res.length, 12); assert.equal((await count()).units, 12);
  // tabel baseline di daftar = tabel yang benar-benar berisi pada DB hasil migrasi (penjaga drift daftar)
  assert.ok(BASELINE_TABLES.includes("service_catalog") && BASELINE_TABLES.includes("routing_stages"));
});
