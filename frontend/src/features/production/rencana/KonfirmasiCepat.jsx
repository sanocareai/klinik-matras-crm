import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

// Konfirmasi SATU ketukan (pola lembar aksi): judul, penjelasan dampak, tombol utama + Batal. Layar sempit = lembar bawah; Esc/klik di luar menutup.
// Dipakai untuk "Tandai tiba" dan "Ubah ke Diproses" di Rencana Produksi — tindakan kecil yang tidak butuh formulir.
export default function KonfirmasiCepat({ anchor, judul, isi, labelYa, onYa, onClose, testid = "konfirmasi-cepat" }) {
  const ref = useRef(null);
  const sempit = (typeof window !== "undefined" && window.innerWidth < 640) || !anchor; // tanpa jangkar (dari menu) = lembar bawah
  const pos = useMemo(() => {
    if (sempit || !anchor) return null; const r = anchor.getBoundingClientRect(); const lebar = 300;
    const tinggi = 170; const muatBawah = r.bottom + 6 + tinggi <= window.innerHeight; // tidak muat di bawah = buka di ATAS pemicu (tidak menutupinya)
    return { top: muatBawah ? r.bottom + 6 : Math.max(8, r.top - 6 - tinggi), left: Math.max(8, Math.min(r.left, window.innerWidth - lebar - 8)) };
  }, [anchor, sempit]);
  useEffect(() => {
    const tutup = (e) => { if (!ref.current?.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor?.focus?.(); } };
    document.addEventListener("mousedown", tutup); document.addEventListener("keydown", esc);
    ref.current?.querySelector("[data-ya]")?.focus();
    return () => { document.removeEventListener("mousedown", tutup); document.removeEventListener("keydown", esc); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="alertdialog" aria-label={judul} data-testid={testid}
      style={sempit ? { position: "fixed", left: 0, right: 0, bottom: 0 } : { position: "fixed", top: pos?.top, left: pos?.left, width: 300 }}
      className={`prod-pop rc-konfirmasi${sempit ? " lembar" : ""}`}>
      <p className="m-0 text-[14px] font-semibold text-ink">{judul}</p>
      {isi && <p className="m-0 mt-1 text-[12.5px] leading-snug text-ink3">{isi}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="rc-konfirmasi-btn netral" onClick={onClose}>Batal</button>
        <button type="button" data-ya className="rc-konfirmasi-btn utama" data-testid={`${testid}-ya`} onClick={onYa}>{labelYa}</button>
      </div>
    </div>, document.body);
}
