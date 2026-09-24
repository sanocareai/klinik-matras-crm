// B3 — Rekonsiliasi Cutoff & Late-Posting Guard. Jurnal fixture dibuat langsung dengan created_at terkendali supaya definisi waktu
// (tanggal buku vs waktu dibuat vs high-water mark) teruji persis.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { buatSnapshot, hitungIsiSnapshot, daftarException } from "../../src/services/finance/rekonSnapshot.js";
import { evaluasiSelesai } from "../../src/services/finance/rekonBank.js";
import { postRekonsiliasiSementara } from "../../src/services/finance/posting/rekonsiliasiSementara.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let nomorUrut = 0;
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const lawan = await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true } });
  const rek = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji Cutoff", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  return { rek, lawan, admin, fin, a: makeClient(server.baseUrl, admin.token), f: makeClient(server.baseUrl, fin.token) };
}

/** Jurnal seimbang: nilai>0 = uang masuk rekening. created_at & tanggal buku dikendalikan. */
async function jurnal(ctx, { tanggal, dibuat, nilai, source = "MANUAL", reversalOfId = null, status = "POSTED", sourceId = null }) {
  nomorUrut += 1;
  const n = Math.abs(nilai);
  return testPrisma.finJournalEntry.create({
    data: {
      entryNumber: `JV-UJI-${String(nomorUrut).padStart(4, "0")}`, date: new Date(`${tanggal}T00:00:00Z`), description: "uji", source, sourceId,
      status, reversalOfId, createdAt: new Date(dibuat), postedAt: new Date(dibuat),
      lines: { create: [
        { lineNo: 1, accountId: ctx.rek.accountId, cashAccountId: ctx.rek.id, debit: nilai > 0 ? n : 0, credit: nilai < 0 ? n : 0 },
        { lineNo: 2, accountId: ctx.lawan.id, debit: nilai < 0 ? n : 0, credit: nilai > 0 ? n : 0 },
      ] },
    },
  });
}

async function periode(ctx, { closing = 0, lines = [] } = {}) {
  return testPrisma.finBankStatement.create({
    data: {
      cashAccountId: ctx.rek.id, periodStart: new Date("2026-09-22T00:00:00Z"), periodEnd: new Date("2026-09-22T00:00:00Z"),
      openingBalance: 0, closingBalance: closing, status: lines.length ? "DRAFT" : "DRAF_MENUNGGU_MUTASI",
      cutoffStartAt: new Date("2026-09-21T13:00:00Z"), cutoffEndAt: new Date("2026-09-22T12:00:00Z"),
      ...(lines.length ? { lines: { create: lines } } : {}),
    },
  });
}

const HWM = "2026-09-22T14:33:00Z";

test("Snapshot tidak berubah setelah jurnal baru; backdated masuk Posting Setelah Cutoff; jurnal sesudah periode tidak masuk", async () => {
  const ctx = await siapkan();
  await jurnal(ctx, { tanggal: "2026-09-20", dibuat: "2026-09-20T05:00:00Z", nilai: 1_000_000 });
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T10:00:00Z", nilai: 500_000 });
  const s = await periode(ctx, { closing: 1_500_000 });
  const r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/snapshot`, { hwmAt: HWM, confirmedSource: "Konfirmasi owner (uji)", explanation: "bukti uji" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.snapshot.saldoBuku, 1_500_000);
  assert.equal(r.body.snapshot.selisih, 0);
  const tersimpan = await testPrisma.finReconSnapshot.findUnique({ where: { statementId: s.id } });

  // Sesudah snapshot: backdated (tanggal dalam periode & sebelum periode), satu jurnal sesudah periode.
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-23T02:00:00Z", nilai: -200_000 });
  await jurnal(ctx, { tanggal: "2026-09-19", dibuat: "2026-09-24T02:00:00Z", nilai: -50_000 });
  await jurnal(ctx, { tanggal: "2026-09-23", dibuat: "2026-09-23T03:00:00Z", nilai: 999_999 });

  const c = await ctx.f.get(`/api/finance/bank-statements/${s.id}/cutoff`);
  assert.equal(c.status, 200);
  assert.equal(c.body.snapshot.saldoBuku, 1_500_000, "angka snapshot TIDAK ikut berubah");
  assert.equal(c.body.postingSetelahCutoff.length, 2);
  assert.ok(c.body.postingSetelahCutoff.some((p) => p.tanggalSebelumPeriode), "backdated sebelum periode ditandai");
  assert.equal(c.body.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.total, -250_000);
  assert.equal(c.body.diLuarPeriode.jumlah, 1, "jurnal bertanggal sesudah periode tidak masuk");
  assert.equal(c.body.saldoBukuSekarang, 1_250_000);
  assert.equal(c.body.identitas.konsisten, true);
  assert.equal(c.body.valid, true);

  const lagi = await testPrisma.finReconSnapshot.findUnique({ where: { statementId: s.id } });
  assert.deepEqual(lagi, tersimpan, "record snapshot identik byte-demi-byte");
});

test("Reversal setelah snapshot tampil terpisah dan identitas saldo tetap konsisten", async () => {
  const ctx = await siapkan();
  const asli = await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: -300_000, source: "PENGELUARAN" });
  const s = await periode(ctx, { closing: -300_000 });
  await testPrisma.$transaction((tx) => buatSnapshot(tx, { statementId: s.id, hwmAt: HWM, confirmedSource: "uji", explanation: "bukti" }));
  await testPrisma.finJournalEntry.update({ where: { id: asli.id }, data: { status: "REVERSED" } });
  await jurnal(ctx, { tanggal: "2026-09-24", dibuat: "2026-09-24T01:00:00Z", nilai: 300_000, source: "REVERSAL", reversalOfId: asli.id });
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-24T01:05:00Z", nilai: 300_000, source: "REVERSAL" });
  const c = await ctx.f.get(`/api/finance/bank-statements/${s.id}/cutoff`);
  assert.equal(c.body.reversalSetelahSnapshot.length, 1, "reversal bertanggal buku sesudah periode tidak mengubah periode ini");
  assert.equal(c.body.postingSetelahCutoff.length, 0);
  assert.equal(c.body.snapshot.saldoBuku, -300_000);
  assert.equal(c.body.identitas.konsisten, true);
});

test("Snapshot tidak berlaku bila jurnal yang sudah termasuk snapshot berubah; verifikasi integritas mendeteksinya", async () => {
  const ctx = await siapkan();
  const j = await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: 100_000 });
  const s = await periode(ctx, { closing: 100_000 });
  await testPrisma.$transaction((tx) => buatSnapshot(tx, { statementId: s.id, hwmAt: HWM, confirmedSource: "uji", explanation: "bukti" }));
  let v = await ctx.f.post(`/api/finance/bank-statements/${s.id}/snapshot/verifikasi`, {});
  assert.equal(v.body.cocok, true);
  // Simulasi kerusakan data (bukan jalur aplikasi): baris jurnal lama diubah.
  await testPrisma.finJournalLine.updateMany({ where: { entryId: j.id, cashAccountId: ctx.rek.id }, data: { debit: 90_000 } });
  await testPrisma.finJournalLine.updateMany({ where: { entryId: j.id, cashAccountId: null }, data: { credit: 90_000 } });
  const c = await ctx.f.get(`/api/finance/bank-statements/${s.id}/cutoff`);
  assert.equal(c.body.valid, false);
  assert.match(c.body.alasanTidakBerlaku, /berubah atau hilang/);
  v = await ctx.f.post(`/api/finance/bank-statements/${s.id}/snapshot/verifikasi`, {});
  assert.equal(v.body.cocok, false);
});

test("Snapshot immutable di level DB: UPDATE kolom inti & DELETE ditolak; invalidasi hanya sekali", async () => {
  const ctx = await siapkan();
  const s = await periode(ctx, { closing: 0 });
  const { snapshot } = await testPrisma.$transaction((tx) => buatSnapshot(tx, { statementId: s.id, confirmedSource: "uji" }));
  await assert.rejects(testPrisma.finReconSnapshot.update({ where: { id: snapshot.id }, data: { bookBalance: 1 } }), /immutable/);
  await assert.rejects(testPrisma.finReconSnapshot.delete({ where: { id: snapshot.id } }), /immutable/);
  const r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/snapshot/tidak-berlaku`, { reason: "salah input saldo riil" });
  assert.equal(r.status, 200);
  const r2 = await ctx.a.post(`/api/finance/bank-statements/${s.id}/snapshot/tidak-berlaku`, { reason: "lagi" });
  assert.equal(r2.status, 409);
  await assert.rejects(testPrisma.finReconSnapshot.update({ where: { id: snapshot.id }, data: { invalidReason: "ubah" } }), /tidak berlaku/);
});

test("Concurrent snapshot: 8 permintaan paralel menghasilkan SATU record", async () => {
  const ctx = await siapkan();
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: 10_000 });
  const s = await periode(ctx, { closing: 10_000 });
  const hasil = await Promise.all(Array.from({ length: 8 }, () => ctx.a.post(`/api/finance/bank-statements/${s.id}/snapshot`, { confirmedSource: "uji paralel" })));
  assert.ok(hasil.every((h) => [200, 201].includes(h.status)), JSON.stringify(hasil.map((h) => h.status)));
  assert.equal(hasil.filter((h) => h.status === 201).length, 1);
  assert.equal(await testPrisma.finReconSnapshot.count({ where: { statementId: s.id } }), 1);
  assert.equal(new Set(hasil.map((h) => h.body.snapshot.id)).size, 1);
});

test("HWM masa lalu wajib penjelasan; HWM masa depan ditolak; hanya FINANCE_ADMIN yang boleh membuat snapshot", async () => {
  const ctx = await siapkan();
  const s = await periode(ctx);
  assert.equal((await ctx.a.post(`/api/finance/bank-statements/${s.id}/snapshot`, { hwmAt: HWM, confirmedSource: "uji" })).status, 400);
  assert.equal((await ctx.a.post(`/api/finance/bank-statements/${s.id}/snapshot`, { hwmAt: "2099-01-01T00:00:00Z", confirmedSource: "uji" })).status, 400);
  assert.equal((await ctx.f.post(`/api/finance/bank-statements/${s.id}/snapshot`, { confirmedSource: "uji" })).status, 403);
  assert.equal(await testPrisma.finReconSnapshot.count(), 0);
});

test("SELESAI ditolak tanpa mutasi bank asli", async () => {
  const ctx = await siapkan();
  const s = await periode(ctx, { closing: 0 });
  const r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/complete`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /mutasi bank asli/i);
  assert.equal((await testPrisma.finBankStatement.findUnique({ where: { id: s.id } })).status, "DRAF_MENUNGGU_MUTASI");
});

test("SELESAI ditolak bila ada exception terbuka; setelah ditinjau (tanpa mengubah data) boleh selesai dan snapshot otomatis dibuat", async () => {
  const ctx = await siapkan();
  const kat = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });
  const exp = await testPrisma.finExpense.create({
    data: { expenseNumber: "EXP-UJI-001", date: new Date("2026-09-22T00:00:00Z"), amount: 7_500, description: "uji", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: ctx.rek.id, status: "DIBAYAR" },
  });
  const j = await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: -7_500, source: "PENGELUARAN", sourceId: exp.id, status: "REVERSED" });
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:05:00Z", nilai: 7_500, source: "REVERSAL", reversalOfId: j.id });
  const s = await periode(ctx, { closing: 0, lines: [{ date: new Date("2026-09-22T00:00:00Z"), description: "tanpa mutasi", amount: 0, status: "DIABAIKAN", note: "uji" }] });

  const exc = await daftarException(testPrisma, { cashAccountId: ctx.rek.id });
  assert.equal(exc.terbuka, 1);
  assert.equal(exc.items[0].kode, "DOKUMEN_AKTIF_JURNAL_DIBALIK");

  let r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/complete`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /exception/i);

  const t = await ctx.a.post("/api/finance/rekon/perlu-ditinjau/tinjau", { kode: "DOKUMEN_AKTIF_JURNAL_DIBALIK", refId: exp.id, catatan: "Biaya sudah masuk utang supplier; status dokumen dirapikan Finance" });
  assert.equal(t.status, 200);
  assert.equal((await testPrisma.finExpense.findUnique({ where: { id: exp.id } })).status, "DIBAYAR", "data TIDAK diubah otomatis");

  r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/complete`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const snap = await testPrisma.finReconSnapshot.findUnique({ where: { statementId: s.id } });
  assert.ok(snap, "penyelesaian membuat snapshot");
});

test("SELESAI ditolak bila rekening masih punya saldo 2-1700 (dana belum teridentifikasi)", async () => {
  const ctx = await siapkan();
  const { user } = await createTestUser({ roles: ["ADMIN"] });
  await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, {
    cashAccountId: ctx.rek.id, cashAccountLedgerId: ctx.rek.accountId, cashAccountName: ctx.rek.name, amount: 1_000, tanggalBuku: "2026-09-22",
    keterangan: "Penyesuaian sementara uji", userId: user.id,
  }));
  const s = await periode(ctx, { closing: 1_000, lines: [{ date: new Date("2026-09-22T00:00:00Z"), description: "masuk", amount: 1_000, status: "DIABAIKAN", note: "uji" }] });
  const r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/complete`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /identifikasi/i);
});

test("evaluasiSelesai: pemanggil lama (tanpa parameter B3) tetap berperilaku sama", () => {
  const ev = evaluasiSelesai({ status: "DRAFT", jumlahBaris: 1, belumCocok: 0, selisih: 0, danaBelumTeridentifikasi: 0 });
  assert.equal(ev.bisa, true);
  assert.equal(evaluasiSelesai({ status: "DRAFT", jumlahBaris: 1, belumCocok: 0, selisih: 0, snapshotValid: false }).bisa, false);
});

test("Backward-compatible: daftar & detail periode (web + mobile /buku/rekon) tetap memuat field lama, field cutoff aditif", async () => {
  const ctx = await siapkan();
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: 10_000 });
  const s = await periode(ctx, { closing: 10_000 });
  await testPrisma.$transaction((tx) => buatSnapshot(tx, { statementId: s.id, hwmAt: HWM, confirmedSource: "uji", explanation: "bukti" }));
  const d = await ctx.f.get("/api/finance/bank-statements");
  const it = d.body.statements.find((x) => x.id === s.id);
  for (const k of ["openingBalance", "closingBalance", "saldoBuku", "selisih", "statusLabel", "jumlahBaris", "belumCocok"]) assert.ok(k in it, k);
  assert.equal(it.cutoffInfo.adaSnapshot, true);
  const det = await ctx.f.get(`/api/finance/bank-statements/${s.id}`);
  for (const k of ["statement", "kandidat", "rekonsiliasi", "penyesuaianBuku", "danaBelumTeridentifikasi"]) assert.ok(k in det.body, k);
  assert.ok(det.body.rekonsiliasi.penyelesaian.syarat.some((x) => x.kode === "SNAPSHOT_BERLAKU"));
  const ekspor = await fetch(`${server.baseUrl}/api/finance/bank-statements/${s.id}/ekspor-audit`, { headers: { Authorization: `Bearer ${ctx.fin.token}` } });
  const teks = await ekspor.text();
  assert.equal(ekspor.status, 200);
  assert.match(teks, /hash_jurnal/);
  assert.ok(!/uji/.test(teks.replace(/Bank Uji Cutoff/g, "")), "ekspor tidak memuat keterangan jurnal/dokumen");
});

test("hitungIsiSnapshot: hash deterministik terhadap urutan dan hanya jurnal <= HWM", async () => {
  const ctx = await siapkan();
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: 1 });
  const s = await periode(ctx);
  const a = await hitungIsiSnapshot(testPrisma, { cashAccountId: ctx.rek.id, periodStart: s.periodStart, periodEnd: s.periodEnd, hwmAt: new Date(HWM) });
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-23T09:00:00Z", nilai: 5 });
  const b = await hitungIsiSnapshot(testPrisma, { cashAccountId: ctx.rek.id, periodStart: s.periodStart, periodEnd: s.periodEnd, hwmAt: new Date(HWM) });
  assert.equal(a.entryHash, b.entryHash);
  assert.equal(b.entryCount, 1);
  assert.ok(randomUUID());
});

test("'Ditinjau' TIDAK otomatis berarti 'Selesai': status periode tetap, dan syarat lain (mutasi asli, selisih nol) tetap menahan", async () => {
  const ctx = await siapkan();
  const kat = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });
  const exp = await testPrisma.finExpense.create({
    data: { expenseNumber: "EXP-UJI-002", date: new Date("2026-09-22T00:00:00Z"), amount: 5_000, description: "uji", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: ctx.rek.id, status: "DIBAYAR" },
  });
  const j = await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:00:00Z", nilai: -5_000, source: "PENGELUARAN", sourceId: exp.id, status: "REVERSED" });
  await jurnal(ctx, { tanggal: "2026-09-22", dibuat: "2026-09-22T09:05:00Z", nilai: 5_000, source: "REVERSAL", reversalOfId: j.id });
  // Periode SEMENTARA (tanpa mutasi bank asli) dan selisih tidak nol.
  const s = await periode(ctx, { closing: 123_456 });
  const t = await ctx.a.post("/api/finance/rekon/perlu-ditinjau/tinjau", { kode: "DOKUMEN_AKTIF_JURNAL_DIBALIK", refId: exp.id, catatan: "sudah diperiksa" });
  assert.equal(t.status, 200);
  const det = await ctx.f.get(`/api/finance/bank-statements/${s.id}`);
  assert.equal(det.body.perluDitinjau.terbuka, 0, "exception tidak lagi menahan");
  assert.equal(det.body.perluDitinjau.items[0].ditinjau.catatan, "sudah diperiksa", "tetap tercatat & tampil");
  const syarat = Object.fromEntries(det.body.rekonsiliasi.penyelesaian.syarat.map((x) => [x.kode, x.ok]));
  assert.equal(syarat.TANPA_EXCEPTION, true);
  assert.equal(syarat.MUTASI_ASLI, false);
  assert.equal(syarat.SELISIH_NOL, false);
  assert.equal(det.body.rekonsiliasi.penyelesaian.bisa, false);
  const r = await ctx.a.post(`/api/finance/bank-statements/${s.id}/complete`, {});
  assert.equal(r.status, 409);
  assert.notEqual((await testPrisma.finBankStatement.findUnique({ where: { id: s.id } })).status, "SELESAI");
});
