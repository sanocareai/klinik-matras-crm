import React from "react";
import { BadgeDropdown } from "@/components/ui/badge-dropdown.jsx";
import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, paymentStatusVariant } from "@/utils/format.js";
import { badgeVariants } from "@/components/ui/badge.jsx";
import { isAdminUser } from "@/lib/roles.js";
import { opsiStatusBayar } from "@/features/klaim/klaimLunasLogic.js";

// Pengguna login (untuk menyembunyikan opsi "Lunas" bagi non-Admin — Klaim Lunas 1 Okt 2026).
function penggunaLogin() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

// Dropdown UBAH STATUS PEMBAYARAN — diekstrak (7 Sep 2026) sama alasan
// dengan StatusSelect.jsx di file ini: dipakai di lebih dari satu tempat
// (OrderTimelineDrawer) di luar pages/Orders.jsx, yang SENGAJA menjaga
// versi lokalnya sendiri (lihat catatan panjang di StatusSelect.jsx) supaya
// file yang lagi aktif dikerjakan sesi lain tidak ikut tersentuh oleh
// perubahan ini.
export function PaymentStatusSelect({ order, onChange, className, locked }) {
  return (
    <BadgeDropdown
      value={order.paymentStatus || "BELUM_BAYAR"}
      onChange={(v) => onChange(order, v)}
      options={opsiStatusBayar(PAYMENT_STATUSES, order.paymentStatus, isAdminUser(penggunaLogin())).map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] || s }))}
      getChipClass={(v) => badgeVariants({ variant: paymentStatusVariant(v) })}
      disabled={locked}
      title={locked ? "Order sudah LUNAS — cuma admin/sales yang bisa ubah pembayaran" : undefined}
      ariaLabel={`Ubah status pembayaran untuk ${order.customerName || "pelanggan"}`}
      triggerClassName={className}
    />
  );
}
