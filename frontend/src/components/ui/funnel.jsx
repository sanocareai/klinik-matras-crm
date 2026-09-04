import React from "react";
import { cn } from "@/lib/utils.js";

// ─── PIPELINE BARS (DS v2.5, D-097, 5 September 2026) ────────────────────────
// REDESAIN dari "Funnel" trapesium (clip-path) yang dipakai sejak DS v2.1.
//
// KENAPA DIGANTI: D-093 sempat mencoba memindahkan kartu ini ke rail sempit
// (col-span-4 dari 12, ~330px) mengikuti bento layout referensi. Owner lihat
// hasilnya langsung: trapesium di lebar sesempit itu kehilangan bentuk
// corongnya TOTAL — clip-path insetnya jadi nyaris tak kelihatan di segmen
// sesempit itu, hasilnya tampil sebagai deretan badge angka polos, bukan lagi
// "corong menyempit" yang jadi inti cerita visual Deal Pipeline (D-096,
// revert). Trapesium horizontal SECARA STRUKTURAL butuh lebar untuk bentuknya
// kelihatan — bukan sesuatu yang bisa "dites lebih hati-hati", itu batasan
// bawaan bentuknya sendiri.
//
// BAR VERTIKAL tidak punya masalah itu: kolom sempit cuma bikin bar makin
// ramping (seperti "Statistics" bar chart di referensi Geex/storage dashboard
// yang didiskusikan) — TIDAK kehilangan makna di lebar berapa pun, sehingga
// kartu ini aman dipindah ke rail sempit lagi di masa depan kalau perlu.
// Cerita "tahap makin ke kanan makin sedikit" sekarang disampaikan lewat
// TINGGI bar (dibanding tahap dengan count TERBESAR), bukan lewat bentuk
// trapesium — argumen yang sama, media yang lebih robust.
//
// WARNA: RAMP SAMA PERSIS dengan versi trapesium (D-092) — satu keluarga
// biru, makin ke kanan makin PEKAT (blue-100 → blue-300 → bluesolid
// 55%→100%), tetap taat "aturan satu accent". Cuma dipakai sebagai FILL bar
// solid, bukan tint segmen.
const RAMP = [
  "bg-blue-100",
  "bg-blue-300",
  "bg-bluesolid/55",
  "bg-bluesolid",
];

// Tinggi bar minimal 6% supaya tahap dengan count 0 tetap tampil sebagai
// garis tipis di dasar (ada, cuma kosong) — bukan hilang total tanpa jejak,
// yang bisa disalahbaca sebagai bar yang belum sempat di-render.
const MIN_HEIGHT_PCT = 6;

export default function Funnel({ stages = [], className }) {
  const n = stages.length;
  if (n === 0) return null;

  const maxCount = Math.max(1, ...stages.map((s) => s.count || 0));

  return (
    <div className={cn("flex items-end gap-3", className)}>
      {stages.map((s, i) => {
        const raw = Math.round(((s.count || 0) / maxCount) * 100);
        const pct = Math.max(MIN_HEIGHT_PCT, raw);
        return (
          <div key={s.key ?? i} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            {/* "dh-figure" (dipakai juga di StatCard, D-091) — glow tipis
                konsisten dengan angka KPI di atasnya, no-op di luar
                .glass-division. */}
            <p className="dh-figure text-[15px] font-bold tabular-nums text-ink">
              {typeof s.count === "number" ? s.count.toLocaleString("id-ID") : s.count}
            </p>
            <div className="flex h-32 w-full items-end overflow-hidden rounded-md bg-inset/40">
              <div
                className={cn("w-full rounded-t-md transition-[height] duration-500 ease-out", RAMP[i] || RAMP[RAMP.length - 1])}
                style={{ height: `${pct}%` }}
              />
            </div>
            <p className="text-center text-[11px] font-semibold leading-tight text-ink">{s.label}</p>
            {s.value != null && (
              <p className="t-secondary text-center text-[10px] leading-tight tabular-nums">{s.value}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
