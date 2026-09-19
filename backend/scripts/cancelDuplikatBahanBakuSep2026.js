// KOREKSI SEKALI-JALAN — 22 pengeluaran "Pembelian Bahan Baku (Input
// Manual)" bulan September 2026 (FinExpense, kategori BAHAN_BAKU_MANUAL)
// ke-DOUBLE-POST dengan 22 pembelian di tab Pembelian yang baru (FinPurchase)
// untuk transaksi yang SAMA PERSIS (tanggal, keterangan, nominal identik).
//
// KRONOLOGI (ditemukan 19 Sep 2026 saat owner tanya kenapa Laba Bersih
// periode 1-30 Sep 2026 minus Rp290 juta): jalur impor historis
// `importNotionFullHistory2026.js` dijalankan DUA KALI dengan hasil beda —
// run pertama (17 Sep 2026 18:13 WIB) memetakan baris bahan-baku bulan
// berjalan (Sep) ke FinExpense/BAHAN_BAKU_MANUAL (jalur LAMA, sebelum tab
// Pembelian selesai dibangun); run kedua (18 Sep 2026 08:59 WIB), setelah
// tab Pembelian live dan routing kategori diperbaiki ke FinPurchase, meng-
// impor ULANG baris yang SAMA sebagai FinPurchase — dedup-check saat itu
// cuma mengecek dalam tabel tujuannya sendiri (existingExpenseKeys vs
// existingPurchaseKeys terpisah), jadi tidak menangkap pasangan lintas-
// tabel ini. Akibatnya akun 5-1150 (Beban Pokok — Pembelian Bahan Baku)
// kena debit DUA KALI untuk 22 transaksi yang sama, total dobel
// Rp107.893.765 (dari total gabungan Rp215.787.530).
//
// KEPUTUSAN: FinPurchase (tab Pembelian) adalah rumah yang BENAR untuk
// pembelian bahan baku manual sejak migrasi (lihat DEPRECATED_EXPENSE_
// CATEGORY_CODES di accounts.js — BAHAN_BAKU_MANUAL sudah dinonaktifkan
// dari form baru). Jadi yang DIBATALKAN adalah 22 FinExpense (jalur lama),
// BUKAN 22 FinPurchase-nya — lewat REVERSAL jurnal resmi (posisi journal
// asli tidak pernah dihapus/diubah, cuma dibalik + status FinExpense jadi
// DIBATALKAN), persis mekanisme yang sama dipakai endpoint
// POST /expenses/:id/cancel — skrip ini cuma memanggil fungsi yang sama
// (reverseJournal) langsung lewat Prisma karena berjalan di luar HTTP.
//
// Daftar 22 ID di bawah HARDCODE (bukan dicari ulang lewat query saat
// dijalankan) — sudah diverifikasi manual satu-satu (tanggal+keterangan+
// nominal FinExpense = FinPurchase pasangannya) sebelum skrip ini ditulis.
// Aman dijalankan ulang: expense yang sudah DIBATALKAN dilewati.
//
//   node backend/scripts/cancelDuplikatBahanBakuSep2026.js          # pratinjau
//   node backend/scripts/cancelDuplikatBahanBakuSep2026.js --apply  # eksekusi

import { prisma } from "../src/db.js";
import { reverseJournal } from "../src/services/finance/journal.js";
import { KEY as EXPENSE_KEY } from "../src/services/finance/posting/expense.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";

const APPLY = process.argv.includes("--apply");
const ALASAN = "Double-post dengan Pembelian (tab baru) — bahan baku Sep 2026 sempat terimpor 2x lintas FinExpense/FinPurchase, lihat komentar skrip cancelDuplikatBahanBakuSep2026.js";

const EXPENSE_IDS = [
  "17ee451d-c84b-462a-acd9-2993ab4c0e6a",
  "12dc959c-7bf1-402f-b5b2-6af51aaa940a",
  "3f3e86fb-cae1-47a4-8178-f893cc38b6e0",
  "698f99d0-78af-4d46-af9c-1ba460f7c033",
  "ccf6647e-fd2c-4083-9596-63246460f969",
  "92572eb2-4dea-43ed-870c-7f74e9cf7c0c",
  "ca70ee4d-95f2-44fe-8c4d-046dd6e139fa",
  "1eece1b7-a7e8-4996-ab8c-c5108c7161df",
  "69f5f1c8-5260-4277-8f22-03d62c944357",
  "1a82ffc1-92cc-4e79-8c18-c16a114c2581",
  "e42cf571-cc54-4af5-8999-271ec8a8cc6d",
  "5e3bd2c6-af07-4a91-beef-9337fa38536c",
  "81823eca-b80e-469b-ab97-ef7b56209eb0",
  "2328fee8-4e13-4b5a-afe5-8359a5bad313",
  "82931571-a054-4359-8668-c0cfee284afd",
  "2a6cec28-feaf-413d-b484-d8a2a0886424",
  "c5a184c2-75ea-49f9-bb04-d06475daa201",
  "4e81ad14-1f09-474f-b4d1-d2ba3fe69b84",
  "2745e48d-3379-4c37-8a50-d30ffaf09f84",
  "7c656218-0234-4c15-a990-51c6264bb9c2",
  "cabb9898-5035-45b9-9af9-0279d1ffc043",
  "af4f1d77-8ce1-48bc-a97c-37ccddf18b07",
];

// Sama persis logika `balikkanJurnalAktif` di routes/financeTransactions.js
// (fungsi itu tidak di-export — dua transaksi diikat SATU $transaction di
// sana; di sini kita ulangi polanya per-expense, masing-masing $transaction
// sendiri, supaya satu kegagalan tidak membatalkan seluruh batch).
async function balikkanPrefix(tx, keyPrefix, alasan, userId) {
  const entry = await tx.finJournalEntry.findFirst({
    where: { status: "POSTED", idempotencyKey: { startsWith: keyPrefix } },
  });
  if (entry) await reverseJournal(tx, { entryId: entry.id, reason: alasan, userId });
  return entry;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (pratinjau saja)"}\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ber-role ADMIN untuk atribusi pembatalan ini.");
  console.log(`Diatribusikan sebagai: ${admin.name} (${admin.id})\n`);

  let dibatalkan = 0;
  let dilewati = 0;
  let totalNominal = 0n;

  for (const id of EXPENSE_IDS) {
    const e = await prisma.finExpense.findUnique({ where: { id } });
    if (!e) {
      console.log(`  [LEWATI] ${id} — tidak ditemukan`);
      dilewati++;
      continue;
    }
    if (e.status === "DIBATALKAN") {
      console.log(`  [LEWATI] ${e.expenseNumber} — sudah dibatalkan sebelumnya`);
      dilewati++;
      continue;
    }
    console.log(`  ${e.expenseNumber} · ${e.date.toISOString().slice(0, 10)} · ${e.description} · Rp${Number(e.amount).toLocaleString("id-ID")}`);
    totalNominal += BigInt(Math.round(Number(e.amount) * 100));

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      const alasanBatal = `Pengeluaran ${e.expenseNumber} dibatalkan — ${ALASAN}`;
      await balikkanPrefix(tx, EXPENSE_KEY.expensePaid(e.id), alasanBatal, admin.id);
      await balikkanPrefix(tx, EXPENSE_KEY.expense(e.id), alasanBatal, admin.id);
      await tx.finExpense.update({
        where: { id: e.id },
        data: { status: "DIBATALKAN", rejectReason: ALASAN },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_EXPENSE, entityId: e.id,
        eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: admin.id,
        metadata: { expenseNumber: e.expenseNumber, reason: ALASAN },
      });
    });
    dibatalkan++;
  }

  console.log(`\nTotal nominal duplikat teridentifikasi: Rp${(Number(totalNominal) / 100).toLocaleString("id-ID")}`);
  if (APPLY) {
    console.log(`Dibatalkan: ${dibatalkan}, dilewati: ${dilewati}`);
  } else {
    console.log(`(Dry-run — tidak ada yang ditulis. Jalankan ulang dengan --apply untuk eksekusi.)`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
