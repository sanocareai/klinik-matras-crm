import React, { useEffect, useState } from "react";
import { X, Clock, MessageSquare, Timer } from "lucide-react";
import { api } from "../../api.js";
import {
  formatRupiah, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
} from "../../utils/format.js";
import { formatTanggal } from "../../utils/formatDate.js";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { cn } from "@/lib/utils.js";

// Riwayat status satu order. Sumbernya tabel order_status_transitions yang
// APPEND-ONLY dan TIDAK bisa di-backfill — jadi untuk order yang dibuat sebelum
// tabel itu ada, riwayatnya memang kosong. Empty state di bawah MENJELASKAN
// itu, bukan sekadar bilang "tidak ada data" (yang terbaca seperti fitur rusak).
const TONE = {
  PENDING: "bg-orange", PICKUP: "bg-accent", PROCESSING: "bg-accent",
  READY: "bg-accent", DELIVERED: "bg-green", CANCELLED: "bg-red",
};

export default function OrderTimelineDrawer({ order, onClose, onOpenChat }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!order) { setData(null); return; }
    let batal = false;
    setLoading(true);
    api.getOrderTimeline(order.id)
      .then((r) => { if (!batal) setData(r); })
      .catch(() => { if (!batal) setData(null); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [order]);

  // Esc menutup drawer — pola yang sama dengan drawer lain di app.
  useEffect(() => {
    if (!order) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, onClose]);

  if (!order) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog" aria-modal="true" aria-label="Riwayat status order"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-base shadow-popover"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">
              {order.customerName || order.customerPhone || "Tanpa nama"}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink3">
              {order.orderNumber || "tanpa ID order"}
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Tutup"
            className="shrink-0 rounded-md p-1.5 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Ringkasan order */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { l: "Status", v: ORDER_STATUS_LABELS[order.status] || order.status },
              { l: "Pembayaran", v: PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus },
              { l: "Nilai", v: formatRupiah(order.value || 0) },
              { l: "Lama di status", v: `${order.daysInStatus} hari${order.daysInStatusPerkiraan ? "*" : ""}` },
            ].map((k) => (
              <div key={k.l} className="rounded-xl bg-surface p-2.5 shadow-card">
                <p className="text-[10px] font-medium uppercase tracking-wide text-ink3">{k.l}</p>
                <p className="mt-0.5 text-[13px] font-bold text-ink">{k.v}</p>
              </div>
            ))}
          </div>

          {order.conversationId && (
            <button
              type="button"
              onClick={() => { onOpenChat(order); onClose(); }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accentbg px-3 py-2.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
            >
              <MessageSquare size={14} /> Buka chat customer
            </button>
          )}

          <h3 className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink3">
            <Clock size={12} /> Riwayat Status
          </h3>

          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : data?.riwayatKosong ? (
            <div className="flex flex-col items-center gap-1.5 rounded-xl bg-surface px-4 py-8 text-center shadow-card">
              <Timer className="text-ink3" size={24} />
              <p className="text-[13px] font-semibold text-ink2">Belum ada riwayat</p>
              <p className="text-[11px] leading-relaxed text-ink3">
                Sistem baru mulai merekam perpindahan status order, dan perpindahan
                sebelum itu tidak bisa dihitung ulang. Riwayat akan terisi begitu
                status order ini diubah berikutnya.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col">
              {/* Titik awal: order dibuat. Selalu diketahui dari createdAt, jadi
                  aman ditampilkan walau riwayat transisi masih kosong. */}
              <li className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-ink3" />
                  <span className="w-px flex-1 bg-line" />
                </div>
                <div className="pb-4">
                  <p className="text-[13px] font-semibold text-ink">Order dibuat</p>
                  <p className="text-[11px] text-ink3">{formatTanggal(data?.dibuatPada || order.createdAt)}</p>
                </div>
              </li>

              {(data?.timeline || []).map((t, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", TONE[t.toStatus] || "bg-ink3")} />
                    {i < (data.timeline.length - 1) && <span className="w-px flex-1 bg-line" />}
                  </div>
                  <div className={cn(i < data.timeline.length - 1 && "pb-4")}>
                    <p className="text-[13px] font-semibold text-ink">
                      {ORDER_STATUS_LABELS[t.fromStatus] || t.fromStatus}
                      {" → "}
                      {ORDER_STATUS_LABELS[t.toStatus] || t.toStatus}
                    </p>
                    <p className="text-[11px] text-ink3">
                      {formatTanggal(t.createdAt)}
                      {t.changedBy && ` · oleh ${t.changedBy}`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink2">
                      {t.berjalan ? "Berjalan " : "Bertahan "}
                      <strong>{t.hariDiStatus} hari</strong> di {ORDER_STATUS_LABELS[t.toStatus] || t.toStatus}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {order.hasComplaint && (
            <div className="mt-5 rounded-xl bg-redbg px-3.5 py-3">
              <p className="text-xs font-bold text-red">Ada komplain</p>
              {order.complaintDetail && (
                <p className="mt-1 text-[11px] leading-relaxed text-ink">{order.complaintDetail}</p>
              )}
              {order.complaintDate && (
                <p className="mt-1 text-[11px] text-ink3">{formatTanggal(order.complaintDate)}</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
