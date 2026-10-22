import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, Search } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { ketersediaanNada, ketersediaanText } from "@/features/production/orderProduksiModel.js";

// Pemilih bahan dari katalog Gudang: kelompok (Busa, Kain, …) + cari di SELURUH katalog + saldo tersedia / "stok belum diketahui". SATU katalog saja yang tampil pada satu waktu (dipakai oleh Catat pemakaian aktual).
import "@/features/production/bahan/bahan.css";
const NADA = { green: "bh-ok", orange: "bh-warn", red: "bh-bad", neutral: "text-ink2" };

export default function PemilihBahanKatalog({ dipilihIds, onTambah, disabled = false, tinggi = 240, testid = "pemilih" }) {
  const [cari, setCari] = useState(""); const [tunda, setTunda] = useState(""); const [kelompok, setKelompok] = useState("");
  const [kat, setKat] = useState({ rows: [], kelompok: [], total: 0, memuat: true, galat: "" }); const reqRef = useRef(0);
  useEffect(() => { const t = setTimeout(() => setTunda(cari.trim()), 250); return () => clearTimeout(t); }, [cari]);
  const muat = useCallback(async () => {
    const id = ++reqRef.current; setKat((k) => ({ ...k, memuat: true, galat: "" }));
    try {
      const d = await api.getKatalogBahanProduksi({ q: tunda || undefined, kelompok: tunda ? undefined : kelompok || undefined, limit: "60" });
      if (id === reqRef.current) setKat({ rows: d.rows || [], kelompok: d.kelompok || [], total: d.total ?? (d.rows || []).length, memuat: false, galat: "" });
    } catch (e) { if (id === reqRef.current) setKat((k) => ({ ...k, memuat: false, galat: e.message || "Katalog bahan gagal dimuat" })); }
  }, [tunda, kelompok]);
  useEffect(() => { muat(); }, [muat]);

  return (
    <div className="space-y-2" data-testid={testid}>
      <label className="relative block"><span className="sr-only">Cari bahan di seluruh katalog</span>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
        <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari bahan (nama atau kode)…" data-testid={`${testid}-cari`} disabled={disabled}
          className="h-11 w-full rounded-btn border border-line bg-surface pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
      <div role="group" aria-label="Kelompok bahan" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {[{ kode: "", label: "Semua", jumlah: null }, ...kat.kelompok.filter((k) => k.jumlah > 0 || k.kode === kelompok)].map((k) => (
          <button key={k.kode || "semua"} type="button" aria-pressed={!tunda && kelompok === k.kode} disabled={!!tunda || disabled} data-testid={`${testid}-kelompok-${k.kode || "semua"}`} onClick={() => setKelompok(k.kode)}
            className={cn("min-h-[40px] shrink-0 rounded-chip px-3 text-[13px] font-medium transition-colors disabled:opacity-40", !tunda && kelompok === k.kode ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>
            {k.label}{k.jumlah != null && <span className="bh-count">{k.jumlah}</span>}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto rounded-btn bg-inset" style={{ maxHeight: tinggi }} data-testid={`${testid}-daftar`} aria-busy={kat.memuat}>
        {kat.galat && <p role="alert" className="m-0 flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] text-red">{kat.galat}<Button variant="tertiary" size="sm" onClick={muat}>Coba lagi</Button></p>}
        {kat.memuat && !kat.rows.length && <div className="space-y-2 p-3" aria-label="Memuat katalog bahan">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-line/60 motion-reduce:animate-none" />)}</div>}
        {!kat.memuat && !kat.galat && !kat.rows.length && <p className="m-0 px-3 py-4 text-center text-[13px] text-ink3">{tunda ? `Tidak ada bahan cocok dengan “${tunda}”.` : "Kelompok ini belum punya bahan aktif."}</p>}
        <ul className="m-0 list-none divide-y divide-line p-0">
          {kat.rows.map((b) => {
            const ada = dipilihIds.has(b.materialId);
            return (
              <li key={b.materialId} className="flex items-center gap-3 px-3 py-2" data-testid={`${testid}-baris`}>
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span>
                  <span className="block text-[11.5px] text-ink2">{b.kode} · {b.satuan}{tunda ? ` · ${b.kelompok?.label}` : ""} · <span className={NADA[ketersediaanNada(b)]}>{ketersediaanText(b)}</span></span></span>
                <Button variant={ada ? "neutral" : "secondary"} size="sm" className="bh-pilih min-h-[40px] shrink-0" disabled={ada || disabled} onClick={() => onTambah(b)} aria-label={ada ? `${b.nama} sudah dipilih` : `Pilih ${b.nama}`}>
                  {ada ? <><CheckCircle2 size={14} aria-hidden /> Dipilih</> : <><Plus size={14} aria-hidden /> Pilih</>}
                </Button>
              </li>
            );
          })}
        </ul>
        {kat.total > kat.rows.length && <p className="m-0 px-3 py-2 text-center text-[12px] text-ink3">Menampilkan {kat.rows.length} dari {kat.total}. Persempit dengan kata kunci.</p>}
      </div>
    </div>
  );
}
