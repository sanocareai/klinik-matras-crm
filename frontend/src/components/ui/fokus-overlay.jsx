import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useTabVisibility } from "@/lib/TabsContext.jsx";
import { POPOVER_SURFACE } from "./surface.jsx";

// FOKUS OVERLAY (UX Gudang Tahap 3) — detail dokumen sebagai jendela fokus yang didukung RUTE (URL berubah, refresh dan Back bekerja), bukan tab workspace baru, drawer, atau modal bertumpuk.
//  • Desktop: jendela besar di tengah (scale/fade halus); header tetap, isi bergulir, bilah aksi tetap terlihat di bawah.
//  • HP (< 640px): layar penuh (naik dari bawah).
//  • SATU LAPISAN: formulir yang biasanya modal (Catat kedatangan, Koreksi, …) tampil SEBAGAI PANEL di dalam jendela yang sama — lihat `LapisanTunggalCtx` yang dipakai ui/modal.jsx. Isi dokumen
//    di belakang panel tidak dibongkar (hanya disembunyikan), jadi isian yang belum disimpan tidak hilang.
//  • Esc menutup panel lebih dulu, baru jendela. Overlay hanya tampil di tab yang sedang aktif (tab latar belakang tidak memunculkan jendela).
export const LapisanTunggalCtx = createContext(null);

export function FokusOverlay({ open, onClose, title, subtitle, header, footer, children, testid = "fokus-overlay", className }) {
  const tabAktif = useTabVisibility();
  const [slot, setSlot] = useState(null); const [jumlahPanel, setJumlahPanel] = useState(0); const tutupPanel = useRef([]);
  const masuk = useCallback((fn) => { tutupPanel.current.push(fn); setJumlahPanel((n) => n + 1); return () => { tutupPanel.current = tutupPanel.current.filter((x) => x !== fn); setJumlahPanel((n) => Math.max(0, n - 1)); }; }, []);
  const ctx = useMemo(() => ({ slot, masuk }), [slot, masuk]);
  if (!open || !tabAktif) return null;
  const container = typeof document !== "undefined" ? document.querySelector(".app-shell") ?? undefined : undefined;
  const adaPanel = jumlahPanel > 0;
  const tutupPaling = () => { const f = tutupPanel.current[tutupPanel.current.length - 1]; if (f) f(); else onClose(); };
  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v) tutupPaling(); }}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          data-testid={testid} aria-describedby={undefined}
          onEscapeKeyDown={(e) => { e.preventDefault(); tutupPaling(); }}
          className={cn(
            "kpi-glass-guard fixed z-[201] flex flex-col overflow-hidden outline-none", POPOVER_SURFACE,
            "left-1/2 top-1/2 h-[min(90vh,880px)] w-[min(1040px,94vw)] -translate-x-1/2 -translate-y-1/2",
            "max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=open]:slide-in-from-bottom-8",
            className,
          )}
        >
          <div className="shrink-0 border-b border-line px-5 pb-3 pt-4 max-sm:px-4" data-testid="fokus-header">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="t-card-title m-0 [overflow-wrap:anywhere]" data-testid="fokus-judul">{title}</Dialog.Title>
                {subtitle && <div className="mt-0.5 text-[12.5px] text-ink2" data-testid="fokus-subjudul">{subtitle}</div>}
              </div>
              <button type="button" onClick={onClose} aria-label="Tutup" data-testid="fokus-tutup"
                className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-chip text-ink3 transition-colors hover:bg-hovertint hover:text-ink max-sm:h-11 max-sm:w-11"><X size={16} /></button>
            </div>
            {header && <div className="mt-3" hidden={adaPanel}>{header}</div>}
          </div>
          <LapisanTunggalCtx.Provider value={ctx}>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-sm:px-4" hidden={adaPanel} data-testid="fokus-isi">{children}</div>
            <div ref={setSlot} className="min-h-0 flex-1 overflow-y-auto" hidden={!adaPanel} data-testid="fokus-panel" />
          </LapisanTunggalCtx.Provider>
          {footer && <div className="max-h-[46%] shrink-0 overflow-y-auto border-t border-line bg-surface/90 px-5 py-3 max-sm:px-4" hidden={adaPanel} data-testid="fokus-aksi">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Dipanggil ui/modal.jsx saat berada di dalam FokusOverlay: tampilkan Modal sebagai panel di jendela yang sama. */
export function PanelSatuLapisan({ lapisan, title, description, footer, children, onOpenChange, showClose = true }) {
  const { slot, masuk } = lapisan;
  const tutup = useCallback(() => onOpenChange?.(false), [onOpenChange]);
  const tutupRef = useRef(tutup); tutupRef.current = tutup;
  React.useEffect(() => masuk(() => tutupRef.current()), [masuk]);
  if (!slot) return null;
  return ReactDOMPortal(slot,
    <div className="flex h-full min-h-0 flex-col" role="group" aria-label={typeof title === "string" ? title : "Panel"} data-testid="panel-satu-lapisan">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3 max-sm:px-4">
        <div className="min-w-0">
          {title && <h2 className="t-card-title m-0">{title}</h2>}
          {description && <p className="t-secondary m-0 mt-1">{description}</p>}
        </div>
        {showClose && <button type="button" onClick={tutup} aria-label="Kembali ke dokumen" data-testid="panel-kembali" className="shrink-0 rounded-chip px-2.5 py-1 text-[12px] font-semibold text-accent hover:bg-hovertint max-sm:min-h-11">← Kembali ke dokumen</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-sm:px-4">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-3 max-sm:px-4">{footer}</div>}
    </div>,
  );
}
import { createPortal } from "react-dom";
const ReactDOMPortal = (el, node) => createPortal(node, el);
