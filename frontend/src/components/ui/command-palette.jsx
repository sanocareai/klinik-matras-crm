import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles, CornerDownLeft } from "lucide-react";
import { ModalPrimitive as Dialog } from "@/components/ui/modal.jsx";

// Command palette (⌘K) — PERSIAPAN UI SAJA (Wave 1). Terbuka via ⌘K / Ctrl+K
// atau klik entry di Topbar. Menampilkan permukaan pencarian + grup placeholder;
// perintah/pencarian nyata BELUM diimplementasikan (menyusul di wave lanjutan).
// Lihat sano-components.md §B.4 & sano-ux-guidelines.md §1.3.
// Fase 1 kerangka bersama Sales CRM: bila `halaman` (daftar menu yang boleh dilihat
// pengguna — SUMBER YANG SAMA dengan sidebar, sehingga hak akses tidak berbeda)
// dan `onPilih` diberikan, palette mencari HALAMAN/MENU dan membukanya di tab aktif.
// Tanpa `halaman` (divisi lain) tampilannya persis seperti sebelumnya. Pencarian
// pelanggan/order/percakapan BELUM ada di palette — hanya halaman yang didukung.
export function CommandPalette({ open, onOpenChange, halaman, onPilih }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef(null);
  const aktif = Array.isArray(halaman) && typeof onPilih === "function";

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

  useEffect(() => { if (!open) { setQ(""); setIdx(0); } }, [open]);

  const hasil = useMemo(() => {
    if (!aktif) return [];
    const kata = q.trim().toLowerCase();
    if (!kata) return halaman;
    return halaman.filter((h) => `${h.label} ${h.section || ""}`.toLowerCase().includes(kata));
  }, [aktif, halaman, q]);
  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[data-aktif="true"]')?.scrollIntoView({ block: "nearest" }); }, [idx]);

  function pilih(h) {
    if (!h) return;
    onOpenChange(false);
    onPilih(h);
  }
  function onInputKey(e) {
    if (!aktif) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(0, hasil.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pilih(hasil[idx]); }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-[15vh] z-[201] w-[560px] max-w-[94vw] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface shadow-popover outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-label="Pencarian & perintah cepat"
        >
          <Dialog.Title className="sr-only">Cari & perintah cepat</Dialog.Title>
          {/* Input pencarian */}
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={17} className="shrink-0 text-ink3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={aktif ? "Cari halaman atau menu…" : "Cari pelanggan, percakapan, halaman…"}
              className={"h-12 w-full bg-transparent text-sm text-ink placeholder:text-ink3 outline-none" + (aktif ? " palette-input-ringkas" : "")}
            />
            <kbd className="hidden shrink-0 rounded-md bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-ink3 sm:block">
              ESC
            </kbd>
          </div>

          {aktif ? (
            <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2" role="listbox" aria-label="Hasil pencarian halaman">
              {hasil.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-ink3">
                  Tidak ada halaman yang cocok dengan “{q.trim()}”.
                </div>
              ) : hasil.map((h, i) => (
                <button
                  key={h.to}
                  type="button"
                  role="option"
                  aria-selected={i === idx}
                  data-aktif={i === idx ? "true" : "false"}
                  onMouseMove={() => setIdx(i)}
                  onClick={() => pilih(h)}
                  className={"flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors " + (i === idx ? "bg-inset" : "")}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{h.label}</span>
                  {h.section && <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-ink3">{h.section}</span>}
                  {i === idx && <CornerDownLeft size={13} className="shrink-0 text-ink3" />}
                </button>
              ))}
            </div>
          ) : (
          <div className="max-h-[46vh] overflow-y-auto p-2">
            {/* Baris AI — aksen gradient halus, penanda "Tanya Sano" */}
            <div className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 opacity-70">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai-gradient text-white">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-ink">Tanya Sano</div>
                <div className="truncate text-[11px] text-ink3">Asisten AI — segera hadir di sini</div>
              </div>
              <CornerDownLeft size={13} className="text-ink3" />
            </div>

            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink3">
              Navigasi & perintah
            </div>
            <div className="px-3 py-6 text-center text-[12.5px] leading-relaxed text-ink3">
              Pencarian global &amp; perintah cepat akan aktif di sini.
              <br />
              Untuk sekarang, gunakan menu di samping.
            </div>
          </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
