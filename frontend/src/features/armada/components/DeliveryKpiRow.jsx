import React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils.js";

// Baris KPI dashboard Delivery.
//
// Tiap kartu BISA DIKLIK dan membawa ke /armada/jobs dengan filter status yang
// sesuai. KPI yang tidak bisa diklik memaksa orang mencari ulang di halaman
// lain apa yang baru saja dilihatnya — dan itu justru pekerjaan yang mau
// dihilangkan modul ini.
//
// Warna dipakai HANYA pada angka + titik penanda, bukan seluruh kartu. Aturan
// design system-nya eksplisit: "Jangan mewarnai seluruh card merah atau hijau."
const TONE = {
  neutral: { dot: "bg-ink3",     value: "text-ink" },
  accent:  { dot: "bg-accent",   value: "text-accent" },
  green:   { dot: "bg-green",    value: "text-green" },
  orange:  { dot: "bg-orange",   value: "text-orange" },
  red:     { dot: "bg-red",      value: "text-red" },
};

export default function DeliveryKpiRow({ items }) {
  const navigate = useNavigate();

  return (
    // 2 kolom di mobile → 3 di tablet → 6 di desktop, sesuai ketentuan responsif.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((k) => {
        const tone = TONE[k.tone] || TONE.neutral;
        return (
          <button
            key={k.key}
            type="button"
            onClick={() => navigate(`/armada/jobs?status=${k.key}`)}
            aria-label={`${k.label}: ${k.value} job. Buka daftar job.`}
            className={cn(
              "rounded-card border border-border bg-surface p-3.5 text-left transition-all",
              "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
              <span className="truncate text-[11px] font-semibold text-ink2">{k.label}</span>
            </span>
            <strong className={cn("mt-1.5 block text-[26px] font-bold leading-none tracking-tight", tone.value)}>
              {k.value}
            </strong>
          </button>
        );
      })}
    </div>
  );
}
