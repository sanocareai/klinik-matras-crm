import React from "react";
import { BadgeDropdown } from "@/components/ui/badge-dropdown.jsx";
import { ORDER_STATUS_LABELS, orderStatusesForCategory, orderStatusVariant } from "@/utils/format.js";
import { badgeVariants } from "@/components/ui/badge.jsx";

// Dropdown UBAH STATUS ORDER — dipakai lintas divisi (D-086, 5 September
// 2026, laporan owner: "sales suka lupa ubah status order, semua divisi
// harus bisa update status order di workspace masing-masing"). Sebelumnya
// komponen setara ini cuma ada LOKAL di pages/Orders.jsx (Sales CRM) —
// diekstrak jadi satu file supaya Delivery (ArmadaOrders.jsx) dan Produksi
// (ProductionOrders.jsx) pakai PERSIS logika & warna yang sama, bukan
// duplikat yang bisa diam-diam beda (aturan proyek: "satu sumber
// kebenaran"). pages/Orders.jsx SENGAJA TIDAK diikutkan migrasi ini —
// biarkan versi lokalnya tetap jalan, supaya file yang lagi aktif dikerjakan
// sesi lain tidak ikut tersentuh oleh perubahan ini.
//
// Integrasi Fase 1 (D-006): Order.status DIHITUNG OTOMATIS dari status unit
// di Bengkel (weakest-link). Memilih status di sini berarti OVERRIDE MANUAL
// (mengunci, tidak lagi ikut hitungan otomatis) sampai dilepas dari drawer
// profil pelanggan > tab Order. Kunci 🔒 menandai order yang sedang
// di-override — dropdown TETAP aktif (bukan disabled) walau terkunci, sesuai
// pola StatusSelect asli di Orders.jsx (locked cuma menampilkan ikon gembok).
export function StatusSelect({ order, onChange, className }) {
  return (
    <BadgeDropdown
      value={order.status}
      onChange={(v) => onChange(order, v)}
      // Opsi override dibatasi per KATEGORI (lihat orderStatusesForCategory
      // di utils/format.js) — order kategori BARU cuma menawarkan
      // Diproses/Siap Kirim/Terkirim/Dibatalkan, TANPA "Pengambilan" (tidak
      // ada barang fisik lama yang diambil dari customer untuk order ini).
      options={orderStatusesForCategory(order.category).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] || s }))}
      getChipClass={(v) => badgeVariants({ variant: orderStatusVariant(v) })}
      locked={!!order.statusLocked}
      lockedTitle="Status di-override manual — ikut hitungan otomatis lagi lewat drawer profil pelanggan"
      title="Status dihitung otomatis dari unit"
      ariaLabel={`Ubah status order ${order.orderNumber || ""}`}
      triggerClassName={className}
    />
  );
}
