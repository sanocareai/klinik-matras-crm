import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Helper standar shadcn/ui — gabung className kondisional (clsx) lalu
// resolve konflik utility Tailwind (twMerge), dipakai semua komponen ui/*.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// ── MOTION PRESETS (Sano Design System v1) ─────────────────────────────────
// Satu sumber kebenaran timing animasi untuk komponen framer-motion, selaras
// dengan token --motion-* di styles/tailwind.css (di sini dalam DETIK karena
// framer-motion pakai detik, bukan ms). Filosofi: felt, not seen (<250ms).
// Lihat docs/design-system/sano-animation-guidelines.md.
export const EASE_ENTRANCE = [0.16, 1, 0.3, 1]; // soft ease-out-expo (= --ease-entrance)

export const MOTION = {
  instant:  { duration: 0.11, ease: "easeOut" },
  base:     { duration: 0.18, ease: "easeOut" },
  entrance: { duration: 0.3,  ease: EASE_ENTRANCE },
  spring:   { type: "spring", stiffness: 300, damping: 30 },
};

// Variants standar "fade-rise" untuk kemunculan kartu/section (translate ≤10px).
// Dipakai bareng staggerContainer di parent untuk efek assemble bertahap.
export const fadeRise = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: MOTION.entrance },
};

// Container stagger — anak-anak muncul berurutan ~50ms. Pasang di elemen induk
// grid KPI/section. Stagger HANYA sekali saat mount (jangan re-run tiap poll).
export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
