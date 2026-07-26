import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "./card.jsx";
import IconTile from "./icon-tile.jsx";
import { cn } from "@/lib/utils.js";

// ─── STAT CARD (DS v2.1) — kartu KPI ─────────────────────────────────────────
// Susunan mengikuti referensi, dari atas ke bawah:
//   ubin ikon bertint → label kecil abu → ANGKA BESAR → delta + "vs periode".
//
// Urutan itu penting: ikon dulu memberi jangkar visual, angka jadi elemen
// paling dominan, konteks (delta) paling akhir dan paling kecil. Itu sebabnya
// kartu ini bisa dibaca sekilas tanpa membaca labelnya.
//
// `depth` mengatur kedalaman ubin — pemanggil menaikkannya berurutan (1,2,3,4)
// supaya satu baris KPI membentuk gradasi terang→gelap yang seragam.
export default function StatCard({
  label, value, icon, depth = 1, delta, deltaSuffix = "vs minggu lalu",
  onClick, className,
}) {
  const adaDelta = delta != null && Number.isFinite(delta);
  const naik = adaDelta && delta >= 0;
  const Arrow = naik ? TrendingUp : TrendingDown;

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-5",
        onClick && "cursor-pointer transition-shadow hover:shadow-popover",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <IconTile icon={icon} depth={depth} size="md" />

      <div>
        <p className="t-secondary">{label}</p>
        {/* Angka: tabular-nums supaya digit tidak bergeser saat count-up. */}
        <p className="t-metric mt-1">{value}</p>
      </div>

      {adaDelta && (
        <div className="flex items-baseline gap-1.5">
          {/* Hijau/merah di sini MAKNA (naik/turun), bukan dekorasi — satu dari
              tiga warna semantik yang diizinkan di samping tangga biru. */}
          <span className={cn(
            "inline-flex items-center gap-0.5 text-[13px] font-semibold tabular-nums",
            naik ? "text-green" : "text-red"
          )}>
            <Arrow size={13} strokeWidth={2.5} />
            {naik ? "+" : ""}{Number(delta).toFixed(1)}%
          </span>
          <span className="t-secondary text-[11px]">{deltaSuffix}</span>
        </div>
      )}
    </Card>
  );
}
