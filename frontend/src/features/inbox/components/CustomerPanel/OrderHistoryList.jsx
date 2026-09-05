import React from "react";
import { AlertTriangle, Plus, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { formatRupiah, orderStatusVariant, paymentStatusVariant, PAYMENT_STATUS_LABELS } from "@/utils/format.js";
import { statusLabel, productSummary, formatTanggalPendek } from "./orderSummary.js";

// Wave 9 (redesign Inbox, plan starry-humming-knuth) — isi tab "Order" di
// Customer Panel. OrderSection.jsx (editor penuh) TIDAK diduplikasi di
// sini; klik baris mana pun membukanya di OrderEditDrawer.
//
// D-115 (laporan owner: "buat lihat order customer yang lebih dari 1
// skemanya kurang suka, harus buat order lagi baru bisa cek"): daftar ini
// DULU cuma menampilkan nomor + nilai + status — terlalu miskin untuk
// benar-benar "melihat" order, dan tidak ada penanda bahwa barisnya bisa
// diklik, jadi satu-satunya tempat yang terasa menampilkan semua order
// malah tabel di dalam drawer "Buat Order". Sekarang tiap baris membawa
// tanggal + ringkasan produk + status bayar + chevron (penanda "ada
// detail di baliknya"), jadi tab ini berdiri sendiri sebagai tempat
// melihat riwayat order — tanpa perlu menyentuh alur buat-order sama sekali.
export default function OrderHistoryList({ customer, onOpenOrder, onCreateOrder }) {
  const orders = customer?.orders || [];
  return (
    <div className="flex flex-col gap-2">
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
          title="Buka detail order"
          className="flex w-full items-center gap-2 rounded-btn bg-inset px-3 py-2.5 text-left transition hover:brightness-95"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-[11px] font-bold text-ink3">{o.orderNumber || "—"}</span>
              {o.hasComplaint && <AlertTriangle size={12} className="shrink-0 text-red" title="Ada komplain" />}
              <span className="ml-auto shrink-0 text-[12.5px] font-semibold text-ink">{formatRupiah(o.value)}</span>
            </span>
            <span className="truncate text-[12px] text-ink2">{productSummary(o)}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant={orderStatusVariant(o.status)}>{statusLabel(o.status)}</Badge>
              <Badge variant={paymentStatusVariant(o.paymentStatus)}>
                {PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus}
              </Badge>
              {formatTanggalPendek(o.createdAt) && (
                <span className="text-[11px] text-ink3">{formatTanggalPendek(o.createdAt)}</span>
              )}
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-ink3" />
        </button>
      ))}
    </div>
  );
}
