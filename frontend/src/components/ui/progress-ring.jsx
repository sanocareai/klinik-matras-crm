import React from "react";
import { cn } from "@/lib/utils.js";

// ─── PROGRESS RING (D-112) ────────────────────────────────────────────────
// Owner kirim referensi (NexusBank "Available", LearnZimTPS "Daily Goal") —
// progres bulat dengan angka besar di tengah, dipakai untuk gantikan/
// melengkapi progress bar LINEAR di "Target Bulanan Tim" (Laporan >
// Ringkasan). SVG murni (stroke-dasharray/-dashoffset), bukan library baru.
//
// `color` diterima sebagai nilai CSS (var(--green) dkk), BUKAN className
// Tailwind — dipakai langsung sebagai inline `stroke` supaya pemanggil bisa
// tetap memegang logika warna SEMANTIK yang sudah ada (mis. hijau=tercapai,
// oranye=tertinggal) tanpa harus percaya utility `stroke-*` Tailwind
// ter-generate untuk token kustom (belum pernah diverifikasi dipakai di
// project ini, byte-exact check dulu sebelum asumsi — pelajaran CLAUDE.md
// §3 soal utility warna kustom yang kadang tidak ter-generate).
export default function ProgressRing({
  percent, size = 96, strokeWidth = 10, color = "var(--accent)",
  trackColor = "var(--hairline)", children, className,
}) {
  const clamped = Math.min(Math.max(percent ?? 0, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} stroke={trackColor} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms ease-out" }}
        />
      </svg>
      {/* Konten tengah (angka besar dkk) — absolute di atas SVG, TIDAK ikut
          rotate -90deg SVG di atasnya (elemen terpisah, bukan child svg). */}
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
