// EDIT MASTER SUPPLIER (7 Okt 2026) — PATCH /api/finance/suppliers/:id. Dikunci: bidang berubah sesuai, kode TIDAK bisa diubah, validasi (nama kosong, email, termin, tipe),
// riwayat aktivitas (siapa, apa, sebelum → sesudah; rekening ditandai) hanya bila ada perubahan nyata, izin (SALES 403, tanpa login 401, id tak dikenal 404),
// daftar dengan includeInactive, supplier nonaktif tidak menerima tagihan BARU tetapi utang lamanya tetap bisa dibayar, aktif lagi → tagihan baru bisa.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-X", name: "CV Lama", phone: "0811", email: "lama@x.id", bankName: "BCA", bankAccount: "111", bankHolder: "CV Lama", paymentTermDays: 30, aliases: ["cv lama"] } });
  return { bank, kat, admin, sales, sup, a: makeClient(server.baseUrl, admin.token), s: makeClient(server.baseUrl, sales.token), anon: makeClient(server.baseUrl, null) };
}
const riwayat = (id) => testPrisma.activityEvent.findMany({ where: { entityType: "fin_supplier", entityId: id }, orderBy: { createdAt: "asc" } });

test("ubah data: hanya bidang yang dikirim berubah, kode tidak bisa diubah, spasi dirapikan, kosong = hapus isian", async () => {
  const { a, sup } = await siapkan();
  const r = await a.patch(`/api/finance/suppliers/${sup.id}`, { code: "SUP-HACK", name: "  CV Baru  ", phone: "", paymentTermDays: "45", notes: "catatan" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const db = await testPrisma.finSupplier.findUnique({ where: { id: sup.id } });
  assert.equal(db.code, "SUP-X", "kode tidak boleh berubah");
  assert.equal(db.name, "CV Baru");
  assert.equal(db.phone, null);
  assert.equal(db.paymentTermDays, 45);
  assert.equal(db.notes, "catatan");
  assert.equal(db.email, "lama@x.id", "bidang yang tidak dikirim tidak berubah");
  assert.equal(db.bankAccount, "111");
  assert.deepEqual(db.aliases, ["cv lama"]);
  const kosongTermin = await a.patch(`/api/finance/suppliers/${sup.id}`, { paymentTermDays: "" });
  assert.equal(kosongTermin.status, 200);
  assert.equal((await testPrisma.finSupplier.findUnique({ where: { id: sup.id } })).paymentTermDays, null);
});

test("riwayat aktivitas: siapa/apa/sebelum→sesudah; rekening ditandai; tanpa perubahan nyata tidak mencatat apa pun", async () => {
  const { a, sup, admin } = await siapkan();
  assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { name: "CV Lama", phone: "0811" })).status, 200, "nilai sama = tidak berubah");
  assert.equal((await riwayat(sup.id)).length, 0);

  assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { name: "CV Revisi" })).status, 200);
  const satu = await riwayat(sup.id);
  assert.equal(satu.length, 1);
  assert.equal(satu[0].actorId, admin.user.id);
  assert.equal(satu[0].eventType, "DOCUMENT_EDITED");
  assert.deepEqual(satu[0].metadata.changes, { name: { dari: "CV Lama", ke: "CV Revisi" } });
  assert.equal(satu[0].metadata.rekeningBerubah, false);
  assert.equal(satu[0].metadata.supplierCode, "SUP-X");

  assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { bankAccount: "999", bankHolder: "CV Revisi" })).status, 200);
  const dua = await riwayat(sup.id);
  assert.equal(dua.length, 2);
  assert.equal(dua[1].metadata.rekeningBerubah, true);
  assert.deepEqual(Object.keys(dua[1].metadata.changes).sort(), ["bankAccount", "bankHolder"]);
  assert.deepEqual(dua[1].metadata.changes.bankAccount, { dari: "111", ke: "999" });
});

test("validasi: nama kosong, email salah, termin di luar 0–365/desimal, tipe salah → 400 tanpa mengubah data maupun mencatat riwayat", async () => {
  const { a, sup } = await siapkan();
  const awal = await testPrisma.finSupplier.findUnique({ where: { id: sup.id } });
  for (const body of [{ name: "   " }, { name: "" }, { email: "bukan-email" }, { paymentTermDays: "366" }, { paymentTermDays: "-5" }, { paymentTermDays: "1.5" }, { phone: 123 }, { active: "ya" }, { aliases: "x" }, { name: "x".repeat(201) }]) {
    const r = await a.patch(`/api/finance/suppliers/${sup.id}`, body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.deepEqual(await testPrisma.finSupplier.findUnique({ where: { id: sup.id } }), awal);
  assert.equal((await riwayat(sup.id)).length, 0);
});

test("izin & keberadaan: SALES 403, tanpa login 401, id tak dikenal 404 — tanpa efek", async () => {
  const { a, s, anon, sup } = await siapkan();
  assert.equal((await s.patch(`/api/finance/suppliers/${sup.id}`, { name: "Dibajak" })).status, 403);
  assert.equal((await anon.patch(`/api/finance/suppliers/${sup.id}`, { name: "Dibajak" })).status, 401);
  assert.equal((await a.patch("/api/finance/suppliers/00000000-0000-4000-8000-000000000000", { name: "X" })).status, 404);
  assert.equal((await testPrisma.finSupplier.findUnique({ where: { id: sup.id } })).name, "CV Lama");
  assert.equal((await riwayat(sup.id)).length, 0);
});

test("nonaktif: daftar default menyembunyikan, includeInactive=1 menampilkan; tagihan BARU ditolak 409, utang lama tetap bisa dibayar; aktif lagi → tagihan baru bisa", async () => {
  const { a, sup, bank, kat } = await siapkan();
  const buat = (extra = {}) => a.post("/api/finance/bills", { supplierId: sup.id, billDate: "2026-09-10", amount: 500_000, description: "Jasa jahit", billType: "JASA_OPERASIONAL", expenseCategoryId: kat.id, ...extra });
  const b1 = await buat();
  assert.equal(b1.status, 201, JSON.stringify(b1.body));
  assert.equal((await a.post(`/api/finance/bills/${b1.body.id}/approve`, {})).status, 200);

  assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { active: false })).status, 200);
  assert.equal((await a.get("/api/finance/suppliers")).body.suppliers.length, 0);
  const semua = (await a.get("/api/finance/suppliers?includeInactive=1")).body.suppliers;
  assert.equal(semua.length, 1);
  assert.equal(semua[0].active, false);
  assert.equal(semua[0].sisaUtang, 500_000, "utang tetap terlihat walau supplier nonaktif");

  const ditolak = await buat();
  assert.equal(ditolak.status, 409);
  assert.match(ditolak.body.error, /nonaktif/);
  assert.equal(await testPrisma.finSupplierBill.count(), 1, "tidak ada tagihan baru tercipta");

  const bayar = await a.post("/api/finance/supplier-payments", { supplierId: sup.id, date: hariIni(), cashAccountId: bank.id, allocations: [{ billId: b1.body.id, amount: 500_000 }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  assert.equal((await a.get("/api/finance/suppliers?includeInactive=1")).body.suppliers[0].sisaUtang, 0);

  assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { active: true })).status, 200);
  assert.equal((await buat()).status, 201, "aktif lagi → tagihan baru bisa");
  const ev = await riwayat(sup.id);
  assert.deepEqual(ev.map((e) => Object.keys(e.metadata.changes)), [["active"], ["active"]]);
});

test("email: format VALID diterima (termasuk subdomain/plus), format salah ditolak 400 — ditemukan lewat uji browser 7 Okt 2026 (regex sempat salah)", async () => {
  const { a, sup } = await siapkan();
  for (const ok of ["asep@contoh.id", "a.b+c@sub.contoh.co.id", "  spasi@x.io  "]) {
    const r = await a.patch(`/api/finance/suppliers/${sup.id}`, { email: ok });
    assert.equal(r.status, 200, `${ok} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal((await testPrisma.finSupplier.findUnique({ where: { id: sup.id } })).email, ok.trim());
  }
  for (const salah of ["a@b", "a b@c.id", "@x.id", "x@.id", "tanpa-at.id"]) assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { email: salah })).status, 400, salah);
  assert.equal((await a.patch(`/api/finance/suppliers/${sup.id}`, { email: "" })).status, 200, "email boleh dikosongkan");
  assert.equal((await testPrisma.finSupplier.findUnique({ where: { id: sup.id } })).email, null);
});
