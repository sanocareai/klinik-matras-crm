// Nomor rekening TERSAMARKAN untuk klien yang bukan Finance (sales mencatat pembayaran): hanya 4 digit terakhir.
// Nomor lengkap TIDAK pernah keluar dari GET /orders/payment-accounts.
export function maskAccountNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null; // terlalu pendek/kosong: jangan bocorkan apa pun
  return `••••${digits.slice(-4)}`;
}
