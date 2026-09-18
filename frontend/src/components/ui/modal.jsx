import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { POPOVER_SURFACE, OVERLAY } from "./surface.jsx";

// Modal aksesibel di atas Radix Dialog (fokus-trap, Esc, aria otomatis).
// API ringkas & controlled: <Modal open onOpenChange title footer>…</Modal>.
// Dipakai untuk modal sesi berakhir (App.jsx) dan command palette (Wave 1),
// menggantikan overlay inline lama. Lihat sano-components.md §B.4.
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  showClose = true,
  contentProps = {},
}) {
  // Portal TANPA `container` (default Radix) menaruh modal langsung di
  // <body>, DI LUAR `.app-shell.glass-division` — akibatnya SELURUH CSS kaca
  // untuk field (delivery-dark/-light.css, selector `.glass-division input`
  // dkk) tidak pernah cocok di dalam modal manapun, walau modal SHELL-nya
  // sendiri tetap kelihatan kaca (POPOVER_SURFACE pakai utility class
  // langsung, tidak bergantung nesting). Dibuktikan lewat computed style
  // nyata: backdrop-filter "none", bg solid #1C1C1E, bukan rgba tembus
  // pandang. Fix: portal ke `.app-shell` (satu-satunya di tiap halaman,
  // TANPA transform/filter jadi position:fixed anak tetap relatif viewport,
  // `overflow:hidden`-nya juga tidak meng-clip fixed descendant) — kalau
  // tidak ketemu (halaman tanpa shell, mis. Login), Radix jatuh balik ke
  // document.body seperti semula, jadi tidak ada regresi di luar shell.
  const glassContainer = typeof document !== "undefined" ? document.querySelector(".app-shell") : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={glassContainer}>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[201] w-[440px] max-w-[96vw] -translate-x-1/2 -translate-y-1/2",
            // "kpi-glass-guard" — className POPOVER_SURFACE membawa "rounded-card",
            // yang di dalam .glass-division (sejak fix container di atas) kena
            // wildcard kaca generik `[class*="rounded-card"]` (delivery-dark/-light
            // .css). Wildcard itu set `position: relative` (CSS TANPA @layer,
            // otomatis menang lawan utility `fixed` yang ter-layer, terlepas dari
            // specificity) — modal jadi lepas dari `fixed`, sentering-nya (left-1/2
            // + translate) rusak total. Dialog sudah punya glass sendiri lewat
            // selector khusus `[role="dialog"]` (blok §7 kedua file), jadi guard
            // ini aman: cuma keluar dari wildcard generik, glass-nya tidak hilang.
            "kpi-glass-guard",
            // DS v2: tanpa border, elevasi popover + translucent blur (surface.jsx).
            POPOVER_SURFACE, "outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            className
          )}
          {...contentProps}
        >
          {(title || showClose) && (
            <div className="flex items-start justify-between px-6 pb-0 pt-5">
              <div className="min-w-0">
                {title && (
                  <Dialog.Title className="t-card-title">{title}</Dialog.Title>
                )}
                {description && (
                  <Dialog.Description className="t-secondary mt-1">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              {showClose && (
                <Dialog.Close
                  className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-chip text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
                  aria-label="Tutup"
                >
                  <X size={16} />
                </Dialog.Close>
              )}
            </div>
          )}
          <div className="px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 px-6 pb-6 pt-2">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Ekspor primitif Radix mentah untuk kasus khusus (mis. palette yang butuh
// kontrol layout Content sendiri tanpa header/footer standar di atas).
export { Dialog as ModalPrimitive };
