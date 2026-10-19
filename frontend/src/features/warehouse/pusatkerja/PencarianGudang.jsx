import React, { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

/**
 * Pencarian Gudang (UX Gudang Tahap 4): nomor GR/PO/Stock Count/Pengeluaran Material/Transfer/Koreksi, bahan, supplier, unit/order. Baca-saja: hasil membuka jendela fokus dokumen;
 * tombol tindakan cepat hanya muncul bila server menyatakan pengguna boleh DAN aksi itu sah untuk status dokumen saat ini — dan hanya membuka dokumen dengan aksi itu dibuka/disorot.
 */
export default function PencarianGudang({ onBuka }) {
  const [q, setQ] = useState(""); const [hasil, setHasil] = useState(null); const [memuat, setMemuat] = useState(false); const [galat, setGalat] = useState(""); const urut = useRef(0);
  useEffect(() => {
    const kata = q.trim();
    if (kata.length < 2) { urut.current++; setHasil(null); setGalat(""); setMemuat(false); return undefined; }
    const n = ++urut.current; setMemuat(true);
    const t = setTimeout(async () => {
      try { const d = await api.cariGudang(kata); if (n === urut.current) { setHasil(d); setGalat(""); } } catch (e) { if (n === urut.current) setGalat(e.message || "Pencarian gagal"); } finally { if (n === urut.current) setMemuat(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2" data-testid="pencarian-gudang">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} aria-label="Cari di Gudang" data-testid="cari-gudang"
          placeholder="Cari nomor, bahan, supplier, unit…" autoComplete="off"
          className="h-10 w-full rounded-btn border border-line bg-surface pl-9 pr-9 text-[13px] text-ink placeholder:text-ink3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent max-sm:h-11" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Hapus pencarian" className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-chip text-ink3 hover:bg-hovertint max-sm:h-9 max-sm:w-9"><X size={14} /></button>}
      </div>
      {q.trim().length === 1 && <p className="m-0 text-[12px] text-ink3">Ketik minimal 2 karakter.</p>}
      {memuat && <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink3" aria-busy="true"><Loader2 size={13} className="animate-spin" /> Mencari…</p>}
      {galat && <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>}
      {hasil && !memuat && (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-btn border border-line bg-surface p-3" data-testid="hasil-pencarian">
          {hasil.kelompok.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="pencarian-kosong">Tidak ada dokumen, bahan, atau supplier yang cocok dengan “{hasil.q}”.</p>}
          {hasil.kelompok.map((k) => (
            <div key={k.jenis} data-testid={`hasil-${k.jenis}`}>
              <h4 className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">{k.label}</h4>
              <ul className="m-0 list-none space-y-1 p-0">
                {k.hasil.map((h) => (
                  <li key={`${h.jenis}:${h.id}`} className="flex flex-wrap items-center gap-2 rounded-btn hover:bg-hovertint" data-testid="hasil-baris">
                    <button type="button" onClick={() => onBuka(h, null)} className="min-w-0 flex-1 rounded-btn px-2 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent max-sm:min-h-11" data-testid="buka-hasil">
                      <span className="text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">{h.nomor}</span>
                      {h.judul && h.judul !== h.nomor && <span className="ml-1.5 text-[12.5px] text-ink2">{h.judul}</span>}
                      {h.status && <Badge variant="neutral" className="ml-2">{h.status}</Badge>}
                      {h.sub && <span className="block text-[11.5px] text-ink3 [overflow-wrap:anywhere]">{h.sub}</span>}
                    </button>
                    {h.aksi && <Button size="sm" variant="secondary" onClick={() => onBuka(h, h.aksi.kode)} className="max-sm:min-h-11 max-sm:w-full" data-testid="aksi-hasil" data-kode={h.aksi.kode}>{h.aksi.label}</Button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
