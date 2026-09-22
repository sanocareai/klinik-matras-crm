// Test integrasi PENYESUAIAN SEMENTARA REKONSILIASI BANK
// (services/finance/posting/rekonsiliasiSementara.js) terhadap PostgreSQL
// sungguhan — fokus pada idempotensi (kunci pertama, dari task ini:
// "Gunakan source dan idempotency key khusus rekonsiliasi sementara agar
// tidak dapat terposting dua kali") dan bahwa akun 2-1700 BUKAN pendapatan/
// ekuitas/3-4100.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRekonsiliasiSementara, KEY } from "../../src/services/finance/posting/rekonsiliasiSementara.js";
import { saldoBelumTeridentifikasi, evaluasiSelesai } from "../../src/services/finance/rekonBank.js";
import { toMoney, moneyToNumber } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Rekening Tes", kind: "BANK", accountId: akunBank.id } });
  const { user } = await createTestUser({ roles: ["ADMIN"] });
  return { rekening, user };
}

async function saldoAkun(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { debit: true, credit: true },
  });
  return baris.reduce((acc, b) => acc.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

test("Akun 2-1700 'Dana Masuk Belum Teridentifikasi' terpasang lewat ensureDefaultChartOfAccounts, bertipe KEWAJIBAN kredit — BUKAN pendapatan/ekuitas/3-4100", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = await testPrisma.finAccount.findUnique({ where: { code: "2-1700" } });
  assert.ok(akun, "akun 2-1700 harus terpasang");
  assert.equal(akun.type, "KEWAJIBAN");
  assert.equal(akun.normalBalance, "KREDIT");
  assert.equal(akun.systemKey, SYSTEM_KEYS.DANA_MASUK_BELUM_TERIDENTIFIKASI);
  assert.notEqual(akun.code, "3-4100", "harus akun terpisah dari kalibrasi saldo awal");
});

test("postRekonsiliasiSementara: Dr rekening kas/bank / Cr 2-1700, jurnal SEIMBANG, tidak menyentuh 3-4100", async () => {
  const { rekening, user } = await siapkan();

  const hasil = await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, {
    cashAccountId: rekening.id, cashAccountLedgerId: rekening.accountId, cashAccountName: rekening.name,
    amount: 1_028_719, tanggalBuku: "2026-09-22",
    keterangan: "Penyesuaian sementara rekonsiliasi — menunggu rekening koran; wajib direklasifikasi setelah sumber dana teridentifikasi.",
    userId: user.id,
  }));
  assert.equal(hasil.posted, true);
  assert.equal(hasil.created, true);
  assert.equal(hasil.entry.source, "REKONSILIASI_SEMENTARA");

  assert.equal(await saldoAkun("2-1700"), "-1028719.00", "kredit — kewajiban naik");
  assert.equal(await saldoAkun("3-4100"), "0.00", "akun kalibrasi saldo awal TIDAK disentuh");

  const total = hasil.entry.lines.reduce((t, l) => t.plus(toMoney(l.debit)).minus(toMoney(l.credit)), toMoney(0));
  assert.equal(total.toFixed(2), "0.00", "satu jurnal harus seimbang sendiri");
});

test("Idempotensi: kunci deterministik (rekening + tanggal buku) — dua percobaan posting nominal SAMA menghasilkan SATU jurnal, bukan dua", async () => {
  const { rekening, user } = await siapkan();
  const opts = {
    cashAccountId: rekening.id, cashAccountLedgerId: rekening.accountId, cashAccountName: rekening.name,
    amount: 500_000, tanggalBuku: "2026-09-22", keterangan: "Penyesuaian sementara — tes idempotensi.", userId: user.id,
  };

  const pertama = await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, opts));
  assert.equal(pertama.created, true);

  const kedua = await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, opts));
  assert.equal(kedua.created, false, "percobaan kedua HARUS dikenali sebagai duplikat, bukan jurnal baru");
  assert.equal(kedua.entry.id, pertama.entry.id, "mengembalikan jurnal yang SAMA, bukan membuat yang kedua");

  const jumlahJurnal = await testPrisma.finJournalEntry.count({ where: { idempotencyKey: KEY.rekonsiliasiSementara(rekening.id, "2026-09-22") } });
  assert.equal(jumlahJurnal, 1, "hanya SATU jurnal untuk kunci ini, walau dipanggil dua kali");

  assert.equal(await saldoAkun("2-1700"), "-500000.00", "saldo TIDAK dobel — cuma sekali 500.000, bukan 1.000.000");
});

test("Idempotensi paralel: dua percobaan posting BERSAMAAN (Promise.all) hanya SATU yang menang, sisanya dapat jurnal yang sama", async () => {
  const { rekening, user } = await siapkan();
  const opts = {
    cashAccountId: rekening.id, cashAccountLedgerId: rekening.accountId, cashAccountName: rekening.name,
    amount: 250_000, tanggalBuku: "2026-09-22", keterangan: "Penyesuaian sementara — tes paralel.", userId: user.id,
  };

  // 2 percobaan (bukan lebih) — pool koneksi Prisma test default kecil;
  // jumlah percobaan paralel bukan intinya, intinya kunci idempotensi
  // menang race walau dua transaksi DB terpisah menabrak bersamaan.
  const hasil = await Promise.all([
    testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, opts), { timeout: 20_000, maxWait: 20_000 }),
    testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, opts), { timeout: 20_000, maxWait: 20_000 }),
  ]);
  const idUnik = new Set(hasil.map((h) => h.entry.id));
  assert.equal(idUnik.size, 1, "kedua percobaan paralel harus mengacu ke SATU jurnal yang sama");
  assert.equal(hasil.filter((h) => h.created).length, 1, "hanya SATU yang benar-benar membuat jurnal baru");

  assert.equal(await saldoAkun("2-1700"), "-250000.00", "tidak ada penggandaan akibat race");
});

test("Rekening/tanggal berbeda = kunci berbeda = jurnal terpisah (bukan dianggap duplikat)", async () => {
  const { rekening, user } = await siapkan();
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekeningLain = await testPrisma.finCashAccount.create({ data: { name: "Rekening Tes 2", kind: "BANK", accountId: akunBank.id } });

  const a = await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, {
    cashAccountId: rekening.id, cashAccountLedgerId: rekening.accountId, cashAccountName: rekening.name,
    amount: 100_000, tanggalBuku: "2026-09-22", keterangan: "Rekening A.", userId: user.id,
  }));
  const b = await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, {
    cashAccountId: rekeningLain.id, cashAccountLedgerId: rekeningLain.accountId, cashAccountName: rekeningLain.name,
    amount: 100_000, tanggalBuku: "2026-09-22", keterangan: "Rekening B.", userId: user.id,
  }));
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.notEqual(a.entry.id, b.entry.id, "rekening berbeda = jurnal terpisah, bukan dedup keliru");
  assert.equal(await saldoAkun("2-1700"), "-200000.00", "kedua rekening masuk akun suspense yang sama, totalnya bertambah");
});

test("saldoBelumTeridentifikasi(): total & peringatan muncul saat ada saldo, null saat nol", async () => {
  const { rekening, user } = await siapkan();

  const kosong = await saldoBelumTeridentifikasi(testPrisma, { cashAccountId: rekening.id });
  assert.equal(kosong.total, 0);
  assert.equal(kosong.peringatan, null);

  await testPrisma.$transaction((tx) => postRekonsiliasiSementara(tx, {
    cashAccountId: rekening.id, cashAccountLedgerId: rekening.accountId, cashAccountName: rekening.name,
    amount: 1_028_719, tanggalBuku: "2026-09-22", keterangan: "Tes peringatan.", userId: user.id,
  }));

  const isi = await saldoBelumTeridentifikasi(testPrisma, { cashAccountId: rekening.id });
  assert.equal(isi.total, 1028719);
  assert.match(isi.peringatan, /masih menunggu identifikasi/);
  assert.equal(isi.items.length, 1);
  assert.equal(isi.items[0].rekening, rekening.name);
});

test("evaluasiSelesai(): periode TIDAK BOLEH 'Selesai' selama danaBelumTeridentifikasi masih ada, walau selisih bank sudah nol", () => {
  const hasilDenganSuspense = evaluasiSelesai({ status: "DRAFT", jumlahBaris: 1, belumCocok: 0, selisih: 0, danaBelumTeridentifikasi: 1_028_719 });
  assert.equal(hasilDenganSuspense.bisa, false);
  assert.ok(hasilDenganSuspense.alasan.some((a) => /menunggu identifikasi/.test(a)));

  const hasilTanpaSuspense = evaluasiSelesai({ status: "DRAFT", jumlahBaris: 1, belumCocok: 0, selisih: 0, danaBelumTeridentifikasi: 0 });
  assert.equal(hasilTanpaSuspense.bisa, true);
});
