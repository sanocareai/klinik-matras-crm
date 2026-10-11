// "Sales" pada daftar Order & Excel = pihak yang DIKREDITKAN laporan Sales (bukan label pemilik lead pelanggan) — keputusan Owner 11 Okt 2026.
// Server menghitungnya (routes/orders.js → `salesKredit`) dengan aturan yang sama dengan laporan: pemilik order tersimpan menang, selain itu pemegang
// percakapan sekarang; Penjualan Karyawan = tanpa kredit Sales. Dulu kolom ini membaca `assignedSales` (label lead) yang bisa berbeda dari laporan.

/** Nama untuk ditampilkan; "" bila tidak ada kredit Sales. Klien yang menerima payload lama (tanpa salesKredit) jatuh ke label lead. */
export function namaSalesKredit(o) {
  if (!o) return "";
  if (o.salesKredit !== undefined) return o.salesKredit?.name || "";
  return o.assignedSales?.name || "";
}

/** Teks tooltip: dari mana kredit ini berasal + peringatan bila label lead berbeda. */
export function keteranganSalesKredit(o) {
  if (!o || o.salesKredit === undefined) return "";
  const k = o.salesKredit;
  if (!k) return o.penjualanKaryawanId || o.staffSellerId ? "Penjualan Karyawan — di luar angka Tim Sales" : "Belum ada kredit Sales (tanpa pemilik & tanpa pemegang chat)";
  const dari = k.sumber === "PEMILIK_ORDER" ? "pemilik order tercatat" : "mengikuti pemegang chat sekarang";
  const lead = o.assignedSales?.name;
  return `Dikreditkan ke laporan: ${k.name || "-"} (${dari})${lead && lead !== k.name ? ` · label pemilik lead: ${lead}` : ""}`;
}
