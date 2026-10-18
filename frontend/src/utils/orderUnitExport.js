// EXPORT ORDER (Excel) — representasi UNIT. Satu order bisa memuat banyak unit produksi (mis. 3 kasur sejenis dari satu penjualan). Sheet "Order" tetap 1 baris per order,
// tetapi tanpa kolom jumlah unit order itu tampak "hanya 1 kasur" di Excel. Modul ini (murni, tanpa React) menyediakan:
//   • jumlahUnitOrder(order)    → angka untuk kolom "Jumlah Unit" (unit aktif; order lama tanpa unit memakai quantity, minimal 1)
//   • produkRingkasOrder(order) → "3× Kasur Sorong 3in1 custom; 1× Divan Laci" (kosong untuk order tanpa unit PKR)
//   • semuaRekapUnit(orders, barisOrder) → sheet "Rekap per Unit": SEMUA order, order N unit = N baris (daftar yang disalin admin produksi ke rekap bahan)
// Sumber: order.penjualanKaryawan.unitBaris (disusun server, lib/domain/pkrUnitBaris.js) — data yang SAMA dengan sub-baris unit di layar Order.
import { kelompokProduk, produkUtamaTeks, rapikanUkuran, unitBarisOrder } from "../features/orders/pkrUnitLogic.js";

/** Jumlah unit order: unit aktif dari server; order lama (tanpa unit) memakai quantity order, minimal 1. */
export function jumlahUnitOrder(order) {
  const unit = unitBarisOrder(order);
  if (unit.length > 0) return unit.length;
  const q = Number(order?.quantity);
  return Number.isFinite(q) && q >= 1 ? Math.floor(q) : 1;
}

/** Ringkasan produk per order dari unit ("3× Kasur ...; 1× Divan ..."); "" bila order tidak punya unit PKR. Tidak dipotong ("+N jenis lain") agar Excel memuat semuanya. */
export function produkRingkasOrder(order) {
  const pkr = order?.penjualanKaryawan;
  if (!pkr || unitBarisOrder(order).length === 0) return "";
  const g = kelompokProduk(pkr);
  if (g.length === 0) return produkUtamaTeks(pkr) ?? "";
  return g.map((x) => `${x.qty}× ${x.nama}${x.ukuran ? ` (${x.ukuran})` : ""}`).join("; ");
}

/** Kolom sheet "Rekap per Unit" (urutan = urutan kolom). Sengaja TANPA nominal uang: sheet ini untuk rekap produksi/pemakaian bahan, bukan keuangan. */
export const KOLOM_REKAP_UNIT = [
  "ID Order", "Unit", "Unit ke", "Pelanggan", "Sales Person", "Kategori", "Produk", "Merk/Model", "Ukuran", "Spesifikasi", "Layanan", "Status Order", "Status Produksi", "Jenis Pekerjaan", "Keluhan/Catatan", "Berat Badan", "Kota Pengiriman", "Estimasi Kirim",
];

/**
 * REKAP PER UNIT — daftar yang disalin admin produksi ke rekap pemakaian bahan (Google Sheets): SETIAP order tampil; order dengan N unit tampil N baris (satu per unit, kode unit sendiri),
 * order lain (1 kasur / layanan / belum punya unit) tampil 1 baris dengan kolom Unit kosong. `baris` = baris sheet "Order" untuk order yang sama (sumber kolom tingkat order, supaya
 * isinya TIDAK PERNAH beda dari sheet Order). Sheet "Order" sendiri tetap 1 baris per order (rumus Ringkasan bergantung padanya).
 */
export function barisRekapUnit(order, baris = {}) {
  const dasar = {
    "ID Order": baris["ID Order"] ?? order.orderNumber ?? "", Pelanggan: baris.Pelanggan ?? order.customerName ?? "", "Sales Person": baris["Sales Person"] ?? "", Kategori: baris.Kategori ?? "",
    Layanan: baris.Layanan ?? "", "Status Order": baris.Status ?? "", "Jenis Pekerjaan": baris["Jenis Pekerjaan"] ?? "", "Keluhan/Catatan": baris["Keluhan/Catatan"] ?? "", "Berat Badan": baris["Berat Badan"] ?? "",
    "Kota Pengiriman": baris["Kota Pengiriman"] ?? "", "Estimasi Kirim": baris["Estimasi Kirim"] ?? "",
  };
  const unit = unitBarisOrder(order);
  if (unit.length === 0) {
    return [{ ...dasar, Unit: "", "Unit ke": "", Produk: "", "Merk/Model": baris["Merk/Model"] ?? "", Ukuran: baris["Ukuran/Konfigurasi"] ?? "", Spesifikasi: "", "Status Produksi": "" }];
  }
  return unit.map((b) => ({
    ...dasar,
    Unit: b.kode || "", "Unit ke": b.urutanLabel || (b.urutan && b.dari ? `${b.urutan} dari ${b.dari}` : ""),
    Produk: b.item?.nama || b.merk || "", "Merk/Model": b.merk || "", Ukuran: rapikanUkuran(b.ukuran), Spesifikasi: b.spesifikasi || "", "Status Produksi": b.produksi?.label || "",
  }));
}

/** Semua order → baris rekap. `barisOrder` paralel dengan `orders` (baris sheet Order). Hasil diurut mengikuti order, unit berurutan. Kolom sesuai KOLOM_REKAP_UNIT. */
export function semuaRekapUnit(orders, barisOrder = []) {
  return orders.flatMap((o, i) => barisRekapUnit(o, barisOrder[i] ?? {}).map((r) => Object.fromEntries(KOLOM_REKAP_UNIT.map((c) => [c, r[c] ?? ""]))));
}

/** Total unit seluruh order (untuk catatan di sheet Ringkasan). */
export const totalUnitOrders = (orders) => orders.reduce((a, o) => a + jumlahUnitOrder(o), 0);
