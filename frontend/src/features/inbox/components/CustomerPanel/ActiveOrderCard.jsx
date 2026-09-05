import React from "react";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import {
  formatRupiah, orderStatusVariant, PAYMENT_STATUS_LABELS, paymentStatusVariant,
} from "@/utils/format.js";
// Helper dipakai bersama tab Order (OrderHistoryList) — lihat orderSummary.js.
// `customer.orders` (dari GET /customers/:id) sudah terurut updatedAt desc,
// jadi order paling relevan = yang PERTAMA yang statusnya belum terminal.
import { TERMINAL_STATUSES, statusLabel, productSummary, formatTanggalPendek } from "./orderSummary.js";

// Wave 9 (redesign Inbox, plan starry-humming-knuth) — ringkasan SATU order
// paling relevan (aktif kalau ada, kalau tidak yang paling baru), BUKAN
// dump seluruh riwayat order ke sidebar (permintaan eksplisit brief: jangan
// tampilkan record order penuh permanen di panel). Klik "Buka Order"
// memanggil onOpenOrder(order) → OrderEditDrawer.jsx yang membungkus
// OrderSection.jsx APA ADANYA (file 2234 baris itu sendiri TIDAK disentuh
// isinya) — di sanalah semua order lain & kemampuan edit penuh tetap ada.
// BUG NYATA (laporan owner, 5 September 2026): sebelum wave ini, tombol
// "+Order" SELALU ada (dirender inline oleh OrderSection.jsx sendiri).
// Setelah dipindah ke ActiveOrderCard yang ringkas, kartu ini `return null`
// diam-diam kalau customer belum punya order SAMA SEKALI — hasilnya tombol
// buat-order-pertama HILANG dari panel (satu-satunya jalan tersisa jadi
// menu "+" Composer, yang tidak semua sales ketahui). Sekarang tampilkan
// prompt "belum ada order" + tombol Buat Order, bukan kosong tanpa jejak.
export default function ActiveOrderCard({ customer, onOpenOrder, onCreateOrder, onSeeAllOrders }) {
  const orders = customer?.orders || [];
  if (orders.length === 0) {
    return (
      <Card variant="default" className="flex flex-col items-center gap-2 p-4 text-center">
        <p className="text-[12.5px] text-ink3">Belum ada order untuk pelanggan ini.</p>
        <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onCreateOrder}>
          <ShoppingCart size={14} /> Buat Order
        </Button>
      </Card>
    );
  }
  const order = orders.find((o) => !TERMINAL_STATUSES.has(o.status)) || orders[0];

  const deliveryDate = order.deliveryConfirmedDate || order.deliveryEstimate;
  // Peringatan operasional (brief): "Siap Kirim tetapi jadwal pengiriman
  // belum ditentukan" — cuma relevan kalau order READY tapi belum ada
  // tanggal kirim sama sekali (estimasi maupun konfirmasi).
  const showDeliveryWarning = order.status === "READY" && !deliveryDate;

  return (
    <Card variant="default" className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold text-ink3">{order.orderNumber || "—"}</span>
        <div className="flex items-center gap-1.5">
          {order.hasComplaint && <AlertTriangle size={13} className="text-red" title="Ada komplain" />}
          <Badge variant={orderStatusVariant(order.status)}>{statusLabel(order.status)}</Badge>
        </div>
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-ink">{productSummary(order)}</p>
      <p className="mt-0.5 text-lg font-bold text-ink">{formatRupiah(order.value)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink3">
        <Badge variant={paymentStatusVariant(order.paymentStatus)}>{PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus}</Badge>
        <span>Estimasi Kirim: {formatTanggalPendek(deliveryDate) || "Belum dijadwalkan"}</span>
      </div>
      {showDeliveryWarning && (
        <p className="mt-2 rounded-btn bg-orangebg px-2.5 py-1.5 text-[11.5px] text-orange">
          Siap Kirim tetapi jadwal pengiriman belum ditentukan.
        </p>
      )}
      {/* D-115 — kartu ini SENGAJA cuma menampilkan SATU order (yang sedang
          berjalan). Kalau pelanggan punya lebih dari satu, beri jalan yang
          jelas ke daftar lengkapnya — sebelum ini tidak ada petunjuk sama
          sekali bahwa order lain bisa dilihat di tab Order (laporan owner:
          "harus buat order lagi baru bisa cek orderan customer"). */}
      {orders.length > 1 && (
        <button
          type="button"
          onClick={onSeeAllOrders}
          className="mt-2 text-[11.5px] font-medium text-accent hover:underline"
        >
          +{orders.length - 1} order lain — lihat semua
        </button>
      )}
      <Button type="button" variant="secondary" size="sm" className="mt-3 w-full" onClick={() => onOpenOrder?.(order)}>
        Buka Order
      </Button>
    </Card>
  );
}
