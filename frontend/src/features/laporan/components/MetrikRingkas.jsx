import React from "react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { useCountUp } from "@/hooks/useCountUp.js";
import { MiniTile } from "@/features/dashboard/components/MiniIkon.jsx";
import { IKON_KPI, PecahAngka } from "./KpiLap.jsx";

// Baris metrik PENDUKUNG (lebih ringkas dari 4 KPI utama): ikon mini, label, angka, catatan satu baris.
// Dipakai di tab Sales (AOV Tim, Chat Spam) dan Marketing (Customer lunas, Biaya iklan, Cakupan pembayaran).
// Tiap item: { label, numericValue | value, format, sub, catatan, kosong, tooltip, ikon, tone, testid }.
// `value` statis dipakai bila angka sudah berupa teks (mis. "—" = data tidak tersedia, bukan nol); `kosong` meredupkan angka;
// `catatan` = peringatan oranye di bawah angka (mis. ledger belum lengkap).
function Item({ label, numericValue, format, value, sub, catatan, kosong = false, tooltip, ikon = "tas", tone = "blue", testid }) {
  const animated = useCountUp(numericValue);
  const tampil = numericValue != null ? (format ? format(animated) : Math.round(animated).toLocaleString("id-ID")) : value;
  return (
    <div className="crm-lap-metrik-item" data-testid={testid}>
      <MiniTile tone={tone} Ikon={IKON_KPI[ikon] || IKON_KPI.tas} />
      <div className="crm-lap-metrik-isi">
        <span className="crm-lap-metrik-label">{label}{tooltip && <InfoTooltip text={tooltip} />}</span>
        <span className="crm-lap-metrik-nilai" data-kosong={kosong ? "1" : undefined}><PecahAngka teks={tampil} /></span>
        {sub && <span className="crm-lap-metrik-sub">{sub}</span>}
        {catatan && <span className="crm-lap-metrik-catatan" data-testid={testid ? `catatan-${testid}` : undefined}>{catatan}</span>}
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
