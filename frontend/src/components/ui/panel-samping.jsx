import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { DaftarOverlay } from "./overlay-status.jsx";
import { X } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Panel samping (lembar geser dari kanan) di atas Radix Dialog: fokus terkunci di panel, Esc menutup, fokus kembali ke pemicu (onCloseAutoFocus), aria otomatis.
// Desktop: lebar `lebar` (maks. 100vw) di kanan, daftar di belakang tetap ter-mount (posisi gulir, pencarian, dan filter tidak hilang). HP (<= 640px): layar penuh.
// OPT-IN: komponen baru; Modal dan pemakai lain tidak berubah. Di-portal ke `.app-shell` (seperti Modal) agar gaya lapisan Produksi ikut berlaku.
export function PanelSamping({ open, onOpenChange, judul, subjudul, kepalaKanan = null, children, lebar = 980, className, contentProps = {}, onCloseAutoFocus }) {
  const wadah = typeof document !== "undefined" ? document.querySelector(".app-shell") : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={wadah}>
        <Dialog.Overlay className="prod-ps-overlay fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          style={{ "--ps-lebar": `${lebar}px` }}
          className={cn("prod-ps fixed right-0 top-0 z-[201] flex h-full flex-col outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right", className)}
          onCloseAutoFocus={onCloseAutoFocus}
          {...contentProps}
        >
          <header className="prod-ps-kepala">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="prod-ps-judul">{judul}</Dialog.Title>
              {subjudul ? <Dialog.Description asChild><div className="prod-ps-sub">{subjudul}</div></Dialog.Description> : <Dialog.Description className="sr-only">Rincian unit</Dialog.Description>}
            </div>
            {kepalaKanan}
            <Dialog.Close className="prod-ps-tutup" aria-label="Tutup"><X size={20} aria-hidden /></Dialog.Close>
          </header>
          <div className="prod-ps-isi">{children}</div>
          <DaftarOverlay />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
