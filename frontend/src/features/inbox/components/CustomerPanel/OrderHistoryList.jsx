import React from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import {
  formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUS_BUCKET_LABELS, orderStatusBucket, orderStatusVariant,
} from "@/utils/format.js";

function statusLabel(status) {
  return ORDER_STATUS_BUCKET_LABELS[orderStatusBucket(status)] || ORDER_STATUS_LABELS[status] || status;
}

// Wave 9 (redesign Inbox, plan starry-humming-knuth) — isi tab "Order" di
// Customer Panel: daftar RINGKAS semua order pelanggan (nomor, nilai,
// status saja), BUKAN form edit penuh — itu tetap satu-satunya di
// OrderEditDrawer.jsx (OrderSection.jsx tidak diduplikasi di sini). Klik
// baris mana pun membuka order itu di drawer yang sama dengan Overview's
// ActiveOrderCard.
//
// Tombol "Buat Order" SELALU tampil di atas (bukan cuma saat kosong) — dulu
// (sebelum wave ini) "+Order" ada permanen di dalam OrderSection.jsx yang
// inline di panel, jadi selalu kelihatan tanpa perlu dipikir. Setelah
// dipindah ke drawer terpisah, tombol ini WAJIB ada di sini juga supaya
// menambah order KEDUA/KETIGA untuk pelanggan lama tetap semudah dulu.
export default function OrderHistoryList({ customer, onOpenOrder, onCreateOrder }) {
  const orders = customer?.orders || [];
  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onCreateOrder}>
        <Plus size={14} /> Buat Order
      </Button>

      {orders.length === 0 && (
        <p className="text-muted" style={{ fontSize: 12.5, padding: "8px 0" }}>Belum ada order.</p>
      )}

      {orders.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onOpenOrder(o)}
          className="flex items-center justify-between gap-2 rounded-btn bg-inset px-3 py-2 text-left transition hover:brightness-95"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[11px] font-bold text-ink3">{o.orderNumber || "—"}</span>
            {o.hasComplaint && <AlertTriangle size={12} className="shrink-0 text-red" title="Ada komplain" />}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-[12.5px] font-semibold text-ink">{formatRupiah(o.value)}</span>
            <Badge variant={orderStatusVariant(o.status)}>{statusLabel(o.status)}</Badge>
          </span>
        </button>
      ))}
    </div>
  );
}
