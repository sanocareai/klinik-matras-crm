import React from "react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { useCountUp } from "@/hooks/useCountUp.js";
import { MiniTile } from "@/features/dashboard/components/MiniIkon.jsx";
import { IKON_KPI, PecahAngka } from "./KpiLap.jsx";

// Baris metrik PENDUKUNG (lebih ringkas dari 4 KPI utama): ikon mini, label, angka, catatan satu baris.
// Dipakai di tab Sales (AOV Tim, Chat Spam). Tiap item: { label, numericValue, format, sub, tooltip, ikon, tone }.
function Item({ label, numericValue, format, value, sub, tooltip, ikon = "tas", tone = "blue" }) {
  const animated = useCountUp(numericValue);
  const tampil = numericValue != null ? (format ? format(animated) : Math.round(animated).toLocaleString("id-ID")) : value;
  return (
    <div className="crm-lap-metrik-item">
      <MiniTile tone={tone} Ikon={IKON_KPI[ikon] || IKON_KPI.tas} />
      <div className="crm-lap-metrik-isi">
        <span className="crm-lap-metrik-label">{label}{tooltip && <InfoTooltip text={tooltip} />}</span>
        <span className="crm-lap-metrik-nilai"><PecahAngka teks={tampil} /></span>
        {sub && <span className="crm-lap-metrik-sub">{sub}</span>}
      </div>
    </div>
  );
}

export default function MetrikRingkas({ items }) {
  return (
    <div className="crm-lap-metrik">
      {items.map((it) => <Item key={it.label} {...it} />)}
    </div>
  );
}
