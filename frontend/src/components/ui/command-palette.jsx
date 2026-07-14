import React, { useEffect, useState } from "react";
import { Search, Sparkles, CornerDownLeft } from "lucide-react";
import { ModalPrimitive as Dialog } from "@/components/ui/modal.jsx";

// Command palette (⌘K) — PERSIAPAN UI SAJA (Wave 1). Terbuka via ⌘K / Ctrl+K
// atau klik entry di Topbar. Menampilkan permukaan pencarian + grup placeholder;
// perintah/pencarian nyata BELUM diimplementasikan (menyusul di wave lanjutan).
// Lihat sano-components.md §B.4 & sano-ux-guidelines.md §1.3.
export function CommandPalette({ open, onOpenChange }) {
  const [q, setQ] = useState("");

  // Shortcut global ⌘K / Ctrl+K — murni pembuka UI, tidak menyentuh state lain.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-slate-900/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-[15vh] z-[201] w-[560px] max-w-[94vw] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-label="Pencarian & perintah cepat"
        >
          <Dialog.Title className="sr-only">Cari & perintah cepat</Dialog.Title>
          {/* Input pencarian */}
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-4">
            <Search size={17} className="shrink-0 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari pelanggan, percakapan, halaman…"
              className="h-12 w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
            />
            <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:block">
              ESC
            </kbd>
          </div>

          {/* Konten: state persiapan — grup placeholder */}
          <div className="max-h-[46vh] overflow-y-auto p-2">
            {/* Baris AI — aksen gradient halus, penanda "Tanya Sano" */}
            <div className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 opacity-70">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai-gradient text-white">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-slate-800">Tanya Sano</div>
                <div className="truncate text-[11px] text-slate-400">Asisten AI — segera hadir di sini</div>
              </div>
              <CornerDownLeft size={13} className="text-slate-300" />
            </div>

            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Navigasi & perintah
            </div>
            <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-slate-400">
              Pencarian global &amp; perintah cepat akan aktif di sini.
              <br />
              Untuk sekarang, gunakan menu di samping.
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
