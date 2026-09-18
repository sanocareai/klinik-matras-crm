// IMPOR SEKALI-JALAN — penyesuaian saldo kas/bank ke angka REAL per 18 Sep
// 2026, menggantikan upaya melacak detail histori yang sudah terbukti
// tidak mungkin lengkap.
//
// KENAPA INI ADA (18 Sep 2026): setelah backfill Expenses.csv + Incomes.csv
// (non-Pendapatan), saldo sistem masih jauh dari saldo bank sungguhan.
// Diselidiki: 924 baris "Pendapatan" (pembayaran pelanggan) di Incomes.csv
// senilai ~Rp2,55 miliar SENGAJA tidak diimpor (itu domain Sales CRM/Order/
// Payment, bukan Finance manual) — TAPI 67% dari nilai itu (Rp1,72 miliar)
// bahkan di Notion sendiri TIDAK PUNYA rekening yang jelas (kolom "Accounts"
// kosong/"Untitled"). Tidak ada cara jujur untuk merinci itu per transaksi.
//
// KEPUTUSAN OWNER (18 Sep 2026): daripada menebak rekening untuk Rp1,7M
// yang tidak jelas, atau membiarkan saldo salah selamanya, saldo tiap
// rekening disamakan LANGSUNG ke angka real (dicek manual oleh owner,
// termasuk screenshot mobile banking untuk Sano Bank Kemal) lewat SATU
// jurnal penyesuaian per rekening, source SALDO_AWAL, dilawankan ke Laba
// Ditahan (3-3100) — akun yang MEMANG untuk "akumulasi hasil historis yang
// tidak bisa dirinci lagi per transaksi" (lihat komentar SYSTEM_KEYS.LABA_
// DITAHAN di accounts.js). Ini bukan menyembunyikan kesalahan: jurnalnya
// eksplisit menyebut dirinya penyesuaian, tanggal & nilainya tercatat jelas,
// dan siapa pun yang audit bisa lihat PERSIS kapan & kenapa ada lompatan.
//
// TIDAK IDEMPOTEN LEWAT PENCARIAN NOMINAL (beda dari script import lain) —
// nominal penyesuaian ini SENGAJA di-hardcode di bawah (bukan dihitung
// ulang dari saldo sistem saat skrip dijalankan), supaya dijalankan dua
// kali tidak diam-diam menghitung ulang & menyuntik angka BEDA. Aman
// dijalankan ulang: dicek dulu lewat idempotencyKey.
//
//   node backend/scripts/adjustSaldoRealtime2026.js          # pratinjau
//   node backend/scripts/adjustSaldoRealtime2026.js --apply  # eksekusi

import { prisma } from "../src/db.js";
import { postJournal, findEntryByKey, todayBookDateWIB } from "../src/services/finance/journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { toMoney } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const IMPORT_TAG = "[PENYESUAIAN-SALDO-REALTIME-18SEP2026]";

// Nominal penyesuaian PER REKENING — dihitung SEKALI (18 Sep 2026, sore)
// dari selisih saldo sistem saat itu vs saldo bank sungguhan yang
// dikonfirmasi owner (termasuk screenshot mobile banking). Angka INI, bukan
// dihitung ulang saat skrip dijalankan.
const PENYESUAIAN = [
  { rekening: "PT Sano", nominal: "687756624.00", saldoSekarang: "-657581009.00", saldoTarget: "30175615.00" },
  { rekening: "KEM - Sano Bank", nominal: "1850702413.10", saldoSekarang: "-1847685645.00", saldoTarget: "3016768.10" },
  { rekening: "Uang Kas Sano", nominal: "7595500.00", saldoSekarang: "-7529000.00", saldoTarget: "66500.00" },
];

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (pratinjau saja)"}\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi jurnal ini.");
  console.log(`Diatribusikan sebagai: ${admin.name} (${admin.id})\n`);

  const cashAccountRows = await prisma.finCashAccount.findMany({ where: { active: true }, select: { id: true, name: true, accountId: true } });
  const cashByName = new Map(cashAccountRows.map((c) => [c.name.trim().toUpperCase(), c]));

  const tanggal = todayBookDateWIB();

  for (const [i, p] of PENYESUAIAN.entries()) {
    const cash = cashByName.get(p.rekening.toUpperCase());
    if (!cash) {
      console.error(`  ✗ Rekening "${p.rekening}" tidak ditemukan. Ada: ${[...cashByName.keys()].join(", ")}`);
      continue;
    }

    const idemKey = `ADJUST_SALDO_REALTIME_18SEP2026:${i}`;
    const sudah = await findEntryByKey(prisma, idemKey);
    if (sudah) {
      console.log(`  [LEWATI, sudah ada] ${p.rekening}`);
      continue;
    }

    console.log(
      `  [PENYESUAIAN] ${p.rekening}: saldo sistem Rp${Number(p.saldoSekarang).toLocaleString("id-ID")} ` +
      `→ target Rp${Number(p.saldoTarget).toLocaleString("id-ID")} (+Rp${Number(p.nominal).toLocaleString("id-ID")})`
    );

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        const labaDitahan = await resolveAccount(tx, SYSTEM_KEYS.LABA_DITAHAN);
        await postJournal(tx, {
          date: tanggal,
          description: `${IMPORT_TAG} ${p.rekening} — penyesuaian saldo ke angka real (pembayaran pelanggan historis yang tidak tertelusuri per transaksi)`,
          source: "SALDO_AWAL",
          idempotencyKey: idemKey,
          userId: admin.id,
          lines: [
            { accountId: cash.accountId, debit: toMoney(p.nominal), description: `Penyesuaian saldo — ${p.rekening}`, cashAccountId: cash.id },
            { accountId: labaDitahan.id, credit: toMoney(p.nominal), description: "Akumulasi pendapatan historis yang tidak tertelusuri per transaksi" },
          ],
        });
      }, { timeout: 20_000 });
    }
  }

  if (!APPLY) console.log("\nIni baru DRY-RUN. Jalankan ulang dengan --apply untuk benar-benar menulis ke database.");
}

main()
  .catch((e) => {
    console.error("SCRIPT ERROR:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
