import React from "react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";

// ─── KPI TILE (Dashboard Sales CRM, redesain 31 Okt 2026) ────────────────────
// Kartu KPI berwarna dengan ubin ikon berisi. SEMUA data (nilai, delta, catatan, tooltip, klik) datang
// dari Dashboard.jsx seperti StatCard sebelumnya — komponen ini hanya tampilan. Warna kartu per `tone`
// (aturan CSS di styles/sanss-crm-dashboard.css, hanya di dalam .crm-dash):
//   revenue = #3965FA teks putih · leads = #99B7FC · orders = #E9EBFF · conversion = #E0FFB7 (teks #1B1B39)
// Pertumbuhan: data-trend="up|down|flat" → hijau / merah / netral, tidak pernah satu warna untuk semua.
//
// Ikon: SVG buatan sendiri (bukan emoji, bukan logo aplikasi). Gaya seragam: bentuk berisi dua warna, sudut
// lembut, viewBox 24, dibaca jelas pada ubin 44px dan tetap tajam di 20px. Warna ikon lewat variabel CSS
// --ik-a (bentuk utama) dan --ik-b (detail) yang diatur per kartu, jadi kontras terjaga di terang maupun gelap.

export function IkonDompet(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5.5 5.5h10.2a2 2 0 0 1 1.9 1.4l.3.9H6.2a1.2 1.2 0 0 1 0-2.4Z" fill="var(--ik-b)" />
      <rect x="3" y="7.6" width="18" height="12.4" rx="3.6" fill="var(--ik-a)" />
      <path d="M21 11.4h-4.1a2.6 2.6 0 0 0 0 5.2H21v-5.2Z" fill="var(--ik-b)" />
      <circle cx="17.2" cy="14" r="1.1" fill="var(--ik-a)" />
    </svg>
  );
}

export function IkonOrang(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="8.6" cy="8.2" r="3.3" fill="var(--ik-a)" />
      <path d="M2.6 19.2c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6c0 .8-.6 1.3-1.4 1.3H4c-.8 0-1.4-.5-1.4-1.3Z" fill="var(--ik-a)" />
      <circle cx="16.6" cy="9" r="2.7" fill="var(--ik-b)" />
      <path d="M15.8 14c.3-.1.6-.1.8-.1 2.8 0 5 1.9 5 4.7 0 .7-.5 1.2-1.2 1.2h-4.1c.3-.4.4-.9.4-1.4 0-1.7-.7-3.3-1.5-4.4Z" fill="var(--ik-b)" />
    </svg>
  );
}

export function IkonTas(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M8.2 8.6V7.4a3.8 3.8 0 0 1 7.6 0v1.2" fill="none" stroke="var(--ik-b)" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.4 8.6h13.2a1.6 1.6 0 0 1 1.6 1.7l-.7 8.4a2.6 2.6 0 0 1-2.6 2.3H7.1a2.6 2.6 0 0 1-2.6-2.3l-.7-8.4a1.6 1.6 0 0 1 1.6-1.7Z" fill="var(--ik-a)" />
      <circle cx="9.1" cy="12.6" r="1.1" fill="var(--ik-b)" />
      <circle cx="14.9" cy="12.6" r="1.1" fill="var(--ik-b)" />
    </svg>
  );
}

export function IkonDiagram(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8H12V3.2Z" fill="var(--ik-a)" />
      <path d="M14.2 2.8v6.9c0 .6.5 1.1 1.1 1.1h6.9a.9.9 0 0 0 .9-1A9 9 0 0 0 15.2 2a1 1 0 0 0-1 .8Z" fill="var(--ik-b)" />
    </svg>
  );
}

const IKON = { revenue: IkonDompet, leads: IkonOrang, orders: IkonTas, conversion: IkonDiagram };

export default function KpiTile({
  tone = "orders", label, value, numericValue, format, delta, deltaSuffix, note, tooltip, onClick, className,
}) {
  const Ikon = IKON[tone] || IkonTas;
  // Hook wajib dipanggil tanpa syarat; hasilnya hanya dipakai bila numericValue + format ada (sama dengan StatCard).
  const animated = useCountUp(numericValue);
  const tampil = (numericValue != null && format) ? format(animated) : value;
  const adaDelta = delta != null && Number.isFinite(delta);
  const trend = !adaDelta ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const teksDelta = adaDelta ? `${delta > 0 ? "+" : ""}${Number(delta).toFixed(1)}%` : null;
  const panah = trend === "up" ? "M7 14l5-5 5 5" : trend === "down" ? "M7 10l5 5 5-5" : "M7 12h10";

  return (
    <div
      data-kpi={tone}
      className={cn("crm-kpi-tile", onClick && "crm-kpi-tile--klik", className)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className="crm-kpi-ikon"><Ikon width="24" height="24" /></span>
      <div className="crm-kpi-isi">
        <span className="crm-kpi-label-baris">
          <p className="crm-kpi-label">{label}</p>
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <p className="crm-kpi-nilai">{tampil}</p>
        {adaDelta && (
          <span className="crm-kpi-delta-baris">
            <span className="crm-kpi-delta" data-trend={trend}>
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d={panah} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {teksDelta}
            </span>
            {deltaSuffix && <span className="crm-kpi-sub">{deltaSuffix}</span>}
          </span>
        )}
        {!adaDelta && deltaSuffix && <span className="crm-kpi-sub">{deltaSuffix}</span>}
        {note && <span className="crm-kpi-sub">{note}</span>}
      </div>
    </div>
  );
}
