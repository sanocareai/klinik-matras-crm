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
// Warna dipakai HANYA pada angka + badge ikon, bukan seluruh kartu. Aturan
// design system-nya eksplisit: "Jangan mewarnai seluruh card merah atau hijau."
//
// Badge ikon bulat berwarna (D-047, 4 September 2026 — laporan owner: "buat
// seperti artifacts", mockup redesain punya ikon dibungkus lingkaran tint
// per-tone, bukan cuma titik kecil) — dot lama DIGANTI, bukan ditambah:
// dua penanda warna untuk satu angka jadi berlebihan begitu badge ikon ada.
const TONE = {
  neutral: { badge: "bg-inset text-ink3",     value: "text-ink" },
  accent:  { badge: "bg-accentbg text-accent", value: "text-accent" },
  green:   { badge: "bg-greenbg text-green",   value: "text-green" },
  orange:  { badge: "bg-orangebg text-orange", value: "text-orange" },
  red:     { badge: "bg-redbg text-red",       value: "text-red" },
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
              "flex flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5 text-left transition-all",
              "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            )}
          >
            {k.icon && (
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone.badge)}>
                <k.icon size={16} strokeWidth={2} aria-hidden />
              </span>
            )}
            <span>
              {/* dh-figure (D-045) — cahaya halus di angka besar, HANYA aktif di
                  dark mode Delivery (lihat styles/delivery-dark.css); di light
                  mode kelas ini tidak punya aturan sama sekali = tidak berefek. */}
              <strong className={cn("dh-figure block text-[26px] font-extrabold leading-none tracking-tight", tone.value)}>
                {k.value}
              </strong>
              <span className="mt-1 block truncate text-[11px] font-semibold text-ink2">{k.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
