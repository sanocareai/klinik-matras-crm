import React, { useEffect, useId, useRef, useState } from "react";
import { IkSaring } from "@/components/gudangIcons.jsx";

// FILTER TAMBAHAN daftar bahan — popover di bawah tombol "Filter" (lembar bawah di HP) supaya blok saringan tidak mendorong daftar keluar layar.
// Tidak mengubah logika saringan: isi popover = kontrol saringan yang sama (PilihGud + saklar); jumlah saringan aktif tampil di tombol.
// Menutup lewat Esc, klik di luar, atau "Selesai". Menu dropdown di dalamnya dirender di portal (.gud-menu) — klik di sana TIDAK dianggap klik di luar.
export default function FilterPopover({ jumlah = 0, onReset, children }) {
  const [buka, setBuka] = useState(false); const akar = useRef(null); const tombol = useRef(null); const id = useId();
  useEffect(() => {
    if (!buka) return undefined;
    const luar = (e) => { if (akar.current?.contains(e.target) || e.target.closest?.(".gud-menu, [data-radix-popper-content-wrapper]")) return; setBuka(false); };
    const esc = (e) => { if (e.key === "Escape" && !document.querySelector(".gud-menu")) { setBuka(false); tombol.current?.focus(); } };
    document.addEventListener("pointerdown", luar); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", luar); document.removeEventListener("keydown", esc); };
  }, [buka]);
  return (
    <div className="gud-filter" ref={akar}>
      <button ref={tombol} type="button" className="gud-tombol gud-filter-tombol" aria-expanded={buka} aria-controls={buka ? id : undefined} aria-haspopup="dialog" onClick={() => setBuka((v) => !v)} data-testid="buka-filter">
        <IkSaring size={16} /> Filter{jumlah > 0 && <span className="gud-filter-hitung" data-testid="hitung-filter">{jumlah}</span>}
      </button>
      {buka && (
        <>
          <div className="gud-filter-tirai" onClick={() => setBuka(false)} aria-hidden />
          <div id={id} role="dialog" aria-label="Filter daftar bahan" className="gud-filter-isi" data-testid="panel-filter">
            <div className="gud-filter-kepala"><span className="gud-filter-judul">Filter</span><button type="button" className="gud-tautan" onClick={onReset} disabled={jumlah === 0} data-testid="reset-di-filter">Reset</button></div>
            <div className="gud-filter-badan">{children}</div>
            <div className="gud-filter-kaki"><button type="button" className="gud-tombol gud-tombol-utama" onClick={() => { setBuka(false); tombol.current?.focus(); }} data-testid="selesai-filter">Selesai</button></div>
          </div>
        </>
      )}
    </div>
  );
}
