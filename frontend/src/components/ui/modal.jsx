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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[201] w-[440px] max-w-[96vw] -translate-x-1/2 -translate-y-1/2",
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
