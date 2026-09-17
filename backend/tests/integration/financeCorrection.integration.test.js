// Test integrasi ALUR KOREKSI TRANSAKSI FINANCE terhadap PostgreSQL sungguhan.
//
// KENAPA FILE INI ADA. 17 September 2026 (permintaan owner, sistem baru
// mulai dipakai): transaksi yang SUDAH diposting harus bisa "diedit" lewat
// admin, tapi TANPA melanggar prinsip append-only ledger yang jadi fondasi
// seluruh Finance Workspace. Solusinya: reversal jurnal lama + posting
// jurnal baru dengan nilai yang dikoreksi, satu transaksi atomik.
//
// Ini MUSTAHIL diverifikasi tanpa Postgres sungguhan karena TEPAT bug yang
// sempat lolos saat menulis fitur ini sendiri (bukan teori):
//   1. Jurnal PENGAKUAN BEBAN dan jurnal PEMBAYARAN expense dua-duanya
//      memakai `source: "PENGELUARAN"` DAN `sourceId` yang SAMA — mencari
//      "jurnal aktif" lewat source+sourceId polos mengembalikan SALAH SATU
//      secara acak (tergantung urutan Postgres), meninggalkan satu jurnal
//      tidak terbalik. Cuma ketahuan kalau benar-benar ada DUA baris
//      fin_journal_lines konkret di database untuk dicek jumlahnya.
//   2. idempotencyKey UNIQUE menolak jurnal pengganti memakai key yang
//      sama dengan jurnal lama yang sudah REVERSED — constraint ini cuma
//      ditegakkan Postgres, bukan kode aplikasi.
//   3. /cancel yang ditulis SEBELUM fitur koreksi ada mencari jurnal lewat
//      idempotencyKey PERSIS — kalau dokumennya sudah pernah dikoreksi,
//      pencarian itu menemukan entry lama yang sudah REVERSED (status
//      salah), bukan entry pengganti yang sebenarnya aktif sekarang.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { toMoney } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

let server;
test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
});
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkanFinance() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));

  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekeningKas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekeningKas.id);

  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekeningBank = await testPrisma.finCashAccount.create({ data: { name: "Bank Operasional", kind: "BANK", accountId: akunBank.id } });

  return { rekeningKas, rekeningBank };
}

// STATUS_DIHITUNG (POSTED + REVERSED), BUKAN cuma "POSTED" — jurnal yang
// sudah dibalik TETAP masuk hitungan bersama pembaliknya (dua-duanya
// status POSTED/REVERSED, keduanya "dihitung"), supaya netnya pas nol dan
// yang tersisa cuma efek jurnal PENGGANTI yang benar-benar aktif. Menyaring
// "POSTED" saja keliru: entry lama yang sudah REVERSED memang berhenti
// POSTED, tapi entry REVERSAL-nya sendiri berstatus POSTED — menghitung
// reversal tanpa entry aslinya berarti cuma menghitung SEPARUH pembatalan.
async function saldoRekening(cashAccountId) {
  const baris = await testPrisma.finJournalLine.findMany({
    where: { cashAccountId, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { debit: true, credit: true },
  });
  return baris.reduce((acc, b) => acc.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0));
}

async function jumlahJurnalUntukSumber(source, sourceId) {
  return testPrisma.finJournalEntry.count({ where: { source, sourceId } });
}

test("Koreksi EXPENSE mode LANGSUNG: jurnal lama dibalik, jurnal baru dengan nominal benar, saldo rekening TIDAK dobel-hitung", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);

  const kategori = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });

  const created = await client.post("/api/finance/expenses", {
    date: "2026-09-10", amount: 100_000, description: "Bensin (salah ketik)",
    categoryId: kategori.id, mode: "LANGSUNG", cashAccountId: rekeningKas.id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await client.post(`/api/finance/expenses/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DIBAYAR");

  assert.equal((await saldoRekening(rekeningKas.id)).toFixed(2), "-100000.00", "kas berkurang 100rb sesuai nominal awal");

  const koreksi = await client.post(`/api/finance/expenses/${created.body.id}/koreksi`, {
    amount: 250_000, reason: "salah ketik, harusnya 250rb",
  });
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));
  assert.equal(koreksi.body.amount, 250_000);

  assert.equal(
    (await saldoRekening(rekeningKas.id)).toFixed(2), "-250000.00",
    "setelah koreksi, kas berkurang PERSIS 250rb — bukan 100rb+250rb (dobel) dan bukan tetap 100rb (jurnal lama gagal dibalik)"
  );

  // reverseJournal() menulis entry BALIK dengan source:"REVERSAL" &
  // sourceId MENUNJUK KE ENTRY ASLI (bukan expenseId) — jadi entry balik
  // TIDAK ikut kehitung oleh filter source:"PENGELUARAN"+sourceId:expenseId
  // di bawah ini. Yang match hanya 2: entry asli (kini REVERSED) + entry
  // pengganti (POSTED) — entry balik dicek terpisah.
  const jumlahJurnal = await jumlahJurnalUntukSumber("PENGELUARAN", created.body.id);
  assert.equal(jumlahJurnal, 2, "2 baris ber-source PENGELUARAN: jurnal asli (kini REVERSED) + jurnal pengganti (POSTED)");

  const posted = await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN", sourceId: created.body.id, status: "POSTED" } });
  assert.equal(posted, 1, "tepat SATU jurnal POSTED aktif setelah koreksi, tidak lebih tidak kurang");

  const reversal = await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL", sourceId: { in: (await testPrisma.finJournalEntry.findMany({ where: { source: "PENGELUARAN", sourceId: created.body.id, status: "REVERSED" }, select: { id: true } })).map((r) => r.id) } } });
  assert.equal(reversal, 1, "tepat satu entry REVERSAL menunjuk balik ke entry asli yang dibatalkan");
});

test("Koreksi EXPENSE mode REIMBURSEMENT yang sudah DIBAYAR: DUA jurnal (pengakuan + pembayaran) dua-duanya ikut dibalik & diposting ulang", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token, user } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const kategori = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });

  const created = await client.post("/api/finance/expenses", {
    date: "2026-09-10", amount: 500_000, description: "Servis kendaraan ditalangi",
    categoryId: kategori.id, mode: "REIMBURSEMENT", reimburseToId: user.id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await client.post(`/api/finance/expenses/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DISETUJUI", "REIMBURSEMENT belum DIBAYAR cuma karena disetujui");

  const bayar = await client.post(`/api/finance/expenses/${created.body.id}/pay`, { cashAccountId: rekeningKas.id });
  assert.equal(bayar.status, 200, JSON.stringify(bayar.body));
  assert.equal(bayar.body.status, "DIBAYAR");
  assert.equal((await saldoRekening(rekeningKas.id)).toFixed(2), "-500000.00");

  // Sebelum koreksi: 2 jurnal POSTED aktif (pengakuan beban + pembayaran).
  const aktifSebelum = await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN", sourceId: created.body.id, status: "POSTED" } });
  assert.equal(aktifSebelum, 2);

  const koreksi = await client.post(`/api/finance/expenses/${created.body.id}/koreksi`, {
    amount: 750_000, reason: "nota tambahan ditemukan belakangan",
  });
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));
  assert.equal(koreksi.body.status, "DIBAYAR", "status DIBAYAR tetap dipertahankan, koreksi bukan pembatalan");

  assert.equal(
    (await saldoRekening(rekeningKas.id)).toFixed(2), "-750000.00",
    "kas berkurang PERSIS 750rb — membuktikan jurnal PEMBAYARAN lama benar-benar terbalik, bukan cuma jurnal pengakuan"
  );

  const aktifSesudah = await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN", sourceId: created.body.id, status: "POSTED" } });
  assert.equal(aktifSesudah, 2, "tetap 2 jurnal aktif (pengakuan + pembayaran pengganti), tidak ada yang tertinggal REVERSED tapi dianggap aktif");

  // 2 keluarga jurnal (pengakuan + pembayaran), masing-masing (asli+pengganti)
  // ber-source PENGELUARAN — entry balik source:"REVERSAL" dicek terpisah
  // di test sebelumnya, tidak diulang di sini.
  const totalEntry = await jumlahJurnalUntukSumber("PENGELUARAN", created.body.id);
  assert.equal(totalEntry, 4, "4 baris ber-source PENGELUARAN: (asli+pengganti) x 2 keluarga jurnal");
});

test("Cancel SETELAH koreksi tetap membalik jurnal yang BENAR-BENAR aktif (bukan jurnal lama yang sudah REVERSED)", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const kategori = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });

  const created = await client.post("/api/finance/expenses", {
    date: "2026-09-10", amount: 100_000, description: "Uji cancel setelah koreksi",
    categoryId: kategori.id, mode: "LANGSUNG", cashAccountId: rekeningKas.id,
  });
  await client.post(`/api/finance/expenses/${created.body.id}/approve`, {});
  await client.post(`/api/finance/expenses/${created.body.id}/koreksi`, { amount: 300_000, reason: "koreksi dulu" });
  assert.equal((await saldoRekening(rekeningKas.id)).toFixed(2), "-300000.00");

  const batal = await client.post(`/api/finance/expenses/${created.body.id}/cancel`, { reason: "ternyata dobel input" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(batal.body.status, "DIBATALKAN");

  assert.equal(
    (await saldoRekening(rekeningKas.id)).toFixed(2), "0.00",
    "setelah cancel, saldo kembali 0 — kalau /cancel keliru mencari jurnal ASLI (bukan yang aktif pasca-koreksi), saldo akan tersisa -300000 karena jurnal pengganti tidak pernah ikut dibalik"
  );
});

test("Koreksi TRANSFER: saldo kedua rekening mencerminkan nominal BARU, bukan nominal lama ditambah baru", async () => {
  const { rekeningKas, rekeningBank } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);

  const created = await client.post("/api/finance/transfers", {
    date: "2026-09-10", fromAccountId: rekeningKas.id, toAccountId: rekeningBank.id, amount: 1_000_000,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await saldoRekening(rekeningKas.id)).toFixed(2), "-1000000.00");
  assert.equal((await saldoRekening(rekeningBank.id)).toFixed(2), "1000000.00");

  const koreksi = await client.post(`/api/finance/transfers/${created.body.id}/koreksi`, {
    amount: 1_500_000, reason: "kurang catat 500rb",
  });
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));

  assert.equal((await saldoRekening(rekeningKas.id)).toFixed(2), "-1500000.00");
  assert.equal((await saldoRekening(rekeningBank.id)).toFixed(2), "1500000.00");

  const posted = await testPrisma.finJournalEntry.count({ where: { source: "TRANSFER_KAS", sourceId: created.body.id, status: "POSTED" } });
  assert.equal(posted, 1);
});

test("Koreksi OTHER INCOME: saldo rekening tujuan mencerminkan nominal BARU", async () => {
  const { rekeningBank } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const akunPendapatan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PENDAPATAN_LAIN } });

  const created = await client.post("/api/finance/other-income", {
    date: "2026-09-10", amount: 200_000, description: "Jual kardus bekas",
    accountId: akunPendapatan.id, cashAccountId: rekeningBank.id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await saldoRekening(rekeningBank.id)).toFixed(2), "200000.00");

  const koreksi = await client.post(`/api/finance/other-income/${created.body.id}/koreksi`, {
    amount: 350_000, reason: "kurang catat",
  });
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));
  assert.equal((await saldoRekening(rekeningBank.id)).toFixed(2), "350000.00");
});

test("PATCH edit pengeluaran HANYA sah selama DRAFT/MENUNGGU_APPROVAL — ditolak untuk yang sudah diposting (arahkan ke koreksi)", async () => {
  await siapkanFinance();
  const { token, user } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const kategori = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });

  // REIMBURSEMENT — tidak butuh cashAccountId saat DRAFT, jadi PATCH-nya
  // murni menguji edit field biasa, bukan terjebak validasi mode LANGSUNG.
  const created = await client.post("/api/finance/expenses", {
    date: "2026-09-10", amount: 100_000, description: "Draft dulu", categoryId: kategori.id,
    mode: "REIMBURSEMENT", reimburseToId: user.id, langsungAjukan: false,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "DRAFT");

  const edit = await client.patch(`/api/finance/expenses/${created.body.id}`, { amount: 150_000, description: "Sudah benar" });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.amount, 150_000);
  assert.equal(edit.body.description, "Sudah benar");

  const jurnal = await jumlahJurnalUntukSumber("PENGELUARAN", created.body.id);
  assert.equal(jurnal, 0, "DRAFT belum pernah menyentuh buku besar sama sekali");

  await client.post(`/api/finance/expenses/${created.body.id}/submit`, {});
  const approved = await client.post(`/api/finance/expenses/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DISETUJUI");

  const editSetelahPosting = await client.patch(`/api/finance/expenses/${created.body.id}`, { amount: 999_000 });
  assert.equal(editSetelahPosting.status, 409, JSON.stringify(editSetelahPosting.body));
});

test("Koreksi & edit HANYA admin — role FINANCE biasa ditolak 403", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  const client = makeClient(server.baseUrl, token);
  const kategori = await testPrisma.finExpenseCategory.findFirst({ where: { active: true } });

  const created = await client.post("/api/finance/expenses", {
    date: "2026-09-10", amount: 100_000, description: "Uji permission", categoryId: kategori.id,
    mode: "LANGSUNG", cashAccountId: rekeningKas.id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const edit = await client.patch(`/api/finance/expenses/${created.body.id}`, { amount: 200_000 });
  assert.equal(edit.status, 403, "FINANCE_POST/APPROVE bukan FINANCE_ADMIN — edit tetap harus ditolak");

  await client.post(`/api/finance/expenses/${created.body.id}/approve`, {});
  const koreksi = await client.post(`/api/finance/expenses/${created.body.id}/koreksi`, { amount: 200_000, reason: "coba" });
  assert.equal(koreksi.status, 403);
});
