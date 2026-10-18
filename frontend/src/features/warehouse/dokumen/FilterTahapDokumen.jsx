import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";

const BADGE = { neutral: "neutral", accent: "accent", orange: "orange", green: "green", red: "red" };
const PENGARUH = { BELUM: "Belum memengaruhi stok", DICADANG: "Stok dicadangkan", BERKURANG: "Saldo sudah dikurangi" };

/** Tab tahap (dengan hitungan) + kotak cari — pola sama dengan daftar Penerimaan Barang. */
export function FilterTahapDokumen({ filters, aktif, hitung, onPilih, cari, onCari, placeholder, labelCari, labelTab }) {
  return (
    <>
      <div role="tablist" aria-label={labelTab} className="flex gap-1 overflow-x-auto border-b border-line pb-2 md:flex-wrap">
        {filters.map((t) => (
          <button key={t.key} role="tab" aria-selected={aktif === t.key} onClick={() => onPilih(t.key)} data-testid={`tahap-${t.key || "semua"}`}
            className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors max-sm:min-h-11", aktif === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
            {t.label}{hitung && <span className="rounded-full bg-inset px-1.5 text-[11px] tabular-nums text-ink2">{hitung[t.key] ?? 0}</span>}
          </button>
        ))}
      </div>
      <div className="relative max-w-md">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
        <Input value={cari} onChange={(e) => onCari(e.target.value)} placeholder={placeholder} aria-label={labelCari} className="pl-9" />
      </div>
    </>
  );
}

/** Status dokumen di daftar: label dari server + pengaruh stok ringkas (agar petugas tahu dampaknya tanpa membuka dokumen). */
export function StatusDokumen({ r }) {
  const t = r.tampilan;
  return (
    <div className="space-y-0.5">
      <Badge variant={BADGE[t?.warna] ?? "neutral"} data-testid="status-baris" className="h-auto whitespace-normal text-left leading-tight">{t?.label ?? r.status}</Badge>
      {PENGARUH[t?.pengaruhStok] && <div className="text-[10.5px] text-ink3">{PENGARUH[t.pengaruhStok]}</div>}
    </div>
  );
}

/** Ringkasan item untuk satu baris daftar: "BUSA-01 · 10 pcs" + "+1 item lain". */
export function RingkasItem({ lines = [], kunci }) {
  if (!lines.length) return <span className="text-ink3">—</span>;
  const [a, ...sisa] = lines;
  return <span><span className="font-medium text-ink">{a.material?.name ?? a.material?.code}</span> <span className="text-ink3">· {Number(a[kunci]).toLocaleString("id-ID", { maximumFractionDigits: 4 })}</span>{sisa.length > 0 && <span className="text-ink3"> · +{sisa.length} item lain</span>}</span>;
}
