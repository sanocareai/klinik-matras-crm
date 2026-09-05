import React from "react";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import {
  formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUS_BUCKET_LABELS, orderStatusBucket, orderStatusVariant,
  PAYMENT_STATUS_LABELS, paymentStatusVariant, PRODUCT_LINE_LABELS, PRODUCT_TYPE_LABELS, parseOrderNotes,
} from "@/utils/format.js";

// Status yang TIDAK LAGI butuh tindakan operasional. `customer.orders`
// (dari GET /customers/:id) sudah terurut updatedAt desc — order paling
// relevan untuk ditampilkan adalah yang PERTAMA yang BUKAN salah satu
// status ini (order yang sedang berjalan). Kalau semua order sudah
// "selesai", tampilkan yang paling baru saja (tetap konteks berguna).
const TERMINAL_STATUSES = new Set(["DELIVERED", "CANCELLED", "SEWA_DIAMBIL"]);

function statusLabel(status) {
  return ORDER_STATUS_BUCKET_LABELS[orderStatusBucket(status)] || ORDER_STATUS_LABELS[status] || status;
}

function productSummary(order) {
  const line = PRODUCT_LINE_LABELS[order.productLine] || "Kasur";
  const type = order.productType ? (PRODUCT_TYPE_LABELS[order.productType] || order.productType) : "";
  const { ukuranKasur } = parseOrderNotes(order.notes);
  return [type ? `${line} ${type}` : line, ukuranKasur].filter(Boolean).join(" · ");
}

function formatTanggalPendek(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

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
export default function ActiveOrderCard({ customer, onOpenOrder, onCreateOrder }) {
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
      <Button type="button" variant="secondary" size="sm" className="mt-3 w-full" onClick={() => onOpenOrder?.(order)}>
        Buka Order
      </Button>
    </Card>
  );
}
