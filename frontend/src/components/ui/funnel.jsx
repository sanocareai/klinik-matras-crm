import React from "react";
import { cn } from "@/lib/utils.js";

// ─── FUNNEL (DS v2.1) ────────────────────────────────────────────────────────
// Corong trapesium: tiap tahap menyempit, angka di dalam segmen, label di kanan.
//
// PERBAIKAN dari versi pertama — di produksi bentuknya salah:
//  1. Segmen di-render `width: <persen>%` DI DALAM kolom sempit, jadi
//     penyempitannya nyaris tidak terlihat (semua terlihat seperti bar).
//     Sekarang SEMUA segmen selebar kolom, dan yang menyempit adalah BENTUK-nya
//     lewat clip-path — jadi tepinya benar-benar miring dan menyatu.
//  2. Label di kanan kena truncate ("Pros...", "Offers/Negosi..."). Kolom label
//     sekarang punya lebar tetap yang cukup dan tidak lagi ikut menyusut.
//
// WARNA: satu keluarga biru, makin ke bawah makin PEKAT — tahap terbawah
// (Berhasil) paling bernilai, jadi warna terkuat mendarat di tempat terpenting.
//
// REVISI (D-092, 5 September 2026) — owner: dashboard dark mode "gabegitu
// banyak berubah", dibandingkan ke referensi (crypto dashboard: bar chart
// SATU hue tapi terang→gelap jelas beda, bukan mepet). RAMP lama mulai dari
// blue-200→blue-300 — di dark theme keduanya cuma tint TRANSLUCENT alpha
// 0.24 vs 0.34 (lihat --blue-200/-300 di tokens.css blok dark), bedanya
// nyaris tak kelihatan berdampingan. Digeser turun satu anak tangga
// (blue-100 dimulai, lompat ke blue-300 — skip 200) + bluesolid dinaikkan
// jadi 3 opacity berjenjang (55/80/100) alih-alih 85/100/100 — rentangnya
// jauh lebih lebar dari ujung ke ujung, TETAP satu hue (taat "aturan satu
// accent"), cuma levelnya lebih jauh terpisah.
const RAMP = [
  "bg-blue-100 text-blue-900",
  "bg-blue-300 text-blue-900",
  "bg-bluesolid/55 text-bluesolidink",
  "bg-bluesolid/80 text-bluesolidink",
  "bg-bluesolid text-bluesolidink",
];

// Persentase inset tiap sisi per tahap: 0% (kotak penuh) → menyempit bertahap.
// Nilai maksimum 18% per sisi supaya tahap terakhir masih cukup lebar untuk
// menampung angka 4 digit tanpa terpotong.
function insetPersen(i, total) {
  if (total <= 1) return [0, 0];
  const maks = 18;
  const atas = (maks * i) / (total - 1);
  const bawah = (maks * (i + 1)) / (total - 1);
  return [atas, Math.min(bawah, maks)];
}

export default function Funnel({ stages = [], className }) {
  const n = stages.length;
  if (n === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {stages.map((s, i) => {
        const [insetAtas, insetBawah] = insetPersen(i, n);
        return (
          <div key={s.key ?? i} className="flex items-stretch gap-3">
            {/* Segmen: selalu selebar kolomnya; yang menyempit adalah bentuknya. */}
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "flex h-12 items-center justify-center text-[17px] font-bold tabular-nums",
                  RAMP[i] || RAMP[RAMP.length - 1]
                )}
                style={{
                  clipPath: `polygon(${insetAtas}% 0, ${100 - insetAtas}% 0, ${100 - insetBawah}% 100%, ${insetBawah}% 100%)`,
                }}
              >
                {typeof s.count === "number" ? s.count.toLocaleString("id-ID") : s.count}
              </div>
            </div>

            {/* Kolom label: lebar TETAP supaya nama tahap tidak pernah terpotong. */}
            <div className="flex w-[132px] shrink-0 flex-col justify-center">
              <p className="text-[13px] font-semibold leading-tight text-ink">{s.label}</p>
              {s.value != null && (
                <p className="t-secondary mt-0.5 text-[11px] tabular-nums">{s.value}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
