// Rekonsiliasi Bank — periode SEMENTARA (DRAF_MENUNGGU_MUTASI): pembuatan idempoten, tanpa mutasi fiktif/jurnal/saldo baru, Penyesuaian Buku terpisah dari transaksi bank,
// aturan penyelesaian ketat (mutasi asli + semua cocok + selisih nol), transisi ke DRAFT saat mutasi asli masuk, dan tautan periode dari saldo-riil.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";
import { buatPeriodeSementara, evaluasiSelesai, PERIODE_SEMENTARA_20260919 } from "../../src/services/finance/rekonBank.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.accessToken };
}
const idem = () => ({ "Idempotency-Key": crypto.randomUUID() });
const get = (u, p) => raw("GET", `/api/finance${p}`, { token: u.token });
const post = (u, p, body) => raw("POST", `/api/finance${p}`, { token: u.token, headers: idem(), body });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = (k) => testPrisma.finAccount.findUnique({ where: { systemKey: k } });
  const bank = await akun(SYSTEM_KEYS.BANK);
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: bank.id } });
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  const koreksi = await testPrisma.finAccount.findFirst({ where: { systemKey: SYSTEM_KEYS.KOREKSI_SALDO_AWAL } });
  const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  const j = (rek, tanggal, nilai, extra = {}) => testPrisma.$transaction((tx) => postJournal(tx, {
    date: tanggal, description: extra.description ?? `uji ${tanggal}`, source: extra.source ?? "MANUAL", idempotencyKey: extra.key ?? null, userId: admin.id,
    lines: [{ accountId: rek.accountId, cashAccountId: rek.id, ...(toMoney(nilai).greaterThan(0) ? { debit: toMoney(nilai) } : { credit: toMoney(nilai).abs() }) }, { accountId: extra.source === "SALDO_AWAL" ? koreksi.id : modal.id, ...(toMoney(nilai).greaterThan(0) ? { credit: toMoney(nilai) } : { debit: toMoney(nilai).abs() }) }],
  }));
  // PT: buku akhir 39.180.615 (mutasi 40.000.000 − koreksi kas ganda 819.385) · KEM: buku akhir 7.439.069 (10.000.000 − kalibrasi 2.560.931)
  const mutasiPT = await j(pt, "2026-09-19", "40000000", { description: "mutasi bank PT (manual)" });
  await j(pt, "2026-09-21", "-819385", { source: "SALDO_AWAL", key: "KOREKSI_KAS_GANDA:uji-1", description: "Koreksi kas ganda — PT Sano" });
  await j(kem, "2026-09-19", "10000000", { description: "mutasi bank KEM (manual)" });
  await j(kem, "2026-09-19", "-2560931", { source: "SALDO_AWAL", key: "KALIBRASI_UJI", description: "Kalibrasi saldo riil" });
  return { pt, kem, admin, mutasiPT };
}
const hitung = async () => ({ jurnal: await testPrisma.finJournalEntry.count(), barisJurnal: await testPrisma.finJournalLine.count(), mutasiBank: await testPrisma.finBankStatementLine.count() });

test("Aturan penyelesaian (murni): butuh status DRAFT, mutasi asli, semua cocok, selisih nol", () => {
  const ok = evaluasiSelesai({ status: "DRAFT", jumlahBaris: 3, belumCocok: 0, selisih: 0 });
  assert.equal(ok.bisa, true);
  assert.equal(evaluasiSelesai({ status: "DRAF_MENUNGGU_MUTASI", jumlahBaris: 0, belumCocok: 0, selisih: 0 }).bisa, false);
  assert.equal(evaluasiSelesai({ status: "DRAFT", jumlahBaris: 0, belumCocok: 0, selisih: 0 }).bisa, false, "tanpa mutasi asli");
  assert.equal(evaluasiSelesai({ status: "DRAFT", jumlahBaris: 3, belumCocok: 1, selisih: 0 }).bisa, false);
  assert.equal(evaluasiSelesai({ status: "DRAFT", jumlahBaris: 3, belumCocok: 0, selisih: "-2526981" }).bisa, false);
  assert.equal(evaluasiSelesai({ status: "DRAFT", jumlahBaris: 3, belumCocok: 0, selisih: 0 }).syarat.length, 4);
});

test("Buat periode sementara: 2 periode (PT & KEM), status DRAF_MENUNGGU_MUTASI, tanpa mutasi/jurnal/saldo; jalankan ulang TIDAK membuat periode kedua", async () => {
  const s = await siapkan();
  const sebelum = await hitung();
  const r1 = await buatPeriodeSementara(testPrisma, { userId: s.admin.id });
  assert.deepEqual(r1.map((x) => x.dibuat), [true, true]);
  const r2 = await buatPeriodeSementara(testPrisma, { userId: s.admin.id });
  assert.deepEqual(r2.map((x) => x.dibuat), [false, false]);
  assert.deepEqual(r2.map((x) => x.alasan), ["sudah_ada", "sudah_ada"]);
  await Promise.all([buatPeriodeSementara(testPrisma), buatPeriodeSementara(testPrisma)]); // serempak
  assert.equal(await testPrisma.finBankStatement.count(), 2, "tepat dua periode");
  assert.deepEqual(await hitung(), sebelum, "tidak ada jurnal, baris jurnal, atau mutasi bank baru");

  const per = Object.fromEntries((await testPrisma.finBankStatement.findMany({ include: { cashAccount: true } })).map((x) => [x.cashAccount.name, x]));
  assert.equal(per["PT Sano"].status, "DRAF_MENUNGGU_MUTASI"); assert.equal(per["KEM - Sano Bank"].status, "DRAF_MENUNGGU_MUTASI");
  assert.equal(per["PT Sano"].openingBalance.toFixed(2), "36870615.00"); assert.equal(per["PT Sano"].closingBalance.toFixed(2), "39180615.00");
  assert.equal(per["KEM - Sano Bank"].openingBalance.toFixed(2), "766507.00"); assert.equal(per["KEM - Sano Bank"].closingBalance.toFixed(2), "4912088.00");
  assert.equal(per["PT Sano"].cutoffStartAt.toISOString(), "2026-09-19T13:00:00.000Z"); assert.equal(per["PT Sano"].cutoffEndAt.toISOString(), "2026-09-21T13:00:00.000Z");
  assert.match(per["PT Sano"].note, /mutasi individual belum diverifikasi/); assert.match(per["KEM - Sano Bank"].note, /Rp2\.526\.981/); assert.match(per["KEM - Sano Bank"].note, /rekening koran/);
  assert.equal(per["PT Sano"].completedAt, null);
  // periode manual yang sama (rekening + tanggal) juga tidak digandakan
  await testPrisma.finBankStatement.updateMany({ data: { sourceKey: null } });
  const r3 = await buatPeriodeSementara(testPrisma);
  assert.deepEqual(r3.map((x) => x.alasan), ["periode_sama_sudah_ada", "periode_sama_sudah_ada"]);
  assert.equal(await testPrisma.finBankStatement.count(), 2);
  assert.equal(PERIODE_SEMENTARA_20260919.length, 2);
});

test("Rekening tidak ada → gagal utuh (tidak ada periode setengah jadi)", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const bank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bank.id } }); // KEM tidak ada
  await assert.rejects(() => buatPeriodeSementara(testPrisma), /KEM - Sano Bank/);
  assert.equal(await testPrisma.finBankStatement.count(), 0);
});

test("API: daftar & detail — selisih PT 0 / KEM buku lebih tinggi Rp2.526.981; Penyesuaian Buku terpisah dan bukan kandidat pencocokan", async () => {
  const s = await siapkan();
  await buatPeriodeSementara(testPrisma, { userId: s.admin.id });
  const fin = await masuk(["FINANCE"]);
  const j0 = await hitung();
  const daftar = (await get(fin, "/bank-statements")).body.statements;
  const dPT = daftar.find((x) => x.cashAccount.name === "PT Sano"); const dKEM = daftar.find((x) => x.cashAccount.name === "KEM - Sano Bank");
  assert.equal(dPT.status, "DRAF_MENUNGGU_MUTASI"); assert.equal(dPT.statusLabel, "Draf — menunggu mutasi bank"); assert.equal(dPT.sementara, true);
  assert.equal(dPT.saldoBuku, 39180615); assert.equal(dPT.selisih, 0); assert.equal(dPT.jumlahBaris, 0);
  assert.equal(dKEM.saldoBuku, 7439069); assert.equal(dKEM.bukuLebihTinggi, 2526981); assert.equal(dKEM.selisih, -2526981);

  const det = (await get(fin, `/bank-statements/${dKEM.id}`)).body;
  assert.equal(det.rekonsiliasi.sementara, true);
  assert.match(det.rekonsiliasi.labelSementara, /Rekonsiliasi sementara tanpa rekening koran\. Saldo akhir telah dikonfirmasi owner/);
  assert.equal(det.rekonsiliasi.bukuLebihTinggi, 2526981);
  assert.equal(det.rekonsiliasi.penyelesaian.bisa, false);
  assert.ok(det.rekonsiliasi.penyelesaian.alasan.some((a) => /Belum ada mutasi bank asli/.test(a)));
  assert.equal(det.statement.lines.length, 0, "tidak ada mutasi bank fiktif");
  assert.deepEqual(det.penyesuaianBuku.items.map((x) => x.jenis), ["KALIBRASI_SALDO"]);
  assert.ok(det.kandidat.every((k) => k.source !== "SALDO_AWAL"), "penyesuaian buku bukan kandidat");
  assert.equal(det.kandidat.length, 1, "hanya mutasi manual");

  const detPT = (await get(fin, `/bank-statements/${dPT.id}`)).body;
  assert.equal(detPT.penyesuaianBuku.ringkasan.koreksiKasGanda.jumlah, 1);
  assert.equal(detPT.penyesuaianBuku.ringkasan.koreksiKasGanda.bersih, -819385);
  assert.match(detPT.penyesuaianBuku.catatan, /bukan transaksi bank/i);
  assert.deepEqual(await hitung(), j0, "membaca tidak mengubah apa pun");
});

test("Tidak boleh diselesaikan: periode sementara ditolak (bahkan dengan catatan); setelah mutasi asli masuk jadi DRAFT tetapi tetap ditolak selama belum cocok/selisih ≠ 0", async () => {
  const s = await siapkan();
  await buatPeriodeSementara(testPrisma, { userId: s.admin.id });
  const fin = await masuk(["ADMIN"]);
  const kem = (await get(fin, "/bank-statements")).body.statements.find((x) => x.cashAccount.name === "KEM - Sano Bank");
  let r = await post(fin, `/bank-statements/${kem.id}/complete`, { note: "tutup saja" });
  assert.equal(r.status, 409); assert.match(r.body.error, /belum bisa diselesaikan/); assert.match(r.body.error, /mutasi bank asli/);
  assert.equal((await testPrisma.finBankStatement.findUnique({ where: { id: kem.id } })).status, "DRAF_MENUNGGU_MUTASI");

  // mutasi bank ASLI pertama masuk → DRAFT
  const b = await post(fin, `/bank-statements/${kem.id}/lines`, { date: "2026-09-20", description: "TRSF masuk (koran asli)", amount: "1000000" });
  assert.equal(b.status, 201);
  assert.equal((await testPrisma.finBankStatement.findUnique({ where: { id: kem.id } })).status, "DRAFT");
  r = await post(fin, `/bank-statements/${kem.id}/complete`, { note: "tutup dengan catatan" });
  assert.equal(r.status, 409); assert.match(r.body.error, /belum dicocokkan/); assert.match(r.body.error, /Selisih saldo bank dan buku belum nol/);
  assert.equal((await testPrisma.finBankStatement.findUnique({ where: { id: kem.id } })).completedAt, null);
});

test("Penyesuaian Buku tidak bisa dipasangkan dengan mutasi koran; jalur selesai normal tetap berfungsi (mutasi cocok, selisih nol)", async () => {
  const s = await siapkan();
  await buatPeriodeSementara(testPrisma, { userId: s.admin.id });
  const fin = await masuk(["ADMIN"]);
  const pt = (await get(fin, "/bank-statements")).body.statements.find((x) => x.cashAccount.name === "PT Sano");
  const koreksiLine = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: s.pt.id, entry: { source: "SALDO_AWAL" } } });
  const bLine = (await post(fin, `/bank-statements/${pt.id}/lines`, { date: "2026-09-21", description: "koreksi?", amount: "-819385" })).body;
  const salah = await post(fin, `/bank-lines/${bLine.id}/match`, { journalLineId: koreksiLine.id });
  assert.equal(salah.status, 400); assert.match(salah.body.error, /Penyesuaian Buku/);

  // jalur normal: periode dengan mutasi asli yang cocok & selisih nol
  await testPrisma.finBankStatementLine.delete({ where: { id: bLine.id } });
  const mutasi = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: s.pt.id, entry: { source: "MANUAL" } } });
  const st = (await post(fin, "/bank-statements", { cashAccountId: s.pt.id, periodStart: "2026-08-01", periodEnd: "2026-09-19", openingBalance: "0", closingBalance: "40000000", lines: [{ date: "2026-09-19", description: "koran asli", amount: "40000000" }] })).body;
  const baris = (await get(fin, `/bank-statements/${st.id}`)).body.statement.lines[0];
  assert.equal((await post(fin, `/bank-lines/${baris.id}/match`, { journalLineId: mutasi.id })).status, 200);
  const ok = await post(fin, `/bank-statements/${st.id}/complete`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, "SELESAI");
});

test("saldo-riil menautkan periode (periodeId) untuk Ringkasan; izin & 401", async () => {
  const s = await siapkan();
  await buatPeriodeSementara(testPrisma, { userId: s.admin.id });
  const fin = await masuk(["FINANCE"]);
  const r = (await get(fin, "/saldo-riil")).body;
  const kem = r.rekening.find((x) => x.name === "KEM - Sano Bank");
  const periode = await testPrisma.finBankStatement.findFirst({ where: { cashAccountId: kem.id } });
  assert.equal(kem.periodeId, periode.id); assert.equal(kem.periodeStatus, "DRAF_MENUNGGU_MUTASI");
  assert.equal((await fetch(`${server.baseUrl}/api/finance/bank-statements`)).status, 401);
});
