import React, { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { modelSumberPkr, barisSumberPkr } from "@/features/orders/pkrSumberModel.js";

// Badge + dropdown RINGKAS sumber Penjualan Karyawan: "Penjualan Karyawan · Dijual oleh Kemal" → buka: nomor PKR, karyawan penjual, customer, penerima, item/unit, pembayaran.
// Inline (bukan popover absolut) supaya tidak terpotong tabel/kartu dan tidak memenuhi kartu saat tertutup. Tanpa nominal.
export default function SumberPkr({ pkr, className = "", onLengkapi = null }) {
  const m = modelSumberPkr(pkr);
  const [buka, setBuka] = useState(false);
  const idPanel = useId();
  if (!m) return null;
  const Ikon = buka ? ChevronDown : ChevronRight;
  return (
    <div className={`min-w-0 font-sans ${className}`} data-testid="sumber-pkr" onClick={(e) => e.stopPropagation()}>
      <button
        type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} aria-controls={idPanel}
        className="inline-flex max-w-full items-center gap-1 rounded-btn bg-accentbg px-1.5 py-0.5 text-left text-[10.5px] font-semibold text-accent hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        data-testid="sumber-pkr-toggle"
      >
        <Ikon size={11} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 truncate">Penjualan Karyawan · {m.ringkas}</span>
      </button>
      {m.legacy && (
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <Badge variant="orange" data-testid="badge-customer-belum-lengkap">Data customer belum lengkap</Badge>
          {onLengkapi && <button type="button" onClick={onLengkapi} className="text-[10.5px] font-semibold text-accent underline" data-testid="lengkapi-customer">Lengkapi/Tautkan Customer</button>}
        </span>
      )}
      {buka && (
        <dl id={idPanel} className="m-0 mt-1 divide-y divide-line rounded-btn border border-line bg-surface text-[11.5px]" data-testid="sumber-pkr-panel">
          {barisSumberPkr(m).map(([label, nilai]) => (
            <div key={label} className="grid grid-cols-[110px_1fr] gap-2 px-2 py-1">
              <dt className="text-ink3">{label}</dt>
              <dd className="m-0 min-w-0 break-words text-ink">{nilai}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
