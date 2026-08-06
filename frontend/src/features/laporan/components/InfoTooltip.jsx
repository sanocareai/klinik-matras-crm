import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

// Info icon kecil + tooltip penjelasan — dipakai di KPI/kartu yang angkanya
// butuh definisi (mis. "Hari Tidak Normal" di TrafficTab: metode deteksinya
// tidak jelas dari angka mentahnya sendiri).
//
// Di-portal ke document.body (BUKAN dirender di tempat) — kartu pembungkusnya
// (KpiCard/ChartCard) memakai animasi masuk `fade-rise` yang meninggalkan
// `transform: translateY(0)` menempel (fill-mode `both`). Transform non-none
// membuat elemen itu jadi containing block untuk position:fixed SEKALIGUS
// stacking context baru — tooltip yang dirender di dalamnya akan terkurung
// dan ketutupan card lain, persis bug yang pernah terjadi di heatmap Traffic.
export default function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  function show() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="inline-flex shrink-0 items-center justify-center text-ink3 transition-colors hover:text-ink"
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
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
