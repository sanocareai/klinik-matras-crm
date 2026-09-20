// Neraca harus seimbang untuk pembukuan yang MELEWATI pergantian tahun tanpa tutup buku, dan mendukung nilai negatif (kas, kewajiban,
// laba/rugi) tanpa clipping. Regresi bug produksi: jurnal Des 2025 (net beban) membuat Neraca selisih tetap (−Rp45.834.231) karena laba
// tahun lalu tidak dibawa ke ekuitas. Angka di sini kecil dan dihitung tangan.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { neraca, neracaSaldo, saldoKasBank } from "../../src/services/finance/reports.js";
import { pastikanAkunKoreksi } from "../../src/services/finance/kalibrasiSaldo.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const TGL = (s) => new Date(`${s}T00:00:00Z`);

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const koreksi = await testPrisma.$transaction((tx) => pastikanAkunKoreksi(tx));
  const akun = Object.fromEntries((await testPrisma.finAccount.findMany()).map((a) => [a.code, a]));
  const retur = await testPrisma.finAccount.findFirst({ where: { type: "PENDAPATAN", normalBalance: "DEBIT", isPostable: true } });
  const bankCoa = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kasCoa = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: bankCoa.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Uji", kind: "KAS", accountId: kasCoa.id } });
  const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  return { akun, koreksi, retur, bank, kas, admin };
}

/** Jurnal dari daftar [kodeAkun|"BANK"|"KAS", debit, kredit]. */
async function jurnal(c, tanggal, baris) {
  const lines = baris.map(([kode, d = 0, k = 0]) => {
    if (kode === "BANK") return { accountId: c.bank.accountId, cashAccountId: c.bank.id, debit: d, credit: k };
    if (kode === "KAS") return { accountId: c.kas.accountId, cashAccountId: c.kas.id, debit: d, credit: k };
    if (kode === "RETUR") return { accountId: c.retur.id, debit: d, credit: k };
    if (kode === "KOREKSI") return { accountId: c.koreksi.id, debit: d, credit: k };
    return { accountId: c.akun[kode].id, debit: d, credit: k };
  });
  return testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: `uji ${tanggal}`, source: "MANUAL", userId: c.admin.id, lines }));
}

/** Pembukuan dua tahun: rugi 2025, laba 2026, kas & kewajiban NEGATIF, koreksi ekuitas berdebit. Hitung tangan di komentar. */
async function skenario(c) {
  await jurnal(c, "2025-11-01", [["BANK", 5_000_000, 0], ["3-1100", 0, 5_000_000]]); // modal
  await jurnal(c, "2025-12-10", [["6-1900", 300_000, 0], ["BANK", 0, 300_000]]); // beban 2025
  await jurnal(c, "2025-12-12", [["5-1150", 200_000, 0], ["BANK", 0, 200_000]]); // beban pokok 2025
  await jurnal(c, "2025-12-20", [["BANK", 100_000, 0], ["4-1100", 0, 100_000]]); // pendapatan 2025 → laba 2025 = 100−200−300 = −400.000
  await jurnal(c, "2026-03-01", [["BANK", 2_000_000, 0], ["4-1100", 0, 2_000_000]]); // pendapatan 2026
  await jurnal(c, "2026-03-05", [["RETUR", 100_000, 0], ["BANK", 0, 100_000]]); // retur (kontra pendapatan)
  await jurnal(c, "2026-03-09", [["6-1900", 500_000, 0], ["BANK", 0, 500_000]]); // beban 2026 → laba 2026 = 2.000−100−500 = 1.400.000
  await jurnal(c, "2026-04-01", [["2-1600", 800_000, 0], ["BANK", 0, 800_000]]); // bayar melebihi pinjaman tercatat
  await jurnal(c, "2026-04-02", [["BANK", 300_000, 0], ["2-1600", 0, 300_000]]); // → utang pihak ketiga = −500.000 (bersaldo debit)
  await jurnal(c, "2026-05-01", [["6-1900", 250_000, 0], ["KAS", 0, 250_000]]); // kas fisik NEGATIF −250.000 (beban 2026 jadi 750.000)
  await jurnal(c, "2026-06-01", [["KOREKSI", 1_000_000, 0], ["BANK", 0, 1_000_000]]); // koreksi saldo: ekuitas berdebit (negatif), kas turun
}

const baris = (arr, kode) => arr.find((r) => r.code === kode);

test("Neraca lintas tahun seimbang: laba/rugi tahun sebelumnya dibawa ke ekuitas (regresi selisih Neraca produksi)", async () => {
  const c = await siapkan(); await skenario(c);
  const n = await neraca(testPrisma, { to: TGL("2026-09-30") });
  assert.equal(n.ringkasan.seimbang, true, `selisih ${n.ringkasan.selisih}`);
  assert.equal(n.ringkasan.selisih, 0);
  assert.equal(n.labaTahunSebelumnya, -400_000); // rugi 2025
  // Laba 2026 = pendapatan 2.000.000 − retur 100.000 − beban (500.000 + 250.000) = 1.150.000.
  assert.equal(n.labaTahunBerjalan, 1_150_000);
  const baru = n.ekuitas.find((r) => r.accountId === "laba-tahun-sebelumnya");
  assert.ok(baru, "baris ekuitas untuk laba/rugi tahun sebelumnya");
  assert.equal(baru.nilai, -400_000, "rugi tahun lalu tidak di-clip ke 0");
  // Modal 5.000.000 + Koreksi (−1.000.000) + rugi lama (−400.000) + laba berjalan 1.150.000 = 4.750.000.
  assert.equal(n.ringkasan.totalEkuitas, 4_750_000);
  assert.equal(n.ringkasan.totalPasiva, n.ringkasan.totalAset);
});

test("Nilai NEGATIF tidak di-clip: kas fisik negatif, kewajiban bersaldo debit, ekuitas berdebit (3-4100) — tetap seimbang", async () => {
  const c = await siapkan(); await skenario(c);
  const n = await neraca(testPrisma, { to: TGL("2026-09-30") });
  assert.equal(baris(n.aset, "1-1100").nilai, -250_000, "Kas negatif apa adanya");
  assert.equal(baris(n.kewajiban, "2-1600").nilai, -500_000, "kewajiban negatif apa adanya");
  assert.equal(baris(n.ekuitas, "3-4100").nilai, -1_000_000, "Koreksi Saldo Awal berdebit tampil negatif");
  assert.equal(n.ringkasan.totalKewajiban, -500_000);
  const kartu = await saldoKasBank(testPrisma, { to: TGL("2026-09-30") });
  assert.equal(kartu.find((k) => k.id === c.kas.id).saldo, -250_000, "laporan Kas & Bank memuat saldo kas negatif");
  // Bank = 5.000.000 −300.000 −200.000 +100.000 +2.000.000 −100.000 −500.000 −800.000 +300.000 −1.000.000 = 4.500.000.
  assert.equal(kartu.find((k) => k.id === c.bank.id).saldo, 4_500_000);
});

test("Neraca per akhir 2025 juga seimbang (laba tahun berjalan = rugi 2025, tidak ada laba sebelumnya)", async () => {
  const c = await siapkan(); await skenario(c);
  const n = await neraca(testPrisma, { to: TGL("2025-12-31") });
  assert.equal(n.ringkasan.seimbang, true);
  assert.equal(n.labaTahunBerjalan, -400_000);
  assert.equal(n.labaTahunSebelumnya, 0);
  assert.equal(n.ekuitas.some((r) => r.accountId === "laba-tahun-sebelumnya"), false, "baris tidak muncul bila nol");
});

test("Bila tutup buku dijalankan (jurnal penutup ke Laba Ditahan), baris laba sebelumnya jadi 0 — tidak terhitung ganda; total ekuitas tetap", async () => {
  const c = await siapkan(); await skenario(c);
  const sebelum = await neraca(testPrisma, { to: TGL("2026-09-30") });
  // Penutup 2025 menolkan tiap akun laba rugi 2025: Dr pendapatan 100.000, Cr beban pokok 200.000, Cr beban 300.000, sisanya (rugi 400.000) Dr Laba Ditahan.
  await jurnal(c, "2025-12-31", [["4-1100", 100_000, 0], ["5-1150", 0, 200_000], ["6-1900", 0, 300_000], ["3-3100", 400_000, 0]]);
  const sesudah = await neraca(testPrisma, { to: TGL("2026-09-30") });
  assert.equal(sesudah.labaTahunSebelumnya, 0);
  assert.equal(sesudah.ekuitas.some((r) => r.accountId === "laba-tahun-sebelumnya"), false);
  assert.equal(baris(sesudah.ekuitas, "3-3100").nilai, -400_000, "rugi lama kini di Laba Ditahan");
  assert.equal(sesudah.ringkasan.totalEkuitas, sebelum.ringkasan.totalEkuitas);
  assert.equal(sesudah.ringkasan.seimbang, true);
});

test("Neraca Saldo (mentah) seimbang dan konsisten dengan Neraca: Σ mutasi debit = Σ mutasi kredit", async () => {
  const c = await siapkan(); await skenario(c);
  const ns = await neracaSaldo(testPrisma, { from: TGL("2025-01-01"), to: TGL("2026-09-30") });
  assert.equal(ns.total.seimbang, true);
  assert.equal(ns.total.selisih, 0);
});
