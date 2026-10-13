// NILAI BERSIH ORDER (Okt 2026) — Order.value = nilai item (KOTOR). Nota Kredit/Keringanan aktif adalah potongan resmi atas tagihan: nilai penjualan yang ditampilkan/dijumlahkan
// di UI = value − Σ nota aktif. Backend memuat `orderCredits` (daftar order, detail pelanggan, B2B, respons PATCH order); endpoint ringkas (papan order, order terbaru, perpindahan
// kredit) sudah mengirim `value` BERSIH + `nilaiKotor`, sehingga helper ini aman dipakai di semua tempat (tanpa orderCredits → potongan 0).
// JANGAN menjumlah `order.value` mentah untuk makna "nilai penjualan" — dijaga tests/nilaiBersihOrder.test.js. File ini murni (tanpa impor) supaya bisa dites di Node.
export function notaKreditOrder(order) {
  if (typeof order?.notaKredit === "number") return order.notaKredit;
  return (order?.orderCredits || []).reduce((s, c) => s + (Math.round(Number(c.amount)) || 0), 0);
}

export function nilaiBersihOrder(order) {
  return Math.max(0, (Number(order?.value) || 0) - notaKreditOrder(order));
}
