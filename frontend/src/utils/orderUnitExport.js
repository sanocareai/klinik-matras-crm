// EXPORT ORDER (Excel) — representasi UNIT. Satu order bisa memuat banyak unit produksi (mis. 3 kasur sejenis dari satu penjualan). Sheet "Order" tetap 1 baris per order,
// tetapi tanpa kolom jumlah unit order itu tampak "hanya 1 kasur" di Excel. Modul ini (murni, tanpa React) menyediakan:
//   • jumlahUnitOrder(order)    → angka untuk kolom "Jumlah Unit" (unit aktif; order lama tanpa unit memakai quantity, minimal 1)
//   • produkRingkasOrder(order) → "3× Kasur Sorong 3in1 custom; 1× Divan Laci" (kosong untuk order tanpa unit PKR)
//   • barisRincianUnit(order)   → baris sheet "Rincian Unit": SATU baris per unit (kode, produk, ukuran, spesifikasi, kirim, status produksi, status delivery)
// Sumber: order.penjualanKaryawan.unitBaris (disusun server, lib/domain/pkrUnitBaris.js) — data yang SAMA dengan sub-baris unit di layar Order.
import { kelompokProduk, produkUtamaTeks, rapikanUkuran, unitBarisOrder } from "../features/orders/pkrUnitLogic.js";

export const KOLOM_RINCIAN_UNIT = [
  "ID Order", "Pelanggan", "Sales Person", "Unit", "Unit ke", "Produk", "Merk", "Ukuran", "Spesifikasi", "Pengiriman", "Status Produksi", "Tahap", "Status Delivery", "Tanggal Delivery", "Tanggal Produksi", "Target",
];

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

/** Satu baris per unit untuk sheet "Rincian Unit". `ctx` = { pelanggan, sales } (sudah dirapikan pemanggil, sama dengan sheet Order). Order tanpa unit → []. */
export function barisRincianUnit(order, ctx = {}) {
  return unitBarisOrder(order).map((b) => ({
    "ID Order": order.orderNumber || "",
    Pelanggan: ctx.pelanggan ?? order.customerName ?? "",
    "Sales Person": ctx.sales ?? "",
    Unit: b.kode || "",
    "Unit ke": b.urutanLabel || (b.urutan && b.dari ? `${b.urutan} dari ${b.dari}` : ""),
    Produk: b.item?.nama || b.merk || "",
    Merk: b.merk || "",
    Ukuran: rapikanUkuran(b.ukuran),
    Spesifikasi: b.spesifikasi || "",
    Pengiriman: b.kirim?.label || "",
    "Status Produksi": b.produksi?.label || "",
    Tahap: b.produksi?.tahap || "",
    "Status Delivery": b.delivery?.label || "",
    "Tanggal Delivery": b.delivery?.tanggal || "",
    "Tanggal Produksi": b.rencana?.tanggalProduksi || "",
    Target: b.rencana?.target || "",
  }));
}

/** Semua order → baris rincian unit (urutan order dipertahankan, unit berurutan). */
export function semuaRincianUnit(orders, ctxDari = () => ({})) {
  return orders.flatMap((o) => barisRincianUnit(o, ctxDari(o)));
}

/** Total unit seluruh order (untuk catatan di sheet Ringkasan). */
export const totalUnitOrders = (orders) => orders.reduce((a, o) => a + jumlahUnitOrder(o), 0);
