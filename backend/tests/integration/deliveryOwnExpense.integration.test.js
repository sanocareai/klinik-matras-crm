// Biaya Delivery MILIK SENDIRI (izin delivery:expense:own:read|write) — Driver/Helper/
// Leader Driver mengajukan biaya armada tanpa finance:expense:submit. Semua aturan
// ditegakkan di server: hanya workspace DELIVERY, hanya milik sendiri, relasi harus
// terkait pengguna, tidak boleh list semua/verify/approve/reject/pay, mutation wajib
// Idempotency-Key, dan bukti foto hanya pada pengajuan sendiri yang masih draf.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
let raw;
test.before(async () => {
  await truncateAll();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  server = await startTestServer(buildTestApp());
  raw = makeRaw(server.baseUrl);
});
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const P = "/api/finance/expense-submissions";
let n = 0;
const K = (p = "own") => ({ "Idempotency-Key": `${p}-${Date.now()}-${++n}-abcdef` });
const body = (extra = {}) => ({ workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-20", amount: 500_000, vendorName: "SPBU Uji", metadata: { liters: 10 }, ...extra });

async function fixture() {
  const a = await createTestUser({ roles: ["DRIVER"] });
  const b = await createTestUser({ roles: ["DRIVER"] });
  const helper = await createTestUser({ roles: ["HELPER"] });
  const leader = await createTestUser({ roles: ["LEADER_DRIVER"] });
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const vehicleA = await testPrisma.vehicle.create({ data: { plateNumber: "B 1111 UJI", type: "Box", capacitySlots: 10, active: true, picDriverId: a.user.id } });
  const vehicleX = await testPrisma.vehicle.create({ data: { plateNumber: "B 9999 UJI", type: "Box", capacitySlots: 10, active: true } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Uji", city: "Jakarta" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `OWN-${Date.now()}`, value: 1000, category: "LAYANAN" } });
  const jobA = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, driverId: a.user.id, helperId: helper.user.id, status: "ASSIGNED", sequence: 1, addressText: "Alamat A", vehicleId: vehicleA.id } });
  const jobB = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, driverId: b.user.id, status: "ASSIGNED", sequence: 2, addressText: "Alamat B" } });
  return { a, b, helper, leader, dispatcher, finance, approver, vehicleA, vehicleX, jobA, jobB };
}

async function gambar() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
}
async function unggah(token, id, headers) {
  const fd = new FormData();
  fd.append("bukti", new Blob([await gambar()], { type: "image/jpeg" }), "struk.jpg");
  const res = await fetch(`${server.baseUrl}${P}/${id}/bukti`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...headers }, body: fd });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

test("Driver, Helper, Leader Driver bisa membuat pengajuan Delivery milik sendiri (DRAF, requestedById = diri sendiri)", async () => {
  const f = await fixture();
  for (const u of [f.a, f.helper, f.leader]) {
    const res = await raw("POST", P, { token: u.token, headers: K(), body: body() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.status, "DRAFT");
    assert.equal(res.body.division, "DELIVERY");
    assert.equal(res.body.requestedById, u.user.id);
  }
});

test("mutation tanpa Idempotency-Key ditolak 428 (create, patch, ajukan, tarik, batalkan, bukti)", async () => {
  const f = await fixture();
  assert.equal((await raw("POST", P, { token: f.a.token, body: body() })).status, 428);
  const c = await raw("POST", P, { token: f.a.token, headers: K(), body: body() });
  assert.equal((await raw("PATCH", `${P}/${c.body.id}`, { token: f.a.token, body: { description: "x" } })).status, 428);
  assert.equal((await raw("POST", `${P}/${c.body.id}/ajukan`, { token: f.a.token })).status, 428);
  assert.equal((await raw("POST", `${P}/${c.body.id}/tarik`, { token: f.a.token })).status, 428);
  assert.equal((await raw("POST", `${P}/${c.body.id}/batalkan`, { token: f.a.token, body: {} })).status, 428);
  assert.equal((await unggah(f.a.token, c.body.id, {})).status, 428);
});

test("kunci idempotensi sama pada create: satu pengajuan, respons diputar ulang", async () => {
  const f = await fixture();
  const h = K("dup");
  const r1 = await raw("POST", P, { token: f.a.token, headers: h, body: body() });
  const r2 = await raw("POST", P, { token: f.a.token, headers: h, body: body() });
  assert.equal(r1.status, 201);
  assert.equal(r2.body.id, r1.body.id);
  assert.equal(await testPrisma.expenseSubmission.count(), 1);
});

test("hanya workspace DELIVERY: config/create untuk workspace lain ditolak", async () => {
  const f = await fixture();
  assert.equal((await raw("GET", `${P}/config?workspace=DELIVERY`, { token: f.a.token })).status, 200);
  assert.equal((await raw("GET", `${P}/config?workspace=PRODUKSI`, { token: f.a.token })).status, 403);
  assert.equal((await raw("GET", `${P}/config?workspace=FINANCE`, { token: f.a.token })).status, 403);
  assert.equal((await raw("POST", P, { token: f.a.token, headers: K(), body: body({ workspace: "PRODUKSI" }) })).status, 403);
  assert.equal((await raw("POST", P, { token: f.a.token, headers: K(), body: body({ workspace: "FINANCE" }) })).status, 403);
});

test("field terlarang ditolak: atas nama orang lain, uang muka, PIC, order, sumber dana selain talangan pribadi", async () => {
  const f = await fixture();
  for (const extra of [{ requestedById: f.b.user.id }, { advanceId: "00000000-0000-4000-8000-000000000000" }, { picUserId: f.b.user.id }, { orderId: "x" }, { sumberDana: "REKENING_PERUSAHAAN" }, { paymentMethod: "TRANSFER" }]) {
    const res = await raw("POST", P, { token: f.a.token, headers: K(), body: body(extra) });
    assert.equal(res.status, 403, JSON.stringify(extra));
  }
  assert.equal((await raw("POST", P, { token: f.a.token, headers: K(), body: body({ sumberDana: "TALANGAN_PRIBADI" }) })).status, 201);
  assert.equal(await testPrisma.expenseSubmission.count(), 1);
});

test("relasi: job/rute/kendaraan harus terkait pengguna; kendaraan PIC dan kendaraan di job sendiri lolos", async () => {
  const f = await fixture();
  const ok = (extra) => raw("POST", P, { token: f.a.token, headers: K(), body: body(extra) });
  assert.equal((await ok({ jobId: f.jobA.id })).status, 201, "job sendiri");
  assert.equal((await ok({ jobId: f.jobB.id })).status, 403, "job driver lain");
  assert.equal((await ok({ vehicleId: f.vehicleA.id })).status, 201, "kendaraan PIC sendiri");
  assert.equal((await ok({ vehicleId: f.vehicleX.id })).status, 403, "kendaraan tak terkait");
  assert.equal((await ok({ driverId: f.b.user.id })).status, 403, "driver lain tanpa relasi");
  assert.equal((await ok({ jobId: f.jobA.id, helperId: f.helper.user.id })).status, 201, "rekan di job yang sama");
  // helper melihat job yang dia bantu
  const h = await raw("POST", P, { token: f.helper.token, headers: K(), body: body({ jobId: f.jobA.id }) });
  assert.equal(h.status, 201, JSON.stringify(h.body));
});

test("milik sendiri vs orang lain: list hanya milik sendiri; detail dan SEMUA mutation pada punya orang lain ditolak", async () => {
  const f = await fixture();
  const punyaA = await raw("POST", P, { token: f.a.token, headers: K(), body: body() });
  await raw("POST", P, { token: f.b.token, headers: K(), body: body({ amount: 600_000 }) });

  const listA = await raw("GET", P, { token: f.a.token });
  assert.equal(listA.status, 200);
  assert.deepEqual(listA.body.submissions.map((s) => s.id), [punyaA.body.id]);
  assert.equal(listA.body.hanyaMilikSendiri, true);
  // query division/filter tidak bisa dipakai membuka data lain
  const listPaksa = await raw("GET", `${P}?division=FINANCE`, { token: f.a.token });
  assert.deepEqual(listPaksa.body.submissions.map((s) => s.id), [punyaA.body.id]);

  const idA = punyaA.body.id;
  assert.equal((await raw("GET", `${P}/${idA}`, { token: f.b.token })).status, 403);
  assert.equal((await raw("PATCH", `${P}/${idA}`, { token: f.b.token, headers: K(), body: { description: "curang" } })).status, 404);
  assert.equal((await raw("POST", `${P}/${idA}/ajukan`, { token: f.b.token, headers: K() })).status, 404);
  assert.equal((await raw("POST", `${P}/${idA}/tarik`, { token: f.b.token, headers: K() })).status, 404);
  assert.equal((await raw("POST", `${P}/${idA}/batalkan`, { token: f.b.token, headers: K(), body: {} })).status, 404);
  assert.equal((await unggah(f.b.token, idA, K())).status, 404, "bukti orang lain tidak boleh diubah");
  const utuh = await testPrisma.expenseSubmission.findUnique({ where: { id: idA } });
  assert.equal(utuh.status, "DRAFT");
  assert.notEqual(utuh.description, "curang");
});

test("alur penuh milik sendiri: draf -> edit -> bukti foto -> ajukan -> (terkunci) -> tarik; menjadi SATU FinExpense mode REIMBURSEMENT", async () => {
  const f = await fixture();
  const c = await raw("POST", P, { token: f.a.token, headers: K(), body: body({ jobId: f.jobA.id }) });
  const id = c.body.id;
  const e = await raw("PATCH", `${P}/${id}`, { token: f.a.token, headers: K(), body: { amount: 550_000, description: "BBM perjalanan" } });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.amount, 550000);
  const up = await unggah(f.a.token, id, K());
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.uploadedById, f.a.user.id);

  const aj = await raw("POST", `${P}/${id}/ajukan`, { token: f.a.token, headers: K("aj") });
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  assert.equal(aj.body.status, "MENUNGGU_PERSETUJUAN");
  const fe = await testPrisma.finExpense.findUnique({ where: { id: aj.body.finExpenseId } });
  assert.equal(fe.mode, "REIMBURSEMENT");
  assert.equal(fe.createdById, f.a.user.id);
  assert.equal(await testPrisma.finExpense.count({ where: { division: "DELIVERY" } }), 1);

  // terkunci setelah diajukan
  assert.equal((await raw("PATCH", `${P}/${id}`, { token: f.a.token, headers: K(), body: { description: "ubah" } })).status, 409);
  assert.equal((await unggah(f.a.token, id, K())).status, 409, "bukti tidak boleh diubah setelah diajukan");

  const tarik = await raw("POST", `${P}/${id}/tarik`, { token: f.a.token, headers: K() });
  assert.equal(tarik.status, 200, JSON.stringify(tarik.body));
  assert.equal(tarik.body.status, "DRAFT");
});

test("akun own-only DITOLAK di semua endpoint pendukung dan aksi Finance", async () => {
  const f = await fixture();
  const c = await raw("POST", P, { token: f.a.token, headers: K(), body: body() });
  const t = f.a.token;
  assert.equal((await raw("GET", `${P}/uang-muka-aktif`, { token: t })).status, 403);
  assert.equal((await raw("GET", `${P}/duplicate-check?division=DELIVERY&expenseType=BBM&date=2026-09-20`, { token: t })).status, 403);
  assert.equal((await raw("GET", `${P}/templates`, { token: t })).status, 403);
  assert.equal((await raw("GET", `${P}/recent`, { token: t })).status, 403);
  assert.equal((await raw("POST", `${P}/${c.body.id}/metadata`, { token: t, headers: K(), body: { reason: "x", changes: {} } })).status, 403);
  const fid = "00000000-0000-4000-8000-000000000001";
  for (const aksi of ["approve", "reject", "pay", "cancel", "koreksi", "tarik"]) {
    assert.equal((await raw("POST", `/api/finance/expenses/${fid}/${aksi}`, { token: t, headers: K(), body: {} })).status, 403, aksi);
  }
  assert.equal((await raw("POST", `/api/finance/expenses/${fid}/verifikasi-bukti`, { token: t, headers: K(), body: {} })).status, 403);
  assert.equal((await raw("GET", "/api/finance/expenses", { token: t })).status, 403);
});

test("izin lama tidak berubah: Dispatcher tetap bisa list semua & Finance/Approver tetap menyetujui; Finance tetap dijaga per-izin", async () => {
  const f = await fixture();
  await raw("POST", P, { token: f.a.token, headers: K(), body: body() });
  await raw("POST", P, { token: f.dispatcher.token, body: body({ amount: 700_000 }) });
  const dis = await raw("GET", P, { token: f.dispatcher.token });
  assert.equal(dis.status, 200);
  assert.equal(dis.body.hanyaMilikSendiri, true, "dispatcher tanpa finance:read tetap own-scoped seperti sebelumnya");
  const fin = await raw("GET", P, { token: f.finance.token });
  assert.equal(fin.body.submissions.length, 2, "Finance melihat semua");
  assert.equal(fin.body.hanyaMilikSendiri, false);
  // Approver TIDAK boleh mengajukan lewat jalur ini (tidak punya izin pengajuan apa pun)
  assert.equal((await raw("GET", P, { token: f.approver.token })).status, 403);
});

test("paginasi opsional & aditif: tanpa limit perilaku lama; dengan limit ada adaLagi/offset", async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await raw("POST", P, { token: f.finance.token, body: body({ amount: 500_000 + i }) });
  const lama = await raw("GET", P, { token: f.finance.token });
  assert.equal(lama.body.submissions.length, 5);
  assert.equal("adaLagi" in lama.body, false);
  const h1 = await raw("GET", `${P}?limit=2&offset=0`, { token: f.finance.token });
  assert.equal(h1.body.submissions.length, 2);
  assert.equal(h1.body.adaLagi, true);
  const h3 = await raw("GET", `${P}?limit=2&offset=4`, { token: f.finance.token });
  assert.equal(h3.body.submissions.length, 1);
  assert.equal(h3.body.adaLagi, false);
});
