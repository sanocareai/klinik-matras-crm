// KATEGORI & JENIS PRODUK EFEKTIF PER UNIT — fungsi MURNI (tanpa DB).
//
// Mesin Produksi dulu membaca Order.category / Order.productLine / Order.productType: satu nilai untuk SELURUH order. Itu cukup selama satu order = satu jenis pekerjaan.
// Order Penjualan Karyawan multi-item bisa memuat kasur baru + divan + service (CAMPURAN): tiap unit harus dirutekan menurut ITEM-nya sendiri.
//
// Aturan: kolom di Unit (work_category, product_line, product_type) menang bila terisi; bila kosong (SEMUA unit yang sudah ada) hasilnya IDENTIK dengan perilaku lama — nilai Order.
// Jangan membaca order.category langsung untuk keputusan Produksi; pakai fungsi di sini.

/** Kategori kerja efektif: "BARU" | "LAYANAN" | "SEWA" | (CAMPURAN hanya bila unit tak punya kategori sendiri — tidak terjadi untuk unit item PKR). */
export function kategoriUnit(unit, order = unit?.order) {
  return unit?.workCategory ?? order?.category ?? null;
}

/**
 * Pasangan {productLine, productType} efektif untuk klasifikasi alur (classifyProduct). Pasangan unit dipakai UTUH bila salah satunya terisi — tidak dicampur dengan
 * nilai order (lini divan milik unit + jenis kasur milik order akan jadi "konflik" palsu).
 */
export function produkUnit(unit, order = unit?.order) {
  if (unit && (unit.productLine || unit.productType)) return { productLine: unit.productLine ?? null, productType: unit.productType ?? null };
  return { productLine: order?.productLine ?? null, productType: order?.productType ?? null };
}

/**
 * Status order EFEKTIF untuk menilai kelayakan SATU unit di Rencana Produksi. Order CAMPURAN: status order adalah agregat kasar (mis. masih PENDING karena item service
 * belum diambil) dan TIDAK boleh menahan unit produk baru yang sudah di workshop — kelayakan unit mengikuti status unit-nya sendiri. Order lain: status order apa adanya.
 */
export function statusOrderEfektif(order, unit) {
  if (order?.category === "CAMPURAN" && ["RECEIVED", "IN_PRODUCTION"].includes(unit?.status) && !["CANCELLED", "DELIVERED"].includes(order.status)) return "PROCESSING";
  return order?.status ?? null;
}

/**
 * Klausa Prisma untuk memilih UNIT menurut kategori efektif: kolom unit menang; bila kosong, kategori order (perilaku lama).
 * Dipakai di tempat yang dulu menyaring `unit: { order: { category: { in: [...] } } }`.
 */
export const unitKategoriIn = (kategori) => ({ OR: [{ workCategory: { in: kategori } }, { workCategory: null, order: { category: { in: kategori } } }] });
