import React from "react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { IkonDompet, IkonOrang, IkonTas, IkonDiagram } from "@/features/dashboard/components/KpiTile.jsx";
import { IkCentang, IkAlur, IkApi, IkChat } from "@/features/dashboard/components/MiniIkon.jsx";

// ─── KPI LAPORAN (Sales CRM, redesain 31 Okt 2026) ───────────────────────────
// Kartu KPI berwarna untuk Laporan Analitik: tampilan SAMA dengan KpiTile Dashboard (kelas .crm-kpi-* dari
// styles/sanss-crm-dashboard.css, aktif di dalam .crm-dash), tetapi datanya mengikuti KpiCard lama —
// angka animasi, badge pertumbuhan `+12.3%` apa adanya (tanpa pembulatan baru), `compareLabel`, `sub`, tooltip.
// KpiCard & KpiTile TIDAK diubah (dipakai Armada/Gudang/Dashboard). Warna per `tone`:
//   revenue = #3965FA · leads = #99B7FC · orders = #E9EBFF · conversion = #E0FFB7
// `ikon` (opsional) mengganti ikon bawaan tone dengan ikon SVG yang sudah ada.

export const IKON_KPI = {
  dompet: IkonDompet, orang: IkonOrang, tas: IkonTas, diagram: IkonDiagram,
  centang: IkCentang, alur: IkAlur, api: IkApi, chat: IkChat,
};
const IKON_TONE = { revenue: IkonDompet, leads: IkonOrang, orders: IkonTas, conversion: IkonDiagram };

// Angka Rupiah panjang TIDAK dikecilkan sampai sulit dibaca: kalau tidak muat, baris dipecah di titik pemisah ribuan
// (<wbr> setelah tiap ".") dan CSS `text-wrap: balance` menyeimbangkan dua baris ("Rp25.482." / "000.000"), bukan menyisakan
// "0" yatim. Nilai penuh tetap utuh di DOM (bisa disalin / dibaca pembaca layar); <wbr> tidak ikut tersalin.
export function PecahAngka({ teks }) {
  const bagian = String(teks ?? "").split(".");
  return bagian.map((b, i) => (i < bagian.length - 1
    ? <React.Fragment key={i}>{b}.<wbr /></React.Fragment>
    : <React.Fragment key={i}>{b}</React.Fragment>));
}

export default function KpiLap({
  tone = "orders", ikon, label, numericValue, format, value, growth, compareLabel, sub, tooltip, onClick, className, testid,
}) {
  const Ikon = IKON_KPI[ikon] || IKON_TONE[tone] || IkonTas;
  // Hook wajib tanpa syarat. Bila numericValue tidak ada, `value` statis yang tampil (mis. "—").
  const animated = useCountUp(numericValue);
  const tampil = numericValue != null
    ? (format ? format(animated) : Math.round(animated).toLocaleString("id-ID"))
    : value;
  const adaGrowth = growth !== undefined && growth !== null;
  const trend = growth > 0 ? "up" : growth < 0 ? "down" : "flat";
  const panah = trend === "up" ? "M7 14l5-5 5 5" : trend === "down" ? "M7 10l5 5 5-5" : "M7 12h10";

  return (
    <div
      data-kpi={tone}
      data-testid={testid}
      data-len={String(tampil ?? "").length > 13 ? "l" : undefined}
      className={cn("crm-kpi-tile crm-lap-kpi", onClick && "crm-kpi-tile--klik", className)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className="crm-kpi-ikon"><Ikon width="24" height="24" className={ikon ? `ik-${ikon}` : undefined} /></span>
      <div className="crm-kpi-isi">
        <span className="crm-kpi-label-baris">
          <p className="crm-kpi-label">{label}</p>
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        <p className="crm-kpi-nilai"><PecahAngka teks={tampil} /></p>
        {adaGrowth && (
          <span className="crm-kpi-delta-baris">
            <span className="crm-kpi-delta" data-trend={trend}>
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d={panah} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {`${growth > 0 ? "+" : ""}${growth}%`}
            </span>
            {compareLabel && <span className="crm-kpi-sub">{compareLabel}</span>}
          </span>
        )}
        {sub && <span className="crm-kpi-sub">{sub}</span>}
      </div>
    </div>
  );
}
