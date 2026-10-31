import React from "react";
import { cn } from "@/lib/utils.js";

// ─── IKON MINI DASHBOARD (panel bagian bawah) ────────────────────────────────
// Satu gaya dengan ikon KPI (KpiTile.jsx): bentuk berisi dua warna, sudut lembut, viewBox 24, warna lewat
// --ik-a (bentuk utama) dan --ik-b (detail). Ubin 32px rounded; warna ubin per `tone` (aturan di
// styles/sanss-crm-dashboard.css, hanya di dalam .crm-dash). Biru = aksen utama; oranye/hijau hanya selektif.

export function IkApi(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12.6 2.6c.4 2.6-.8 4-2 5.4-1.3 1.5-2.6 3-2.6 5.2 0 1.2.5 2.2 1.2 2.9-.1-1.6.6-2.7 1.5-3.6.9-.9 1.7-1.9 1.8-3.4 2.4 1.7 4 4.2 4 6.8 0 3.3-2.7 5.7-5.9 5.7S5.700 20.100 5.700 16.700c0-2.100.900-3.700 2.100-5.100 1.300-1.500 2.800-2.900 3.200-5.300.2-1.300 1.200-2.300 1.600-3.700Z" fill="var(--ik-a)" />
      <path d="M12 21.400c-1.900 0-3.300-1.300-3.300-3.100 0-1.500.9-2.300 1.800-3.100.5 1 1.300 1.500 2.100 1.900.8.400 1.600 1.100 1.600 2.300 0 1.100-.9 2-2.200 2Z" fill="var(--ik-b)" />
    </svg>
  );
}

export function IkChat(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 3.500c4.700 0 8.500 3.100 8.500 7.200s-3.800 7.200-8.500 7.200c-.9 0-1.800-.1-2.600-.3L5.200 20c-.5.300-1.100-.1-1-.7l.5-3.100C3.200 14.900 3.500 13 3.500 10.700 3.500 6.600 7.300 3.500 12 3.500Z" fill="var(--ik-a)" />
      <circle cx="8.600" cy="10.800" r="1.200" fill="var(--ik-b)" />
      <circle cx="12" cy="10.800" r="1.200" fill="var(--ik-b)" />
      <circle cx="15.400" cy="10.800" r="1.200" fill="var(--ik-b)" />
    </svg>
  );
}

export function IkNampan(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M4 13.200 6.300 6a2 2 0 0 1 1.900-1.400h7.600A2 2 0 0 1 17.700 6L20 13.200V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4.800Z" fill="var(--ik-a)" />
      <path d="M4 13.200h4.200a1 1 0 0 1 1 .8 2.900 2.900 0 0 0 5.600 0 1 1 0 0 1 1-.8H20V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4.800Z" fill="var(--ik-b)" />
    </svg>
  );
}

export function IkLonceng(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 3.200a5.800 5.800 0 0 0-5.800 5.800v3.200c0 .8-.3 1.500-.8 2.100l-.9 1c-.8.900-.2 2.300 1 2.300h13c1.200 0 1.800-1.400 1-2.300l-.9-1a3.200 3.200 0 0 1-.8-2.100V9A5.800 5.800 0 0 0 12 3.200Z" fill="var(--ik-a)" />
      <path d="M9.700 19.300h4.600a2.300 2.300 0 0 1-4.600 0Z" fill="var(--ik-b)" />
    </svg>
  );
}

export function IkAlur(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="7" cy="6.500" r="2.800" fill="var(--ik-a)" />
      <circle cx="7" cy="17.500" r="2.800" fill="var(--ik-a)" />
      <circle cx="17.500" cy="12" r="2.800" fill="var(--ik-b)" />
      <path d="M7 9.300v5.400M9.400 7.800l5.600 2.800M9.400 16.200l5.600-2.800" fill="none" stroke="var(--ik-b)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IkCentang(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9.200" fill="var(--ik-a)" />
      <path d="M7.800 12.300l2.900 2.900 5.600-5.900" fill="none" stroke="var(--ik-b)" strokeWidth="2.400" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Ubin ikon kecil. `tone`: blue | indigo | green | orange. Ukuran lewat CSS (.crm-ik-tile = 32px, rounded 10px).
export function MiniTile({ tone = "blue", Ikon, className }) {
  return (
    <span className={cn("crm-ik-tile", className)} data-tone={tone}>
      <Ikon width="18" height="18" />
    </span>
  );
}
