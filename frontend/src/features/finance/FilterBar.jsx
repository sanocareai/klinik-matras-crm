import React, { useEffect, useState } from "react";
import { Search, X, ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.js";

// BAR PENCARIAN + FILTER (glass, bergaya Apple) — dipakai di setiap tab
// transaksi Finance. Gaya di index.css (.fin-glass/.fin-search/.fin-chip),
// warnanya dari token tema jadi ikut mode terang/gelap.
//
//   <FilterBar
//     q={q} onQ={setQ} placeholder="Cari nomor, keterangan…"
//     filters={[{ key: "kat", label: "Kategori", value, onChange,
//                 options: [["id", "Nama"], …] }]}     // "Semua" ditambah otomatis
//     ringkasan="12 dari 240 transaksi"
//     onReset={() => …}
//   />
//
// Filter dirender sebagai "chip": kalau aktif, chip berubah biru dan
// menampilkan pilihan yang dipilih. <select> asli di balik chip (transparan)
// sehingga di HP yang muncul picker bawaan OS.

/** Nilai yang tertunda — dipakai pencarian ke server supaya tidak menembak API tiap ketikan. */
export function useTertunda(nilai, ms = 350) {
  const [v, setV] = useState(nilai);
  useEffect(() => {
    const t = setTimeout(() => setV(nilai), ms);
    return () => clearTimeout(t);
  }, [nilai, ms]);
  return v;
}

/** Pencarian sisi-klien: semua kata di `q` harus muncul di gabungan `bidang`. */
export function cocok(q, ...bidang) {
  const kata = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return true;
  const gudang = bidang.filter((x) => x !== null && x !== undefined).join(" ").toLowerCase();
  return kata.every((k) => gudang.includes(k));
}

function Chip({ label, value, onChange, options }) {
  const aktif = value !== "" && value !== undefined && value !== null;
  const terpilih = options.find(([v]) => String(v) === String(value));
  return (
    <label className="fin-chip" data-aktif={aktif ? "true" : "false"}>
      <span>{aktif && terpilih ? terpilih[1] : label}</span>
      <ChevronDown size={14} className="fin-chip-caret" aria-hidden="true" />
      <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{`Semua · ${label}`}</option>
        {options.map(([v, teks]) => <option key={v} value={v}>{teks}</option>)}
      </select>
    </label>
  );
}

export default function FilterBar({ q, onQ, placeholder = "Cari…", filters = [], ringkasan, onReset, className }) {
  const adaAktif = !!q || filters.some((f) => f.value !== "" && f.value !== undefined && f.value !== null);
  return (
    // Posisi NORMAL document flow — `sticky` (BUKAN `absolute`/`fixed`/
    // `transform`) tetap ikut alur normal, cuma "menempel" saat scroll,
    // jadi tidak melanggar aturan "jangan absolute/negative margin/
    // transform" (D-XXX, 22 Sep 2026). `mb-2` DITAMBAHKAN di atas jarak
    // `gap-6` (24px) bawaan PageBody — total jadi 32px ke Card berikutnya
    // (⩾28px yang diminta) TANPA mengubah `gap-6` PageBody yang dipakai
    // 50+ halaman non-Finance lain.
    <div className={cn("fin-glass sticky top-2 z-30 mb-2 space-y-2.5 px-3 pt-3 pb-1", className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="fin-search sm:max-w-[420px] sm:flex-1">
          <Search size={16} className="shrink-0 text-ink3" aria-hidden="true" />
          <input
            type="search" value={q} onChange={(e) => onQ(e.target.value)}
            placeholder={placeholder} aria-label="Cari transaksi"
            enterKeyHint="search" autoComplete="off"
          />
          {q && (
            <button type="button" onClick={() => onQ("")} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink3 hover:bg-hovertint" aria-label="Hapus pencarian">
              <X size={14} />
            </button>
          )}
        </div>

        {filters.length > 0 && (
          <div className="fin-scroll-x min-w-0 flex-1 items-center">
            <SlidersHorizontal size={15} className="mr-0.5 shrink-0 self-center text-ink3 max-sm:hidden" aria-hidden="true" />
            {filters.map((f) => <Chip key={f.key} label={f.label} value={f.value} onChange={f.onChange} options={f.options} />)}
          </div>
        )}
      </div>

      {(ringkasan || adaAktif) && (
        // pb-4 (16px) — teks "jumlah data" WAJIB punya jarak ⩾14px ke
        // border bawah panel (sebelumnya pb-3/12px, sedikit di bawah
        // minimum yang diminta).
        <div className="flex items-center justify-between gap-3 px-1 pb-4 text-[12px] text-ink3">
          <span>{ringkasan}</span>
          {adaAktif && onReset && (
            <button type="button" onClick={onReset} className="font-medium text-accent hover:underline">Atur ulang</button>
          )}
        </div>
      )}
    </div>
  );
}
