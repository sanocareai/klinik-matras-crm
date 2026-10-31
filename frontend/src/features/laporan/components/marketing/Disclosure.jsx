import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";

// Bagian yang dapat dibuka: judul + ringkasan satu baris tetap terlihat; isi (berat) baru dirender saat dibuka.
// `buka` + `onToggle` (opsional) = dikendalikan dari luar (mis. tombol "Lihat rincian" di panel Kelengkapan Data membuka bagian ini); tanpa keduanya perilaku lama.
export default function Disclosure({ id, judul, ringkas, bukaAwal = false, buka: bukaLuar, onToggle, children }) {
  const [bukaLokal, setBukaLokal] = useState(bukaAwal);
  const terkendali = bukaLuar !== undefined;
  const buka = terkendali ? bukaLuar : bukaLokal;
  const toggle = () => (terkendali ? onToggle?.(!buka) : setBukaLokal((v) => !v));
  return (
    <Card className="flex flex-col !p-0" data-testid={`bagian-${id}`} id={`bagian-${id}`}>
      <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" aria-expanded={buka} aria-controls={`isi-${id}`} onClick={toggle}>
        {buka ? <ChevronDown size={16} className="shrink-0 text-ink3" /> : <ChevronRight size={16} className="shrink-0 text-ink3" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">{judul}</span>
          {ringkas && <span className="t-secondary block truncate text-[12px]">{ringkas}</span>}
        </span>
      </button>
      {buka && <div id={`isi-${id}`} className="flex flex-col gap-4 px-4 pb-4">{children}</div>}
    </Card>
  );
}
