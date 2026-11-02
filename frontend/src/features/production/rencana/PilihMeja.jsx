import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock } from "lucide-react";
import { alasanHariTidakBisa, labelHari, mejaTeks, pilihanMeja, validKey } from "@/features/production/rencana/rencanaModel.js";

// Pemilih meja: alternatif SERET untuk HP dan keyboard. Memanggil layanan jadwal yang SAMA dengan seret-lepas (satu ketukan pada meja = tersimpan; tanpa modal tanggal/target/PIC/rencana bahan).
// Hari awal = hari yang sedang dipilih di kalender. Beberapa unit: penempatan bersama di SATU meja, semua atau tidak sama sekali ("Otomatis" = meja pertama yang muat semuanya).
// Layar sempit tampil sebagai lembar bawah; Esc/klik di luar menutup.
export default function PilihMeja({ anchor, items, minggu, hari, onPilih, onAtur, onClose }) {
  const [tanggal, setTanggal] = useState(hari); const listRef = useRef(null);
  const jamak = items.length > 1; const tunggal = items[0];
  const sempit = typeof window !== "undefined" && window.innerWidth < 640;
  const pos = useMemo(() => { if (sempit || !anchor) return null; const r = anchor.getBoundingClientRect(); const lebar = 300; return { top: Math.min(r.bottom + 4, Math.max(window.innerHeight - 430, 8)), left: Math.max(8, Math.min(r.right - lebar, window.innerWidth - lebar - 8)) }; }, [anchor, sempit]);
  const hariKerja = (minggu?.days || []).filter((d) => d.hariKerja !== false);
  const sudahDi = !jamak && tunggal?.jadwal?.tanggal === tanggal ? tunggal.jadwal.meja || null : null;
  const pilihan = pilihanMeja(minggu, tanggal, { jumlah: jamak ? items.length : 1, sudahDi });
  const bukan = alasanHariTidakBisa(tanggal, minggu);

  useEffect(() => {
    const tutup = (e) => { if (!listRef.current?.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor?.focus?.(); } };
    // Gulir hanya menutup bila jangkarnya BENAR-BENAR bergeser (gulir lain di halaman tidak menutup pemilih yang sedang dipakai); lembar bawah (HP) tidak bergantung pada jangkar.
    const awalTop = anchor?.getBoundingClientRect?.().top ?? null;
    const gulir = (e) => { if (sempit || awalTop === null || listRef.current?.contains(e.target)) return; if (Math.abs((anchor.getBoundingClientRect().top) - awalTop) > 2) onClose(); };
    document.addEventListener("mousedown", tutup); document.addEventListener("keydown", esc); window.addEventListener("scroll", gulir, true);
    return () => { document.removeEventListener("mousedown", tutup); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", gulir, true); };
  }, [anchor, onClose, sempit]);
  useEffect(() => { listRef.current?.querySelector("button[data-meja]:not([disabled])")?.focus(); }, []);

  const judul = jamak ? `${items.length} unit` : `${tunggal.unitCode}`;
  return createPortal(
    <div ref={listRef} role="dialog" aria-label={`Pilih meja untuk ${judul}`} data-testid="pilih-meja"
      style={sempit ? { position: "fixed", left: 0, right: 0, bottom: 0 } : { position: "fixed", top: pos?.top, left: pos?.left, width: 300 }}
      className={`prod-pop${sempit ? " lembar" : ""}`}>
      <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><CalendarClock size={14} aria-hidden /> Jadwalkan {judul}</p>
      <p className="m-0 mb-2 mt-0.5 text-[12px] text-ink3">{jamak ? "Semua unit ditempatkan bersama di satu meja — semua atau tidak sama sekali." : "Hanya jadwal: tidak membuka Run, QC, penerimaan, atau pemakaian bahan."}</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Hari">
        {hariKerja.map((d) => { const lewat = !!alasanHariTidakBisa(d.date, minggu); const on = tanggal === d.date; return (
          <button key={d.date} type="button" disabled={lewat} aria-pressed={on} data-testid="pilih-hari" data-date={d.date} onClick={() => setTanggal(d.date)}
            className={`prod-pop-chip${on ? " aktif rc-tab-on" : ""}`}>{labelHari(d.date).replace(/ \w{3}$/, "")}</button>
        ); })}
      </div>
      {validKey(tanggal) && <p className="m-0 mt-1 text-[12px] text-ink3" data-testid="pilih-hari-label">{labelHari(tanggal)}</p>}
      {bukan ? <p role="alert" className="m-0 mt-2 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="pilih-meja-galat">{bukan}</p> : (
        <ul role="menu" className="m-0 mt-2 list-none space-y-1 p-0">
          {jamak && <li role="none"><button type="button" role="menuitem" data-meja="AUTO" data-testid="pilih-meja-auto" onClick={() => onPilih({ date: tanggal, meja: "AUTO" })} className="prod-pop-opsi otomatis min-h-[44px]"><span>Otomatis</span><span className="text-[12px] font-normal text-ink3">satu meja yang muat {items.length} unit</span></button></li>}
          {pilihan.map((m) => (
            <li key={m.code} role="none"><button type="button" role="menuitem" data-meja={m.code} data-testid="pilih-meja-opsi" disabled={!m.muat} onClick={() => onPilih({ date: tanggal, meja: m.code })} className="prod-pop-opsi">
              <span>{m.label}</span><span className={`text-[12px] ${m.sisa === 0 || !m.muat ? "text-red" : "text-ink3"}`}>{m.sisa == null ? "" : m.sisa === 0 ? "penuh" : !m.muat ? `sisa ${m.sisa} (kurang)` : `sisa ${m.sisa} tempat`}</span></button></li>
          ))}
          <li role="none"><button type="button" role="menuitem" data-meja="NONE" data-testid="pilih-tanpa-meja" onClick={() => onPilih({ date: tanggal, meja: null })} className="prod-pop-opsi lemah">{mejaTeks(null)} — hanya tanggal</button></li>
        </ul>
      )}
      {!jamak && onAtur && <button type="button" className="prod-pop-opsi lemah" data-testid="pilih-meja-atur" onClick={onAtur}>Atur tanggal, target, prioritas…</button>}
    </div>, document.body);
}
