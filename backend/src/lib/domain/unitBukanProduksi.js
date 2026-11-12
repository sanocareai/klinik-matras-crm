// UNIT YANG BUKAN PEKERJAAN PRODUKSI — satu aturan untuk semua daftar/antrean Produksi.
//
// Keputusan Owner (12 Nov 2026): kasur SEWA adalah produk Sano yang sudah jadi. Order sewa TIDAK masuk Order Produksi, tidak perlu pencatatan bahan, dan dianggap
// selesai dari sisi Produksi. Unitnya tetap ada (dipakai Delivery: kirim → ambil kembali), jadi yang diubah hanya CARA DAFTAR PRODUKSI MEMILIH unit — tidak ada data
// yang diubah, status unit/order tidak disentuh.
//
// Kategori efektif mengikuti lib/domain/unitKategori.js: kolom unit (work_category) menang, bila kosong pakai kategori order.
import { kategoriUnit } from "./unitKategori.js";

export const KATEGORI_BUKAN_PRODUKSI = Object.freeze(["SEWA"]);

/** true bila unit ini bukan pekerjaan Produksi (kasur sewa). Butuh unit.workCategory dan/atau order.category. */
export function unitBukanProduksi(unit, order = unit?.order) {
  return KATEGORI_BUKAN_PRODUKSI.includes(kategoriUnit(unit, order));
}

/**
 * Klausa Prisma: hanya unit yang MERUPAKAN pekerjaan Produksi. Ditulis dalam bentuk positif (notIn), BUKAN `NOT: unitKategoriIn(...)` — di SQL `NOT (NULL OR …)`
 * bernilai NULL untuk work_category kosong dan akan ikut membuang seluruh unit lama (semua unit production work_category-nya kosong).
 */
export const whereUnitProduksi = () => ({
  OR: [
    { workCategory: { notIn: [...KATEGORI_BUKAN_PRODUKSI] } },
    { workCategory: null, order: { category: { notIn: [...KATEGORI_BUKAN_PRODUKSI] } } },
  ],
});

/** Untuk laporan biaya: unit sewa tetap ikut BILA ternyata sudah punya pergerakan stok — biaya yang sudah tercatat tidak boleh hilang diam-diam dari laporan. */
export const whereUnitProduksiAtauBerbiaya = () => ({ OR: [whereUnitProduksi(), { stockMovements: { some: {} } }] });

/** Gabungkan klausa tambahan ke `where` yang sudah ada tanpa menimpa AND/OR milik pemanggil. */
export function denganUnitProduksi(where = {}, klausa = whereUnitProduksi()) {
  return { ...where, AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), klausa] };
}
