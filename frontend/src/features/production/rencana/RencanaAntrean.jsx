import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import KartuUnit from "@/features/production/rencana/KartuUnit.jsx";
import { SORTS, TABS } from "@/features/production/rencana/rencanaModel.js";

// Antrean kerja menurut TINDAKAN: Siap dijadwalkan · Butuh keputusan · Menunggu unit tiba · Terjadwal. Setiap kartu memuat alasan konkret; pencarian, urutan, dan halaman di server.
export default function RencanaAntrean({ antrean, loading, tab, onTab, q, onQ, sort, onSort, izin, onAksi, onBuka, onDragStart, onDragEnd, onMuatLagi, muatLagi }) {
  const [teks, setTeks] = useState(q);
  useEffect(() => { setTeks(q); }, [q]);
  useEffect(() => { if (teks === q) return undefined; const t = setTimeout(() => onQ(teks), 300); return () => clearTimeout(t); }, [teks, q, onQ]);
  const counts = antrean?.counts || {};
  const kosongTeks = { SIAP: "Tidak ada unit yang siap dijadwalkan.", KEPUTUSAN: "Tidak ada unit yang butuh keputusan.", MENUNGGU_TIBA: "Tidak ada unit yang menunggu tiba.", TERJADWAL: "Belum ada unit terjadwal." }[tab] || "Tidak ada unit.";
  return (
    <section aria-label="Antrean kerja" data-testid="antrean" className="min-w-0 space-y-2">
      <div role="tablist" aria-label="Antrean menurut tindakan" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} data-testid={`tab-${t.key}`} title={t.hint} onClick={() => onTab(t.key)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-chip px-3 text-[12.5px] font-medium ${tab === t.key ? "rc-tab-on bg-accent text-white" : "bg-inset text-ink2 hover:bg-hovertint"}`}>
            {t.label}<span className={`rounded-full px-1.5 text-[11px] ${tab === t.key ? "rc-tab-count" : "bg-surface"}`} data-testid={`hitung-${t.key}`}>{counts[t.key] ?? "–"}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Cari pelanggan, nomor order, atau kode unit</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input type="search" value={teks} onChange={(e) => setTeks(e.target.value)} placeholder="Cari pelanggan, resi, atau unit" data-testid="antrean-cari" className="h-9 w-full rounded-btn border border-line bg-transparent pl-8 pr-2 text-[13px] text-ink" />
        </label>
        <label className="shrink-0"><span className="sr-only">Urutkan</span>
          <select value={sort} onChange={(e) => onSort(e.target.value)} data-testid="antrean-urut" className="h-9 rounded-btn border border-line bg-transparent px-2 text-[13px] text-ink">{SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </label>
      </div>
      <div className="space-y-2" data-testid="antrean-daftar" aria-busy={loading || undefined}>
        {!antrean && <div className="h-24 animate-pulse rounded-card bg-inset" aria-busy="true" />}
        {antrean && antrean.items.length === 0 && <p className="m-0 rounded-card border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink3" data-testid="antrean-kosong">{q ? `Tidak ada unit yang cocok dengan “${q}”.` : kosongTeks}</p>}
        {antrean?.items.map((it) => <KartuUnit key={it.unitId} item={it} izin={izin} mode="antrean" onAksi={onAksi} onBuka={onBuka} draggable={!!izin.jadwalkan && !it.perluKeputusan && it.jalur !== "V2" && !it.v2} onDragStart={onDragStart} onDragEnd={onDragEnd} />)}
        {antrean?.truncated && <p className="m-0 text-[12px] text-orange">Daftar dipotong di 1.500 unit — persempit pencarian.</p>}
        {antrean?.hasMore && <Button variant="neutral" className="w-full min-h-[40px]" onClick={onMuatLagi} disabled={muatLagi} data-testid="antrean-muat-lagi">{muatLagi ? "Memuat…" : `Muat lebih banyak (${antrean.items.length} dari ${antrean.total})`}</Button>}
      </div>
    </section>
  );
}
