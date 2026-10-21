import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";

// Menu tambahan halaman (layar sempit): kontrol sekunder (Muat ulang, Export Excel, Papan Meja, Corner) dipindah ke sini supaya bagian atas layar HP tetap ringkas.
// Daftar dirender lewat portal (di atas banner pasang aplikasi dan tidak terpotong kartu); Esc/klik di luar/gulir menutup.
export default function MenuHalaman({ items }) {
  const [open, setOpen] = useState(false); const [pos, setPos] = useState(null); const ref = useRef(null); const listRef = useRef(null);
  const toggle = () => { if (!open && ref.current) { const r = ref.current.getBoundingClientRect(); setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); } setOpen((v) => !v); };
  useEffect(() => {
    if (!open) return undefined;
    const tutup = (e) => { if (!ref.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    const tutupGulir = () => setOpen(false);
    document.addEventListener("mousedown", tutup); document.addEventListener("keydown", esc); window.addEventListener("scroll", tutupGulir, true); window.addEventListener("resize", tutupGulir);
    return () => { document.removeEventListener("mousedown", tutup); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", tutupGulir, true); window.removeEventListener("resize", tutupGulir); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Button variant="neutral" size="sm" className="min-h-[44px] min-w-[44px] px-2" aria-label="Menu halaman" aria-haspopup="menu" aria-expanded={open} data-testid="menu-halaman" onClick={toggle}><MoreHorizontal size={18} aria-hidden /></Button>
      {open && pos && createPortal(
        <ul role="menu" ref={listRef} style={{ position: "fixed", top: pos.top, right: pos.right }} className="z-[9999] min-w-[210px] rounded-btn border border-line bg-surface p-1 shadow-lg" data-testid="menu-halaman-isi">
          {items.map((m) => <li key={m.key} role="none"><button type="button" role="menuitem" className="flex min-h-[44px] w-full items-center rounded-btn px-3 text-left text-[14px] text-ink hover:bg-inset focus-visible:bg-inset" data-aksi={m.key} onClick={() => { setOpen(false); m.onClick(); }}>{m.label}</button></li>)}
        </ul>, document.body)}
    </div>
  );
}
