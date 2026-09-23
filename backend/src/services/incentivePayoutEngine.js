// Turunan saldo/status pembayaran Insentif Driver (24 September 2026) —
// SATU tempat menghitung "sudah dibayar berapa / sisa berapa / status apa"
// dari isi ledger IncentivePayout, dipakai bersama oleh endpoint payout
// (routes/incentivePayout.js) dan detail Snapshot (routes/incentiveSnapshot.js)
// — supaya keduanya TIDAK PERNAH bisa menampilkan angka yang beda gara-gara
// dua tempat hitung yang terpisah.
//
// SENGAJA fungsi MURNI (terima array payout mentah, tidak query Prisma
// sendiri) — pemanggil yang menentukan payout mana saja yang relevan
// (per line, per snapshot, dst), fungsi ini cuma menjumlahkan yang VALID
// (voidedAt: null) dan menerjemahkan ke status.

export const PAYOUT_STATUS = Object.freeze({
  UNPAID: "UNPAID",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
});

// payouts: array baris IncentivePayout (boleh campur valid+voided, fungsi
// ini yang menyaring) milik SATU snapshot line.
export function saldoLine(totalRupiah, payouts) {
  const valid = payouts.filter((p) => !p.voidedAt);
  const dibayar = valid.reduce((sum, p) => sum + p.amount, 0);
  const sisa = totalRupiah - dibayar;
  const status = dibayar === 0 ? PAYOUT_STATUS.UNPAID : sisa <= 0 ? PAYOUT_STATUS.PAID : PAYOUT_STATUS.PARTIALLY_PAID;
  return { dibayar, sisa, status };
}

// Status snapshot TURUNAN dari SELURUH line-nya (spec: "Status snapshot
// turunan dari seluruh line") — dipakai daftar/queue pembayaran Finance.
// Line dengan totalRupiah=0 DIKECUALIKAN dari agregasi ini (tidak pernah
// jadi alasan snapshot terlihat "belum lunas" — orang itu memang tidak
// dapat insentif periode ini, bukan "belum dibayar").
export function statusSnapshotDariLines(linesDenganSaldo) {
  const relevan = linesDenganSaldo.filter((l) => l.totalRupiah > 0);
  if (relevan.length === 0) return null; // seluruh snapshot Rp0 — lihat bukanTugasPembayaran()
  if (relevan.every((l) => l.status === PAYOUT_STATUS.PAID)) return PAYOUT_STATUS.PAID;
  if (relevan.every((l) => l.status === PAYOUT_STATUS.UNPAID)) return PAYOUT_STATUS.UNPAID;
  return PAYOUT_STATUS.PARTIALLY_PAID;
}

// Spec: "Snapshot Rp0 tidak boleh muncul sebagai pekerjaan pembayaran
// Finance" — dipakai memfilter daftar/antrean (BUKAN memblokir pembayaran
// individual, yang toh mustahil terjadi kalau totalRupiah snapshot line-nya
// sendiri 0 karena validasi amount<=saldo akan otomatis menolak amount>0
// terhadap saldo 0).
export function bukanTugasPembayaran(snapshotTotalRupiah) {
  return snapshotTotalRupiah === 0;
}
