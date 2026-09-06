import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { api } from "@/api.js";
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
//
// Wave 13 (redesign Inbox) — dipakai dari DUA tempat sekarang, masing-
// masing dengan bentuk data berbeda:
//   1. CustomerPanel (Overview/Order tab) — `customer` SUDAH di-load penuh
//      di sana (termasuk .orders), dioper langsung, TANPA fetch baru di
//      sini. `order` diisi → mode edit (initialOrderId).
//   2. Composer "+" → "Buat Order" (ChatWindow) — cuma punya `customerId`,
//      TIDAK ada customer yang sudah di-load (Composer tidak butuh data
//      customer sama sekali di luar ini). `order` KOSONG → mode buat baru
//      (initialShowForm). Drawer fetch sendiri lewat `customerId`, pola
//      YANG SAMA dengan CustomerPanel/index.jsx sendiri (satu komponen,
//      satu sumber fetch — bukan cache kedua yang bisa basi).
// `open` eksplisit (bukan cuma "order ada isinya") karena mode "buat baru"
// TIDAK PERNAH punya `order` sama sekali, jadi presence order saja tidak
// cukup jadi sinyal buka/tutup.
export default function OrderEditDrawer({ open, order, customer, customerId, onClose, onUpdate }) {
  const [fetchedCustomer, setFetchedCustomer] = useState(null);

  useEffect(() => {
    if (!open || customer) { setFetchedCustomer(null); return; } // customer sudah dioper siap pakai — tidak perlu fetch
    if (!customerId) return;
    let alive = true;
    api.getCustomer(customerId).then((c) => { if (alive) setFetchedCustomer(c); }).catch(() => {});
    return () => { alive = false; };
  }, [open, customer, customerId]);

  const resolvedCustomer = customer || fetchedCustomer;
  const isOpen = !!open && !!resolvedCustomer;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Snapshot supaya konten tidak hilang mendadak saat animasi KELUAR
  // (props sudah berubah tapi drawer masih di layar, sedang slide out) —
  // pola sama dengan OrderTimelineDrawer.jsx#frozen.
  const [frozen, setFrozen] = useState({ order, customer: resolvedCustomer });
  if (isOpen && (order !== frozen.order || resolvedCustomer !== frozen.customer)) {
    setFrozen({ order, customer: resolvedCustomer });
  }
  const f = isOpen ? { order, customer: resolvedCustomer } : frozen;

  // D-131 (6 September 2026, laporan owner: "masih ada warna hitamnya di
  // background" — setelah backdrop-blur ditambah D-130, screenshot masih
  // menunjukkan PANEL DRAWER ITU SENDIRI (bukan overlay-nya) yang solid
  // hitam & lebar penuh (min(100%,720px)), padahal isinya cuma kartu wizard
  // kecil di step 0-2 — sisa ruang di bawah/sampingnya jadi kotak hitam
  // kosong raksasa, workspace blur di baliknya nyaris tidak kebagian tempat
  // untuk terlihat. Root cause: drawer edge-docked full-height itu memang
  // masuk akal untuk mode EDIT (form order lengkap, banyak field/riwayat),
  // tapi TIDAK untuk mode BUAT BARU yang justru pas jadi modal kecil di
  // tengah — sesuai skema yang diminta owner sejak awal ("card 3 pilihan
  // itu" muncul mengambang, bukan panel penuh layar).
  const isCreateMode = !f.order;

  const header = (
    <header className={`flex items-center gap-3 border-b border-line px-4 py-3.5 ${f.order ? "justify-between" : "justify-end"}`}>
      {/* Judul mode-BUAT dihapus total (D-130) — nama customer & konteksnya
          sudah kebaca dari layar Inbox/CustomerPanel di baliknya. Mode EDIT
          ("Order — Nama") TETAP dipertahankan — drawer itu tidak selalu
          dibuka dari konteks yang sudah menunjukkan nama customer. */}
      {f.order && (
        <p className="text-sm font-bold text-ink">
          Order — {f.customer?.name || "Pelanggan"}
        </p>
      )}
      <button
        type="button" onClick={onClose} aria-label="Tutup"
        className="shrink-0 rounded-md p-1.5 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
      >
        <X size={16} />
      </button>
    </header>
  );

  const body = (
    <div className="flex-1 overflow-y-auto p-4">
      <OrderSection
        customer={f.customer}
        onUpdate={onUpdate}
        initialOrderId={f.order?.id}
        initialShowForm={!f.order}
      />
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {isOpen && f.customer && (
        <>
          {/* D-130 — DULU cuma `bg-black/30` (tint gelap flat, tanpa blur),
              workspace di belakang tetap tajam/terbaca. `backdrop-blur-sm`
              ditambahkan supaya workspace di belakang benar-benar buram. */}
          <motion.div
            key="order-edit-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[510] bg-black/30 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          {isCreateMode ? (
            // D-131 — modal MENGAMBANG di tengah, bukan drawer penuh layar.
            // Wrapper luar `pointer-events-none` (klik area kosong di
            // sekitarnya tembus ke overlay gelap di belakangnya, yang sudah
            // menutup dgn onClose) — cuma kotak modal sendiri yang
            // `pointer-events-auto`.
            <div className="fixed inset-0 z-[511] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                key="order-edit-modal"
                role="dialog" aria-modal="true" aria-label="Buat order baru"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{ width: "min(92vw, 520px)", maxHeight: "88vh" }}
                className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl bg-base shadow-popover"
              >
                {header}
                {body}
              </motion.div>
            </div>
          ) : (
            <motion.aside
              key="order-edit-drawer"
              role="dialog" aria-modal="true" aria-label="Edit order"
              initial={{ right: "-100%" }} animate={{ right: 0 }} exit={{ right: "-100%" }}
              transition={{ type: "tween", duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: "fixed", top: 0, width: "min(100%, 720px)" }}
              className="z-[511] flex h-full flex-col bg-base shadow-popover"
            >
              {header}
              {body}
            </motion.aside>
          )}
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
