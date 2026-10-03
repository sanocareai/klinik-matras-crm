import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { STAGE_LOG_STATUS } from "@/features/bengkel/unitStatus.js";
import UnitV1Actions from "./UnitV1Actions.jsx";
import { V2_SECTIONS_UNAVAILABLE, dash, unitFacts } from "./unitOrderFallbackModel.js";

// P12B.4 — isi drawer Unit 360 untuk unit yang BELUM masuk Production V2 (Unit 360 = 404; cohort tidak diperluas). Membaca data order/unit ASLI
// (GET /units/:id/timeline, baca-saja) di drawer yang sama — tanpa halaman Unit terpisah, tanpa tab baru. Bagian V2 yang belum ada dijelaskan apa adanya.
export default function UnitOrderFallback({ data, error, loading, roles = [], onData, onChanged }) {
  if (loading) return <div data-testid="unit-fallback-loading" className="space-y-2"><div className="h-6 w-2/3 animate-pulse rounded bg-inset" /><div className="h-24 animate-pulse rounded bg-inset" /></div>;
  if (error) return <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>;
  if (!data) return null;
  const path = data.path || [];
  return (
    <div className="space-y-3 pb-4" data-testid="unit-order-fallback">
      <div className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="unit-v2-notice">
        <p className="m-0 font-semibold">Unit ini belum memakai alur Production V2.</p>
        <p className="m-0 mt-0.5">Berikut data order dan unit aslinya (baca-saja). Bagian berikut akan tersedia setelah unit masuk Production V2:</p>
        <ul className="m-0 mt-1 list-disc pl-5">{V2_SECTIONS_UNAVAILABLE.map(([k, d]) => <li key={k}><b>{k}</b> — {d}</li>)}</ul>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-2 text-[12.5px]">
        {unitFacts(data).map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">{k}</dt><dd className="m-0 break-words font-semibold text-ink">{dash(v)}</dd></div>
        ))}
      </dl>
      <UnitV1Actions data={data} roles={roles} onData={onData} onChanged={onChanged} />
      {data.productionStatusReason && <p className="m-0 text-[12px] text-ink3">{data.productionStatusReason}</p>}
      <section data-testid="unit-fallback-path">
        <h3 className="m-0 mb-1 text-[13px] font-bold text-ink">Jalur tahap produksi (V1)</h3>
        {path.length === 0 ? <p className="m-0 text-[12.5px] text-ink3">Layanan belum ditetapkan — jalur tahap belum tersusun.</p> : (
          <ol className="m-0 list-none space-y-1 p-0">
            {path.map((p, i) => (
              <li key={p.stage.id} className="flex items-center gap-2 rounded-btn bg-inset px-3 py-1.5 text-[12.5px]">
                <span className="w-5 shrink-0 text-ink3">{i + 1}</span>
                <span className={`min-w-0 flex-1 truncate ${p.isCurrent ? "font-bold text-ink" : "text-ink2"}`}>{p.stage.labelId}</span>
                <Badge variant={STAGE_LOG_STATUS[p.status]?.tone || "neutral"}>{STAGE_LOG_STATUS[p.status]?.label || p.status}</Badge>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
