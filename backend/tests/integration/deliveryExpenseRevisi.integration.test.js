// PERLU_REVISI pada Pengajuan Biaya + audit trail lengkap. Semua transition, pembeda
// dari tarik/batalkan, kompatibilitas Finance (FinExpense tidak pernah terposting saat
// diminta revisi), idempotensi, dan jejak audit siapa/kapan/alasan/status sebelum-sesudah.
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
const K = (p = "rev") => ({ "Idempotency-Key": `${p}-${Date.now()}-${++n}-abcdef` });
const body = (extra = {}) => ({ workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-20", amount: 500_000, vendorName: "SPBU Uji", metadata: { liters: 10 }, ...extra });

async function fixture() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const other = await createTestUser({ roles: ["DRIVER"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  return { driver, other, approver, finance };
}
async function diajukan(f, extra = {}) {
  const c = await raw("POST", P, { token: f.driver.token, headers: K(), body: body(extra) });
  const aj = await raw("POST", `${P}/${c.body.id}/ajukan`, { token: f.driver.token, headers: K("aj") });
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  return aj.body;
}
const mintaRevisi = (token, id, reason, headers = K("rv")) => raw("POST", `${P}/${id}/minta-revisi`, { token, headers, body: { reason } });
const audit = (id) => testPrisma.expenseSubmissionAudit.findMany({ where: { submissionId: id }, orderBy: { createdAt: "asc" } });
async function unggah(token, id) {
  const fd = new FormData();
  fd.append("bukti", new Blob([await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer()], { type: "image/jpeg" }), "s.jpg");
  const res = await fetch(`${server.baseUrl}${P}/${id}/bukti`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...K("up") }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("reviewer minta revisi: alasan wajib; status PERLU_REVISI, lepas dari FinExpense, FinExpense DRAFT dan TIDAK pernah terposting", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  assert.equal((await mintaRevisi(f.approver.token, s.id, "")).status, 400);
  assert.equal((await mintaRevisi(f.approver.token, s.id, "  ab ")).status, 400);
  const r = await mintaRevisi(f.approver.token, s.id, "Foto struk buram, mohon unggah ulang");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "PERLU_REVISI");
  assert.equal(r.body.finExpenseId, null);
  assert.equal(r.body.revisionReason, "Foto struk buram, mohon unggah ulang");
  assert.equal(r.body.revisionRequestedById, f.approver.user.id);
  assert.ok(r.body.revisionRequestedAt);
  const fe = await testPrisma.finExpense.findUnique({ where: { id: s.finExpenseId } });
  assert.equal(fe.status, "DRAFT");
  assert.equal(await testPrisma.finJournalEntry.count(), 0, "buku besar tidak tersentuh");
});

test("audit revisi mencatat actor, waktu, alasan, status sebelum dan sesudah", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  await mintaRevisi(f.approver.token, s.id, "Nominal tidak sesuai struk");
  const a = (await audit(s.id)).find((x) => x.after === "PERLU_REVISI");
  assert.equal(a.field, "status");
  assert.equal(a.before, "MENUNGGU_PERSETUJUAN");
  assert.equal(a.reason, "Nominal tidak sesuai struk");
  assert.equal(a.actorId, f.approver.user.id);
  assert.ok(a.createdAt);
});

test("transition: minta revisi hanya dari MENUNGGU_PERSETUJUAN (DRAF, PERLU_REVISI, DISETUJUI, DITOLAK, DIBATALKAN, DIBAYAR = 409)", async () => {
  const f = await fixture();
  // DRAFT
  const d = await raw("POST", P, { token: f.driver.token, headers: K(), body: body() });
  assert.equal((await mintaRevisi(f.approver.token, d.body.id, "alasan")).status, 409);
  // PERLU_REVISI (kedua kali)
  const s1 = await diajukan(f);
  assert.equal((await mintaRevisi(f.approver.token, s1.id, "alasan")).status, 200);
  assert.equal((await mintaRevisi(f.approver.token, s1.id, "lagi")).status, 409);
  // DISETUJUI (reimbursement wajib nota sebelum disetujui)
  const c2 = await raw("POST", P, { token: f.driver.token, headers: K(), body: body() });
  assert.equal((await unggah(f.driver.token, c2.body.id)).status, 201);
  const s2 = (await raw("POST", `${P}/${c2.body.id}/ajukan`, { token: f.driver.token, headers: K("aj") })).body;
  assert.equal((await raw("POST", `/api/finance/expenses/${s2.finExpenseId}/approve`, { token: f.finance.token })).status, 200);
  assert.equal((await mintaRevisi(f.approver.token, s2.id, "alasan")).status, 409);
  // DITOLAK
  const s3 = await diajukan(f);
  assert.equal((await raw("POST", `/api/finance/expenses/${s3.finExpenseId}/reject`, { token: f.finance.token, body: { reason: "Tidak sesuai kebijakan" } })).status, 200);
  assert.equal((await mintaRevisi(f.approver.token, s3.id, "alasan")).status, 409);
  // DIBATALKAN
  const c4 = await raw("POST", P, { token: f.driver.token, headers: K(), body: body() });
  await raw("POST", `${P}/${c4.body.id}/batalkan`, { token: f.driver.token, headers: K(), body: {} });
  assert.equal((await mintaRevisi(f.approver.token, c4.body.id, "alasan")).status, 409);
});

test("izin: hanya pemegang finance:approve; driver/helper/pemohon sendiri tidak bisa; tanpa Idempotency-Key 428", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  assert.equal((await mintaRevisi(f.driver.token, s.id, "alasan")).status, 403, "pemilik own-only");
  assert.equal((await mintaRevisi(f.other.token, s.id, "alasan")).status, 403, "driver lain");
  assert.equal((await raw("POST", `${P}/${s.id}/minta-revisi`, { token: f.approver.token, body: { reason: "alasan" } })).status, 428);
  // pemohon yang kebetulan Finance tidak boleh meminta revisi atas pengajuannya sendiri
  const c = await raw("POST", P, { token: f.finance.token, body: body() });
  const aj = await raw("POST", `${P}/${c.body.id}/ajukan`, { token: f.finance.token, headers: K("aj") });
  assert.equal((await mintaRevisi(f.finance.token, aj.body.id, "alasan")).status, 403);
  assert.equal((await testPrisma.expenseSubmission.findUnique({ where: { id: s.id } })).status, "MENUNGGU_PERSETUJUAN");
});

test("pemilik melihat alasan revisi, memperbaiki (edit + bukti baru), lalu mengajukan ulang -> FinExpense baru menunggu persetujuan", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  await mintaRevisi(f.approver.token, s.id, "Mohon lampirkan foto struk");

  const detail = await raw("GET", `${P}/${s.id}`, { token: f.driver.token });
  assert.equal(detail.body.status, "PERLU_REVISI");
  assert.equal(detail.body.revisionReason, "Mohon lampirkan foto struk");
  assert.equal(detail.body.revisionRequestedBy.id, f.approver.user.id);
  const daftar = await raw("GET", P, { token: f.driver.token });
  assert.equal(daftar.body.submissions[0].status, "PERLU_REVISI");

  assert.equal((await raw("PATCH", `${P}/${s.id}`, { token: f.driver.token, headers: K(), body: { amount: 520_000 } })).status, 200);
  assert.equal((await unggah(f.driver.token, s.id)).status, 201, "bukti boleh diperbaiki saat PERLU_REVISI");
  assert.equal((await raw("POST", `${P}/${s.id}/tarik`, { token: f.driver.token, headers: K() })).status, 409, "tarik bukan aksi di PERLU_REVISI");

  const ulang = await raw("POST", `${P}/${s.id}/ajukan`, { token: f.driver.token, headers: K("aj2") });
  assert.equal(ulang.status, 200, JSON.stringify(ulang.body));
  assert.equal(ulang.body.status, "MENUNGGU_PERSETUJUAN");
  assert.ok(ulang.body.finExpenseId && ulang.body.finExpenseId !== s.finExpenseId, "FinExpense baru");
  assert.equal(ulang.body.finExpense.amount, 520000);
  assert.equal(await testPrisma.finExpense.count({ where: { status: "MENUNGGU_APPROVAL" } }), 1, "hanya SATU yang menunggu persetujuan");

  const setuju = await raw("POST", `/api/finance/expenses/${ulang.body.finExpenseId}/approve`, { token: f.finance.token });
  assert.equal(setuju.status, 200, "integrasi Finance tetap jalan setelah revisi");
  const akhir = await raw("GET", `${P}/${s.id}`, { token: f.driver.token });
  assert.equal(akhir.body.status, "DISETUJUI");
  const a = await audit(s.id);
  assert.ok(a.some((x) => x.reason === "Diajukan ulang setelah revisi" && x.before === "PERLU_REVISI" && x.after === "MENUNGGU_PERSETUJUAN"));
});

test("pemilik dapat membatalkan pengajuan PERLU_REVISI; orang lain tidak bisa menyentuhnya", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  await mintaRevisi(f.approver.token, s.id, "alasan revisi");
  assert.equal((await raw("PATCH", `${P}/${s.id}`, { token: f.other.token, headers: K(), body: { description: "x" } })).status, 404);
  assert.equal((await raw("POST", `${P}/${s.id}/ajukan`, { token: f.other.token, headers: K() })).status, 404);
  const b = await raw("POST", `${P}/${s.id}/batalkan`, { token: f.driver.token, headers: K(), body: { reason: "Tidak jadi" } });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.status, "DIBATALKAN");
});

test("revisi dibedakan dari tarik: tarik -> DRAFT (withdrawnAt, tanpa alasan revisi), revisi -> PERLU_REVISI (alasan+peminta)", async () => {
  const f = await fixture();
  const a = await diajukan(f);
  const b = await diajukan(f);
  const tarik = await raw("POST", `${P}/${a.id}/tarik`, { token: f.driver.token, headers: K() });
  const rev = await mintaRevisi(f.approver.token, b.id, "Perbaiki nominal");
  assert.equal(tarik.body.status, "DRAFT");
  assert.ok(tarik.body.withdrawnAt);
  assert.equal(tarik.body.revisionReason, null);
  assert.equal(rev.body.status, "PERLU_REVISI");
  assert.equal(rev.body.withdrawnAt, null);
  const auditTarik = (await audit(a.id)).find((x) => x.after === "DRAFT" && x.before === "MENUNGGU_PERSETUJUAN");
  const auditRev = (await audit(b.id)).find((x) => x.after === "PERLU_REVISI");
  assert.equal(auditTarik.actorId, f.driver.user.id);
  assert.equal(auditRev.actorId, f.approver.user.id);
  assert.notEqual(auditTarik.reason, auditRev.reason);
});

test("idempotensi: kunci sama diputar ulang; dua permintaan paralel = satu revisi & satu baris audit", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  const h = K("same");
  const r1 = await mintaRevisi(f.approver.token, s.id, "alasan", h);
  const r2 = await mintaRevisi(f.approver.token, s.id, "alasan", h);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r2.headers.get("idempotent-replayed"), "true");
  const s2 = await diajukan(f);
  const par = await Promise.all([1, 2, 3].map(() => mintaRevisi(f.approver.token, s2.id, "paralel")));
  assert.equal(par.filter((x) => x.status === 200).length, 1, JSON.stringify(par.map((x) => x.status)));
  const baris = (await audit(s2.id)).filter((x) => x.after === "PERLU_REVISI");
  assert.equal(baris.length, 1);
  assert.equal((await audit(s.id)).filter((x) => x.after === "PERLU_REVISI").length, 1);
});

test("audit trail lengkap untuk alur milik sendiri: buat, edit, bukti, ajukan, tarik, batalkan tercatat dengan actor", async () => {
  const f = await fixture();
  const c = await raw("POST", P, { token: f.driver.token, headers: K(), body: body() });
  const id = c.body.id;
  await raw("PATCH", `${P}/${id}`, { token: f.driver.token, headers: K(), body: { description: "BBM rute pagi" } });
  await unggah(f.driver.token, id);
  await raw("POST", `${P}/${id}/ajukan`, { token: f.driver.token, headers: K("aj") });
  await raw("POST", `${P}/${id}/tarik`, { token: f.driver.token, headers: K() });
  await raw("POST", `${P}/${id}/batalkan`, { token: f.driver.token, headers: K(), body: { reason: "Salah input" } });
  const a = await audit(id);
  const ringkas = a.map((x) => `${x.field}:${x.before ?? "-"}>${x.after ?? "-"}`);
  assert.ok(ringkas.includes("status:->DRAFT") || ringkas.includes("status:->DRAFT") || a.some((x) => x.field === "status" && x.before === null && x.after === "DRAFT"), "buat");
  assert.ok(a.some((x) => x.field === "draft"), "edit");
  assert.ok(a.some((x) => x.field === "bukti"), "bukti");
  assert.ok(a.some((x) => x.field === "status" && x.after === "MENUNGGU_PERSETUJUAN"), "ajukan");
  assert.ok(a.some((x) => x.field === "status" && x.before === "MENUNGGU_PERSETUJUAN" && x.after === "DRAFT"), "tarik");
  assert.ok(a.some((x) => x.field === "status" && x.after === "DIBATALKAN" && x.reason === "Salah input"), "batalkan");
  assert.ok(a.every((x) => x.actorId === f.driver.user.id), "semua aksi oleh pemilik");
});

test("data lama tetap terbaca: pengajuan tanpa kolom revisi menampilkan null, dan alur DRAF->ajukan lama tidak berubah", async () => {
  const f = await fixture();
  const c = await raw("POST", P, { token: f.finance.token, body: body() });
  assert.equal(c.body.revisionReason, null);
  assert.equal(c.body.revisionRequestedAt, null);
  const aj = await raw("POST", `${P}/${c.body.id}/ajukan`, { token: f.finance.token, headers: K("aj") });
  assert.equal(aj.body.status, "MENUNGGU_PERSETUJUAN");
});

test("detail memuat nama pelaku di audit trail; filter status boleh daftar dipisah koma", async () => {
  const f = await fixture();
  const s = await diajukan(f);
  await mintaRevisi(f.approver.token, s.id, "Cek nominal");
  const d = await raw("GET", `${P}/${s.id}`, { token: f.driver.token });
  const rev = d.body.auditTrail.find((x) => x.after === "PERLU_REVISI");
  assert.equal(rev.actor.id, f.approver.user.id);
  assert.ok(rev.actor.name);
  await diajukan(f);
  const gabung = await raw("GET", `${P}?status=PERLU_REVISI,MENUNGGU_PERSETUJUAN`, { token: f.driver.token });
  assert.equal(gabung.body.submissions.length, 2);
  const satu = await raw("GET", `${P}?status=PERLU_REVISI`, { token: f.driver.token });
  assert.equal(satu.body.submissions.length, 1);
});
