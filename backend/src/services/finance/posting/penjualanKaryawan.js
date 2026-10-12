// POSTING PENJUALAN KARYAWAN — karyawan non-Sales menjual ke kerabat, dicatat MANUAL oleh Finance/Admin (tanpa Order/Customer/produksi/delivery).
//
//   Penjualan dicatat        Dr Piutang Karyawan (1-1350)    Cr Pendapatan Penjualan Karyawan (4-1250)
//   Dibayar tunai/transfer   Dr Kas/Bank                      Cr Piutang Karyawan (1-1350)
//   Dipotong dari gaji       Dr Beban Gaji (6-1100)           Cr Piutang Karyawan (1-1350)   — kas TIDAK tersentuh
//   Dibayar SEBELUM cutoff   Dr Laba Ditahan (3-3100)         Cr Piutang Karyawan (1-1350)   — uang itu sudah tercakup di saldo awal kas/bank (aturan cutoff
//                            Owner 29 Sep 2026, services/finance/cutoff.js): menjurnalnya ke rekening lagi akan menghitung kas dua kali.
//
// Piutang ditanggung KARYAWAN penjual (bukan kerabat pembelinya): kerabat bayar ke karyawan, karyawan yang setor ke perusahaan atau dipotong gajinya.
// Potong gaji memakai sisi jurnal yang SAMA dengan pemotongan Kasbon (posting/kasbon.js#postKasbonPelunasan): sistem belum punya modul gaji, gaji dicatat
// Finance sebesar uang BERSIH yang dibayar, jadi bagian yang dipotong dicatat di sini sebagai Dr Beban Gaji sehingga beban gaji = gaji kotor.
// HPP TIDAK dibukukan di sini (keputusan Owner 2 Okt 2026): modul ini hanya mengakui pendapatan dan tagihannya.

import { postJournal, findEntryByKey, reverseJournal } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";
import { tanggalCutoff, sebelumCutoff } from "../cutoff.js";

export const KEY = {
  penjualan: (id, suffix = "") => `PENJUALAN_KARYAWAN:${id}${suffix}`,
  pembayaran: (id, suffix = "") => `PEMBAYARAN_PENJUALAN_KARYAWAN:${id}${suffix}`,
};

/**
 * `versi` > 0 = jurnal PENGGANTI hasil Koreksi nilai (kunci idempotensi ":v<n>"); 0 = jurnal asli. Jurnal lama TIDAK diubah/dihapus — ia dibalik (reverseJournal) dan jurnal baru diposting.
 */
export async function postPenjualanKaryawan(tx, { penjualanId, userId = null, versi = 0 }) {
  const p = await tx.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, include: { seller: { select: { name: true } } } });
  if (!p) throw new Error(`Penjualan karyawan ${penjualanId} tidak ditemukan`);
  const kunci = KEY.penjualan(penjualanId, versi > 0 ? `:v${versi}` : "");
  const sudahAda = await findEntryByKey(tx, kunci);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_KARYAWAN);
  const pendapatan = await resolveAccount(tx, SYSTEM_KEYS.PENDAPATAN_PENJUALAN_KARYAWAN);
  const nominal = toMoney(p.total);

  const { entry, created } = await postJournal(tx, {
    date: p.date,
    description: `${p.nomor} — Penjualan karyawan ${p.seller.name} (pembeli: ${p.buyerName})`,
    source: "PENJUALAN_KARYAWAN",
    sourceId: penjualanId,
    idempotencyKey: kunci,
    userId,
    lines: [
      { accountId: piutang.id, debit: nominal, description: `Tagihan penjualan karyawan — ${p.seller.name}` },
      { accountId: pendapatan.id, credit: nominal, description: `Pendapatan penjualan karyawan — ${p.nomor}` },
    ],
  });
  return { posted: true, entry, created };
}

/** Jurnal penjualan yang MASIH berlaku (POSTED): yang asli, atau pengganti terakhir hasil Koreksi nilai. null bila tidak ada. */
export async function entriPenjualanAktif(tx, penjualanId) {
  const semua = await tx.finJournalEntry.findMany({ where: { idempotencyKey: { startsWith: KEY.penjualan(penjualanId) } }, orderBy: { createdAt: "desc" } });
  return semua.find((e) => e.status === "POSTED") ?? null;
}

/**
 * KOREKSI NILAI penjualan (total berubah): balik jurnal yang berlaku, lalu posting jurnal pengganti sebesar total baru — keduanya bertanggal sama dengan dokumen supaya periode
 * pendapatan tidak bergeser. Periode tertutup menolak (JournalError) dan seluruh transaksi koreksi batal. Dipanggil di DALAM transaksi pemanggil setelah p.total diperbarui.
 */
export async function koreksiJurnalPenjualan(tx, { penjualanId, userId = null, alasan }) {
  const p = await tx.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { id: true, nomor: true, date: true } });
  if (!p) throw new Error(`Penjualan karyawan ${penjualanId} tidak ditemukan`);
  const aktif = await entriPenjualanAktif(tx, penjualanId);
  if (aktif) await reverseJournal(tx, { entryId: aktif.id, date: p.date, reason: `Koreksi nilai ${p.nomor} — ${alasan}`, userId });
  const versi = await tx.finJournalEntry.count({ where: { idempotencyKey: { startsWith: KEY.penjualan(penjualanId) } } });
  const baru = await postPenjualanKaryawan(tx, { penjualanId, userId, versi });
  return { dibalik: aktif ? aktif.entryNumber : null, baru: baru.entry.entryNumber, versi };
}

export async function postPembayaranPenjualanKaryawan(tx, { paymentId, userId = null }) {
  const pay = await tx.finPenjualanKaryawanPayment.findUnique({
    where: { id: paymentId },
    include: { cashAccount: { select: { id: true, name: true, accountId: true } }, penjualan: { include: { seller: { select: { name: true } } } } },
  });
  if (!pay) throw new Error(`Pembayaran penjualan karyawan ${paymentId} tidak ditemukan`);
  const sudahAda = await findEntryByKey(tx, KEY.pembayaran(paymentId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_KARYAWAN);
  const nominal = toMoney(pay.amount);
  const nomor = pay.penjualan.nomor;
  const nama = pay.penjualan.seller.name;
  const lines = [];
  let deskripsi;
  if (pay.method === "POTONG_GAJI") {
    const bebanGaji = await tx.finAccount.findFirst({ where: { code: "6-1100" }, select: { id: true } });
    if (!bebanGaji) throw new Error("Akun 6-1100 Beban Gaji belum terpasang — jalankan Pasang Akun Bawaan.");
    deskripsi = `${nomor} — Potong gaji ${nama}`;
    lines.push({ accountId: bebanGaji.id, debit: nominal, description: `Potong gaji untuk penjualan karyawan — ${nama}` });
  } else if (sebelumCutoff(pay.date.toISOString().slice(0, 10), await tanggalCutoff(tx))) {
    const laba = await resolveAccount(tx, SYSTEM_KEYS.LABA_DITAHAN);
    deskripsi = `${nomor} — Pembayaran ${pay.method === "TUNAI" ? "tunai" : "transfer"} ${nama} (diterima sebelum saldo awal)`;
    lines.push({ accountId: laba.id, debit: nominal, description: "Kas sudah tercermin di saldo awal (penyesuaian 18 Sep 2026)" });
  } else {
    if (!pay.cashAccount) throw new Error("Rekening penerima wajib untuk pembayaran tunai/transfer");
    deskripsi = `${nomor} — Pembayaran ${pay.method === "TUNAI" ? "tunai" : "transfer"} ${nama}`;
    lines.push({ accountId: pay.cashAccount.accountId, debit: nominal, description: `Uang masuk — ${pay.cashAccount.name}`, cashAccountId: pay.cashAccount.id });
  }
  lines.push({ accountId: piutang.id, credit: nominal, description: `Pelunasan tagihan penjualan karyawan — ${nama}` });

  const { entry, created } = await postJournal(tx, {
    date: pay.date,
    description: deskripsi,
    source: "PEMBAYARAN_PENJUALAN_KARYAWAN",
    sourceId: paymentId,
    idempotencyKey: KEY.pembayaran(paymentId),
    userId,
    lines,
  });
  return { posted: true, entry, created };
}
