import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.js";

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
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[201] w-[440px] max-w-[96vw] -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-black/5 bg-white shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            className
          )}
          {...contentProps}
        >
          {(title || showClose) && (
            <div className="flex items-start justify-between px-6 pb-0 pt-5">
              <div className="min-w-0">
                {title && (
                  <Dialog.Title className="text-base font-bold text-slate-900">{title}</Dialog.Title>
                )}
                {description && (
                  <Dialog.Description className="mt-1 text-[13px] text-slate-500">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              {showClose && (
                <Dialog.Close
                  className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Tutup"
                >
                  <X size={16} />
                </Dialog.Close>
              )}
            </div>
          )}
          <div className="px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Ekspor primitif Radix mentah untuk kasus khusus (mis. palette yang butuh
// kontrol layout Content sendiri tanpa header/footer standar di atas).
export { Dialog as ModalPrimitive };
