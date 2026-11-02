import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import KartuUnit from "@/features/production/rencana/KartuUnit.jsx";
import { SORTS, TABS } from "@/features/production/rencana/rencanaModel.js";

// Antrean kerja: SATU daftar "Belum dijadwalkan" untuk semua unit aktif yang layak (unit yang belum tiba berlabel "Belum tiba"), plus Terjadwal dan Butuh keputusan. Setiap kartu memuat alasan konkret;
// pencarian, urutan, dan halaman di server. Kartu bisa dicentang (beberapa unit) dan diseret; "Pilih meja" pada kartu = alternatif seret untuk HP dan keyboard.
export default function RencanaAntrean({ antrean, loading, tab, onTab, q, onQ, sort, onSort, izin, onAksi, onBuka, onDragStart, onDragEnd, onMuatLagi, muatLagi, seleksi = new Set(), onToggle, onPilihSemuaOrder, pendingIds = new Set() }) {
  const [teks, setTeks] = useState(q);
  useEffect(() => { setTeks(q); }, [q]);
  useEffect(() => { if (teks === q) return undefined; const t = setTimeout(() => onQ(teks), 300); return () => clearTimeout(t); }, [teks, q, onQ]);
  const counts = antrean?.counts || {};
  const kosongTeks = { BELUM: "Semua unit aktif yang layak sudah dijadwalkan.", KEPUTUSAN: "Tidak ada unit yang butuh keputusan.", TERJADWAL: "Belum ada unit terjadwal." }[tab] || "Tidak ada unit.";
  return (
    <section aria-label="Antrean kerja" data-testid="antrean" className="prod-rc-antrean min-w-0">
      <div role="tablist" aria-label="Antrean menurut tindakan" className="prod-rc-tab">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} data-testid={`tab-${t.key}`} title={t.hint} onClick={() => onTab(t.key)}
            className={`prod-rc-tab-item${tab === t.key ? " aktif rc-tab-on" : ""}`}>
            {t.label}<span className={tab === t.key ? "rc-tab-count" : undefined} data-testid={`hitung-${t.key}`}>{counts[t.key] ?? "–"}</span>
          </button>
        ))}
      </div>
      <div className="prod-rc-cari">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Cari pelanggan, nomor order, atau kode unit</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input type="search" value={teks} onChange={(e) => setTeks(e.target.value)} placeholder="Cari pelanggan, resi, atau unit" data-testid="antrean-cari" className="prod-cari-bahan" />
        </label>
        <label className="shrink-0"><span className="sr-only">Urutkan</span>
          <select value={sort} onChange={(e) => onSort(e.target.value)} data-testid="antrean-urut" className="prod-pilih">{SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
        </label>
      </div>
      <div className="prod-rc-daftar" data-testid="antrean-daftar" aria-busy={loading || undefined}>
        {!antrean && <div className="h-24 animate-pulse rounded-card bg-inset" aria-busy="true" />}
        {antrean && antrean.items.length === 0 && <p className="m-0 rounded-card border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink3" data-testid="antrean-kosong">{q ? `Tidak ada unit yang cocok dengan “${q}”.` : kosongTeks}</p>}
        {antrean?.items.map((it) => { const bisa = !!izin.jadwalkan && !it.perluKeputusan && it.jalur !== "V2" && !it.v2; return <KartuUnit key={it.unitId} item={it} izin={izin} mode="antrean" onAksi={onAksi} onBuka={onBuka} draggable={bisa} onDragStart={onDragStart} onDragEnd={onDragEnd} selectable={bisa} selected={seleksi.has(it.unitId)} onToggleSelect={onToggle} onPilihSemuaOrder={onPilihSemuaOrder} pending={pendingIds.has(it.unitId)} />; })}
        {antrean?.truncated && <p className="m-0 text-[12px] text-orange">Daftar dipotong di 1.500 unit — persempit pencarian.</p>}
        {antrean?.hasMore && <Button variant="neutral" className="w-full min-h-[40px]" onClick={onMuatLagi} disabled={muatLagi} data-testid="antrean-muat-lagi">{muatLagi ? "Memuat…" : `Muat lebih banyak (${antrean.items.length} dari ${antrean.total})`}</Button>}
      </div>
    </section>
  );
}
