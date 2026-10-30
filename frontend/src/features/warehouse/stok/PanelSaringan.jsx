import React, { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Tombol FILTER + panel saringan lanjutan (popover di desktop, lembar dari bawah di HP). Isi (children) = kontrol saringan yang sudah ada (select asli → nyaman di HP dan keyboard).
// Keyboard: tombol membuka/menutup (aria-expanded), fokus pindah ke panel, Esc menutup dan mengembalikan fokus, Tab keluar panel menutupnya. Jumlah saringan aktif tampil di lencana tombol.
export default function PanelSaringan({ jumlah = 0, onAturUlang, children }) {
  const [buka, setBuka] = useState(false); const akar = useRef(null); const tombol = useRef(null); const panel = useRef(null); const id = useId();
  useEffect(() => {
    if (!buka) return undefined;
    panel.current?.querySelector("select,input,button")?.focus();
    const luar = (e) => { if (akar.current && !akar.current.contains(e.target)) setBuka(false); };
    document.addEventListener("pointerdown", luar);
    return () => document.removeEventListener("pointerdown", luar);
  }, [buka]);
  const tutup = (fokusTombol = true) => { setBuka(false); if (fokusTombol) tombol.current?.focus(); };

  return (
    <div ref={akar} className="relative" onKeyDown={(e) => { if (e.key === "Escape" && buka) { e.stopPropagation(); tutup(); } }}
      onBlur={(e) => { if (buka && e.relatedTarget && !akar.current?.contains(e.relatedTarget)) setBuka(false); }}>
      <button ref={tombol} type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} aria-controls={id} aria-haspopup="dialog" data-testid="tombol-filter"
        className={cn("inline-flex h-11 items-center gap-2 rounded-2xl bg-surface px-4 text-[14px] font-medium text-ink shadow-card outline-none transition-colors hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-accent/50", buka && "ring-2 ring-accent/40")}>
        <SlidersHorizontal size={16} aria-hidden /> Filter
        {jumlah > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white" data-testid="jumlah-filter" aria-label={`${jumlah} saringan aktif`}>{jumlah}</span>}
      </button>
      {buka && <div aria-hidden className="fixed inset-0 z-[205] bg-black/30 sm:hidden" />}
      {buka && (
        <div ref={panel} id={id} role="dialog" aria-label="Saringan lanjutan" data-testid="panel-saringan"
          className="z-[206] space-y-3 overflow-y-auto bg-surface/95 p-4 shadow-popover backdrop-blur-xl max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[85vh] max-sm:rounded-t-3xl max-sm:pb-6 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(70vh,560px)] sm:w-[380px] sm:rounded-2xl">
          <div className="flex items-center gap-2">
            <h3 className="m-0 flex-1 text-[15px] font-bold text-ink">Saringan</h3>
            {jumlah > 0 && <button type="button" onClick={onAturUlang} data-testid="atur-ulang-saringan" className="inline-flex min-h-11 items-center rounded-xl px-2.5 text-[13px] font-semibold text-accent hover:bg-accentbg sm:min-h-9">Atur ulang</button>}
            <button type="button" onClick={() => tutup()} aria-label="Tutup saringan" className="flex h-11 w-11 items-center justify-center rounded-xl stok-t2 hover:bg-hovertint hover:text-ink sm:h-9 sm:w-9"><X size={16} aria-hidden /></button>
          </div>
          {children}
          <button type="button" onClick={() => tutup()} data-testid="selesai-saringan" className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent text-[14px] font-semibold text-white hover:bg-accenthov">Selesai</button>
        </div>
      )}
    </div>
  );
}

/** Satu baris pilihan di panel: label di atas, select asli di bawah (tinggi 44px). */
export function PilihanSaringan({ label, children }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-medium stok-t2">{label}</span>{children}</label>;
}
export const kelasSelect = "h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";
