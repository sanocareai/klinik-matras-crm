import React from "react";
import { cn } from "@/lib/utils.js";

// ─── FUNNEL (DS v2.1) ────────────────────────────────────────────────────────
// Funnel trapesium: tiap tahap menyempit, angka besar di dalam segmen, label +
// nilai di kanan. Bentuknya dibuat dengan clip-path (bukan SVG) supaya teks di
// dalamnya tetap teks HTML biasa — bisa dipilih, di-scale, dan dibaca screen
// reader tanpa trik tambahan.
//
// WARNA — referensi memakai 4 hue berbeda (biru/ungu/oranye/hijau). Di sini
// SATU keluarga biru, yang berbeda kedalamannya: makin ke bawah makin PEKAT.
// Alasannya bukan cuma keseragaman: tahap paling bawah (Berhasil) adalah yang
// paling bernilai, jadi warna terpekat mendarat di tempat yang paling penting.
// Gradasi terang→gelap juga otomatis membaca sebagai "menyaring/mengerucut".
// Dua tahap pertama pakai tint (teks biru gelap di atasnya), tahap yang makin
// dalam pakai ISIAN PADAT + teks putih. Isian padat memakai token khusus yang
// tetap pekat di mode gelap — kalau memakai blue-600/700 langsung, di dark
// mode nilainya justru menerang dan teks putihnya gagal kontras.
const RAMP = [
  "bg-blue-200 text-blue-900",
  "bg-blue-300 text-blue-900",
  "bg-bluesolid/80 text-bluesolidink",
  "bg-bluesolid text-bluesolidink",
  "bg-bluesolid text-bluesolidink",
];

// Lebar tiap segmen menyempit bertahap (100% → 60%). Dihitung, bukan dihardcode,
// supaya funnel dengan 3/4/5 tahap tetap proporsional.
function lebarSegmen(i, total) {
  if (total <= 1) return 100;
  const min = 60;
  return 100 - ((100 - min) * i) / (total - 1);
}

export default function Funnel({ stages = [], className }) {
  const n = stages.length;
  if (n === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {stages.map((s, i) => {
        const w = lebarSegmen(i, n);
        const wNext = lebarSegmen(i + 1, n);
        // Sisi kiri-kanan miring mengikuti selisih lebar segmen berikutnya —
        // itu yang membuat tumpukan terlihat menyatu jadi satu corong.
        const inset = n > 1 ? Math.max(0, (w - wNext) / 2 / w * 100) : 0;

        return (
          <div key={s.key ?? i} className="flex items-center gap-3">
            <div className="relative shrink-0" style={{ width: `${w}%`, minWidth: 96 }}>
              <div
                className={cn(
                  "flex h-11 items-center justify-center text-[17px] font-bold tabular-nums",
                  RAMP[i] || RAMP[RAMP.length - 1]
                )}
                style={{
                  clipPath: `polygon(0 0, 100% 0, ${100 - inset}% 100%, ${inset}% 100%)`,
                }}
              >
                {s.count}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="t-body truncate font-medium leading-tight">{s.label}</p>
              {s.value != null && <p className="t-secondary truncate">{s.value}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
