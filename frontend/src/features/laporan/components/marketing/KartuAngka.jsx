import React from "react";
import { Card } from "@/components/ui/card.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";

// Kartu angka ringkas Marketing: judul kecil, angka, satu baris keterangan. Kosong (null) tampil "—" redup dengan alasan di keterangan, bukan 0.
export default function KartuAngka({ id, judul, nilai, sub, tip, kosong = false, peringatan = false }) {
  return (
    <Card className="flex min-w-0 flex-col gap-0.5 !p-3.5" data-testid={`kartu-${id}`}>
      <span className="t-secondary inline-flex items-center gap-1 text-[12px]">{judul}{tip && <InfoTooltip text={tip} />}</span>
      <span className={cn("whitespace-nowrap text-[20px] font-semibold leading-tight tabular-nums sm:text-[22px]", kosong ? "text-ink3" : peringatan ? "text-orange" : "text-ink")}>{nilai}</span>
      {sub && <span className="t-secondary text-[11.5px] leading-snug">{sub}</span>}
    </Card>
  );
}
