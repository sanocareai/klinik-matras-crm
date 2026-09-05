import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import OrderSection from "@/components/customer/OrderSection.jsx";

// Wave 9 (redesign Inbox, plan starry-humming-knuth) — shell TIPIS yang
// membungkus OrderSection.jsx (2234 baris, editor order lengkap, SATU
// sumber kebenaran dipakai bareng CustomerDrawer.jsx) TANPA MENGUBAH ISINYA
// SAMA SEKALI — cuma memindahkannya dari "selalu terlihat inline di panel"
// jadi "drawer yang dibuka lewat tombol Buka Order" (permintaan brief:
// jangan dump seluruh record order permanen di sidebar).
//
// z-[510]/[511] — SENGAJA di atas bottom-sheet mobile Customer Panel
// (z-500, index.css) tapi di BAWAH OrderTimelineDrawer (z-[550]/[551],
// dinaikkan dari default Tailwind z-40/z-50 supaya kasus INI benar — lihat
// catatan di OrderTimelineDrawer.jsx). OrderSection di dalam sini BISA
// membuka OrderTimelineDrawer-nya sendiri (ikon riwayat per-baris order) —
// drawer itu harus muncul DI ATAS drawer ini, bukan tersembunyi di
// baliknya.
//
// Animasi pakai `right` (posisi), BUKAN `transform` seperti OrderTimeline-
// Drawer — `transform` pada elemen manapun (bahkan translateX(0) yang
// sudah "diam") membuatnya jadi containing block baru untuk descendant
// position:fixed (aturan CSS stacking context), yang akan MEMERANGKAP
// OrderTimelineDrawer bersarang di dalam sini alih-alih membiarkannya lolos
// ke viewport. Di-portal ke document.body (pola sama dengan
// ChatBaruDialog.jsx) supaya juga tidak terjebak transform milik leluhur
// manapun (mis. bottom-sheet mobile Customer Panel, yang beranimasi lewat
// transform sendiri).
export default function OrderEditDrawer({ order, customer, onClose, onUpdate }) {
  const isOpen = !!order;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Snapshot supaya konten tidak hilang mendadak saat animasi KELUAR
  // (order/customer prop sudah null tapi drawer masih di layar, sedang
  // slide out) — pola sama dengan OrderTimelineDrawer.jsx#frozen.
  const [frozen, setFrozen] = useState({ order, customer });
  if (order && order !== frozen.order) setFrozen({ order, customer });
  const f = isOpen ? { order, customer } : frozen;

  return createPortal(
    <AnimatePresence>
      {isOpen && f.customer && (
        <>
          <motion.div
            key="order-edit-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[510] bg-black/30"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            key="order-edit-drawer"
            role="dialog" aria-modal="true" aria-label="Edit order"
            initial={{ right: "-100%" }} animate={{ right: 0 }} exit={{ right: "-100%" }}
            transition={{ type: "tween", duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: "fixed", top: 0, width: "min(100%, 720px)" }}
            className="z-[511] flex h-full flex-col bg-base shadow-popover"
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
              <p className="text-sm font-bold text-ink">Order — {f.customer?.name || "Pelanggan"}</p>
              <button
                type="button" onClick={onClose} aria-label="Tutup"
                className="shrink-0 rounded-md p-1.5 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
              >
                <X size={16} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <OrderSection customer={f.customer} onUpdate={onUpdate} initialOrderId={f.order?.id} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
