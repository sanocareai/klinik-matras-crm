// POSTING KASBON — uang muka gaji karyawan (Piutang Karyawan, 1-1350).
//
// Kasbon BUKAN beban dan BUKAN reimbursement. Perusahaan mengeluarkan uang
// duluan ke karyawan (jadi PIUTANG, sisi Aset), dan piutang itu berkurang
// belakangan saat gajinya dibayar dan kasbon dipotong dari situ. Dua kejadian
// terpisah, dua jurnal terpisah — persis pola LANGSUNG/REIMBURSEMENT di
// posting/expense.js, tapi arah piutangnya kebalik (di sini KITA yang
// piutang, bukan karyawan).
//
//   Kasbon diberikan   Dr Piutang Karyawan (1-1350)   Cr Kas/Bank
//   Kasbon dipotong     Dr Utang Gaji / Beban Gaji     Cr Piutang Karyawan
//   dari gaji           (dikerjakan bersamaan payroll — lihat postKasbonRecovery)
//
// FinKasbon sendiri BELUM punya model Prisma khusus per 17 Sep 2026 — modul
// ini dipakai dulu oleh skrip impor data historis Notion lewat
// scripts/importNotionSeptember.js, memakai FinOtherTransaction generik kalau
// modelnya belum ada, atau langsung postJournal kalau memang belum ada model
// pencatatannya. Sesuaikan begitu FinKasbon (model + rute + halaman UI)
// benar-benar dibangun sebagai fitur, bukan cuma jalur impor sekali-jalan.

import { postJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";

export const KEY = {
  kasbonDiberikan: (id, suffix = "") => `KASBON:${id}${suffix}`,
  kasbonDipotong: (id, suffix = "") => `KASBON_POTONG:${id}${suffix}`,
};

/**
 * Kasbon diberikan ke karyawan — dana keluar dari kas/bank perusahaan,
 * dicatat sebagai piutang ke karyawan tersebut (BUKAN beban).
 *
 * `cashAccount` di sini adalah row FinCashAccount ({id, name, accountId})
 * yang sudah diresolve oleh pemanggil (mis. dari nama rekening di file impor)
 * — fungsi ini sengaja tidak menerima cashAccountId mentah supaya pemanggil
 * tidak bisa lolos tanpa memvalidasi rekeningnya ada.
 */
export async function postKasbonDiberikan(tx, { kasbonId, date, amount, karyawanNama, cashAccount, userId = null, keySuffix = "" }) {
  const sudahAda = await findEntryByKey(tx, KEY.kasbonDiberikan(kasbonId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const piutangKaryawan = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_KARYAWAN);
  const nominal = toMoney(amount);

  const { entry, created } = await postJournal(tx, {
    date,
    description: `Kasbon — ${karyawanNama || "karyawan"}`,
    source: "KASBON",
    sourceId: kasbonId,
    idempotencyKey: KEY.kasbonDiberikan(kasbonId, keySuffix),
    userId,
    lines: [
      {
        accountId: piutangKaryawan.id,
        debit: nominal,
        description: `Kasbon diberikan — ${karyawanNama || "karyawan"}`,
      },
      {
        accountId: cashAccount.accountId,
        credit: nominal,
        description: `Uang keluar — ${cashAccount.name}`,
        cashAccountId: cashAccount.id,
      },
    ],
  });
  return { posted: true, entry, created };
}

/**
 * Kasbon dipotong saat gajian — piutang karyawan berkurang, TIDAK menyentuh
 * kas/bank lagi (uangnya sudah keluar duluan saat kasbon diberikan). Lawannya
 * Utang Gaji (2-1500): beban gaji tetap diakui PENUH/gross di jurnal
 * pembayaran gaji, potongan kasbonnya mengurangi utang gaji yang harus
 * dibayar tunai, bukan mengurangi bebannya.
 */
export async function postKasbonDipotong(tx, { kasbonId, date, amount, karyawanNama, userId = null, keySuffix = "" }) {
  const sudahAda = await findEntryByKey(tx, KEY.kasbonDipotong(kasbonId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const piutangKaryawan = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_KARYAWAN);
  const utangGaji = await tx.finAccount.findFirst({ where: { code: "2-1500" }, select: { id: true, name: true } });
  if (!utangGaji) throw new Error("Akun 2-1500 Utang Gaji belum terpasang — jalankan Pasang Akun Bawaan.");

  const nominal = toMoney(amount);

  const { entry, created } = await postJournal(tx, {
    date,
    description: `Potongan kasbon — ${karyawanNama || "karyawan"}`,
    source: "KASBON",
    sourceId: kasbonId,
    idempotencyKey: KEY.kasbonDipotong(kasbonId, keySuffix),
    userId,
    lines: [
      { accountId: utangGaji.id, debit: nominal, description: `Potongan kasbon — ${karyawanNama || "karyawan"}` },
      { accountId: piutangKaryawan.id, credit: nominal, description: `Pelunasan kasbon — ${karyawanNama || "karyawan"}` },
    ],
  });
  return { posted: true, entry, created };
}
