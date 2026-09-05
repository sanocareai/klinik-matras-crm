import React from "react";
import { TrendingUp, TrendingDown, Minus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import Sparkline from "./Sparkline.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";

// KPI card Laporan Analitik — gaya dashboard SaaS modern (referensi:
// Ultraleads/Edaca): card bersih TANPA border (DS v2), label+titik menu "..."
// (dekoratif) di baris atas, angka besar + badge delta SEJAJAR di baris yang
// sama (bukan bertumpuk), sparkline mini opsional di bawah.
//
// ⚠️ BUG NYATA YANG PERNAH TERJADI DI SINI: saat kartu "hero" kehilangan latar
// gradient navy-nya (DS v2 Step 4 — permukaan disamakan dgn kartu lain), teks
// di dalamnya TIDAK ikut diubah — label/angka/badge/sub tetap dipaksa
// `text-white` lewat prop `hero`. Hasilnya: teks putih di atas kartu PUTIH,
// tidak terbaca sama sekali. Sekarang `hero` hanya memberi TINT LATAR lembut
// (bg-blue-50) sebagai penanda "ini KPI utama tab ini", teksnya SELALU warna
// gelap normal — tidak ada cabang warna teks terpisah lagi.
export default function KpiCard({
  label, numericValue, format, growth, compareLabel, sparkline, hero = false, sub, index = 0, tooltip,
}) {
  const animated = useCountUp(numericValue);
  const displayValue = format ? format(animated) : Math.round(animated).toLocaleString("id-ID");

  const hasGrowth = growth !== undefined && growth !== null;
  const GrowthIcon = growth > 0 ? TrendingUp : growth < 0 ? TrendingDown : Minus;
  const growthLabel = `${growth > 0 ? "+" : ""}${growth}%`;

  return (
    <div
      // rounded-card (D-111, bukan rounded-2xl) — pilot kaca Laporan: --r-lg
      // (16px) SAMA PERSIS dengan rounded-2xl bawaan Tailwind, nol perubahan
      // radius, cuma supaya cocok wildcard kaca yang sudah ada. Komponen ini
      // dipakai bersama Armada (ArmadaDeliveryReport.jsx) & Gudang (Warehouse
      // Reports/Dashboard) — aman di keduanya: Gudang tidak pernah py
      // .glass-division jadi rule kaca tidak pernah match di sana (nol
      // perubahan), Armada SUDAH .glass-division jadi otomatis dapat kaca
      // juga (perbaikan tambahan, bukan regresi — sebelumnya kartu KPI
      // Armada ini kelewat dari pilot kaca sejak awal karena rounded-2xl).
      className={cn(
        "animate-fade-rise relative overflow-hidden rounded-card p-5 shadow-card transition-shadow duration-200 hover:shadow-popover text-ink",
        hero ? "bg-blue-50" : "bg-surface"
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium text-ink3">{label}</p>
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {/* Titik-tiga dekoratif SENGAJA disembunyikan saat ada tooltip —
            dua ikon kecil berdempetan di pojok kanan (⋯ dan info) terlihat
            berantakan dan tidak ada yang tahu titik-tiga itu tidak bisa diklik. */}
        {!tooltip && <MoreHorizontal size={16} className="text-ink3" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* min-w-0 (D-113) — jaring pengaman SETELAH bug nyata angka Rupiah
            kepotong (laporan owner, window ~1024-1280px, root cause utama
            sudah diperbaiki di breakpoint grid pemanggil xl:grid-cols-4).
            TANPA ini: `<p>` sebagai flex item default `min-width:auto`,
            menolak menyusut di bawah lebar intrinsik teksnya sendiri —
            begitu kartu lebih sempit dari angka, teks TIDAK wrap (flex-wrap
            di baris ini cuma memindah ITEM ke baris baru, bukan bikin teks
            DALAM satu item wrap), dia overflow lurus lalu ke-clip diam-diam
            oleh `overflow-hidden` induk. Dengan min-w-0, `<p>` (white-space
            normal bawaan, tidak di-override) bisa menyusut & wrap ke baris
            kedua kalau kartu genuinely sempit di lebar manapun di masa
            depan — angka Rupiah tidak boleh pernah lenyap diam-diam. */}
        <p className="min-w-0 text-[26px] font-extrabold leading-tight tabular-nums text-ink">
          {displayValue}
        </p>
        {hasGrowth && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
              growth > 0 ? "bg-greenbg text-green"
              : growth < 0 ? "bg-redbg text-red"
              : "bg-inset text-ink2"
            )}
          >
            <GrowthIcon size={11} /> {growthLabel}
          </div>
        )}
        {/* BUG YANG DIPERBAIKI (26 Agustus 2026): dulu fallback hardcode
            "vs periode sebelumnya" — tidak pernah bilang PANJANG periodenya
            (7 hari? kemarin? bulan lalu?), padahal backend sudah menghitung
            pembanding dengan panjang yang benar (buildPrevRange). Sekarang
            caller WAJIB kirim compareLabel (dari lib/dateRange.js) supaya
            teksnya selalu cocok dengan rentang tanggal yang sedang dipilih. */}
        {hasGrowth && compareLabel && (
          <span className="text-[11px] text-ink3">{compareLabel}</span>
        )}
      </div>

      {sub && (
        <p className="mt-1 text-xs text-ink3">{sub}</p>
      )}

      {sparkline && sparkline.length >= 2 && (
        <div className="-mx-1 mt-3">
          <Sparkline data={sparkline} color="var(--accent)" solid={false} />
        </div>
      )}
    </div>
  );
}
