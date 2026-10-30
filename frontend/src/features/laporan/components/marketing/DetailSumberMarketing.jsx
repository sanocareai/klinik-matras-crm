import React, { useCallback, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.js";
import DetailSumberAkuisisi from "../DetailSumberAkuisisi.jsx";
import { LABEL_PELANGGAN } from "../../periodeLaporan.js";
import { jejakMeta } from "../../marketingLogic.js";
import Disclosure from "./Disclosure.jsx";
import MetaDetail from "./MetaDetail.jsx";
import RincianKreatif from "./RincianKreatif.jsx";

// Detail SATU sumber. Jejak: Marketing › Sumber [› Campaign › Ad set]. Meta = campaign → ad set → ad (atribusi terbukti); TikTok dan sumber lain hanya menampilkan data yang BENAR-BENAR ada
// (label CRM + biaya sumber) — tidak ada atribusi campaign dari label atau teks.
export default function DetailSumberMarketing({ s, lap, periode, range, url, onUbah, onKembali, traffic, sourceDetail, rangeParams, cacheMeta, versi }) {
  const [metaLap, setMetaLap] = useState(null);
  const onMuat = useCallback((l) => setMetaLap(l), []);
  const meta = s.id === "META";
  const jalur = { level: url.level, campaign: url.campaign, adset: url.adset };
  const jejak = meta ? jejakMeta(jalur, metaLap?.grup) : [];
  const keLevel = (lv) => onUbah(lv === "campaign" ? { level: "campaign", campaign: null, adset: null } : { level: "adset", adset: null }, { ganti: false });
  const labelKreatif = LABEL_PELANGGAN[s.id] || "";
  return (
    <div className="flex flex-col gap-4" data-testid="detail-marketing">
      <nav aria-label="Jejak" className="flex flex-wrap items-center gap-1 text-[13px]">
        <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={onKembali} data-testid="kembali-ringkasan"><ArrowLeft size={14} /> Marketing</button>
        <ChevronRight size={14} className="text-ink3" />
        {meta && jalur.level !== "campaign"
          ? <button type="button" className="text-accent hover:underline" onClick={() => keLevel("campaign")}>{s.label}</button>
          : <span className="font-semibold text-ink" aria-current={meta && jalur.level === "campaign" ? "page" : undefined}>{s.label}</span>}
        {meta && jalur.level !== "campaign" && jejak.slice(1).map((j, i, arr) => (
          <React.Fragment key={j.level}>
            <ChevronRight size={14} className="text-ink3" />
            {i === arr.length - 1 ? <span className="font-semibold text-ink" aria-current="page">{j.label}</span> : <button type="button" className="text-accent hover:underline" onClick={() => keLevel(j.level)}>{j.label}</button>}
          </React.Fragment>
        ))}
      </nav>

      <DetailSumberAkuisisi s={s} lap={lap} periode={periode} tanpaJejak onBukaIklan={null}
        sisipanAtas={meta ? <MetaDetail range={range} periode={periode} jalur={jalur} rank={url.rank} umur={url.umur} kolom={url.kolom} onUbah={onUbah} cache={cacheMeta} versi={versi} onMuat={onMuat} /> : null} />

      {s.id !== "UNKNOWN" && traffic && (
        <Disclosure id="kreatif" judul="Kreatif & tautan (basis label CRM)" ringkas="Lead per kreatif/link dan nilai per lead — analisis legacy; bukan atribusi campaign">
          <RincianKreatif traffic={traffic} sourceDetail={sourceDetail} rangeParams={rangeParams} sumberLabelAwal={labelKreatif} />
        </Disclosure>
      )}
    </div>
  );
}
