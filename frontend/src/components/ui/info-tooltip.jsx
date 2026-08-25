import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Info icon kecil + tooltip penjelasan — dipakai di KPI/kartu/kolom tabel
// yang angkanya butuh definisi (mis. "Hari Tidak Normal" di TrafficTab:
// metode deteksinya tidak jelas dari angka mentahnya sendiri). Menggantikan
// native `title=` attribute yang lama dipakai untuk hal serupa — `title=`
// TIDAK PERNAH muncul di HP/tablet (tidak ada hover), padahal mayoritas tim
// sales mengakses CRM ini dari HP (gaya Shopee Seller Center, permintaan
// owner 26 Agustus 2026: ikon "?" yang tampil jelas, bukan disembunyikan di
// atribut yang cuma kebaca kalau tahu harus hover).
//
// Di-portal ke document.body (BUKAN dirender di tempat) — kartu pembungkusnya
// (KpiCard/ChartCard) memakai animasi masuk `fade-rise` yang meninggalkan
// `transform: translateY(0)` menempel (fill-mode `both`). Transform non-none
// membuat elemen itu jadi containing block untuk position:fixed SEKALIGUS
// stacking context baru — tooltip yang dirender di dalamnya akan terkurung
// dan ketutupan card lain, persis bug yang pernah terjadi di heatmap Traffic.
//
// `onClick` toggle TERPISAH dari hover/focus — iOS Safari punya quirk lama:
// <button> TIDAK menerima fokus saat disentuh (beda dari desktop, di mana
// klik = fokus). Tanpa ini, tap di HP tidak pernah membuka tooltip sama
// sekali walau kelihatan seperti tombol yang bisa ditekan.
export default function InfoTooltip({ text, className }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  function show() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
    setOpen(true);
  }

  function toggle(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    show();
  }

  // Tutup saat tap di luar — supaya versi "dibuka lewat tap" tidak nyangkut
  // terbuka selamanya sampai ikon lain disentuh.
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = () => setOpen(false);
    document.addEventListener("click", closeOnOutside);
    return () => document.removeEventListener("click", closeOnOutside);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cn("inline-flex shrink-0 items-center justify-center text-ink3 transition-colors hover:text-ink", className)}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={toggle}
        aria-label="Penjelasan metrik ini"
      >
        <Info size={13} strokeWidth={2} />
      </button>

      {open && pos && createPortal(
        <div
          className="pointer-events-none fixed z-[1200] w-64 -translate-x-1/2 -translate-y-full rounded-btn bg-surface px-3 py-2.5 text-[11.5px] leading-relaxed text-ink2 shadow-popover"
          style={{ left: pos.x, top: pos.y - 8 }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
