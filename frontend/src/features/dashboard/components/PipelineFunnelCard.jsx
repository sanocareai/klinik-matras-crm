import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import SectionCard from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Funnel from "@/components/ui/funnel.jsx";
import { api } from "@/api.js";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";
import { toApiParams } from "@/lib/dateRange.js";
import { MiniTile, IkAlur, IkCentang } from "./MiniIkon.jsx";
import { IkonOrang, IkonTas } from "./KpiTile.jsx";

// Urutan tahap & sumber data (analytics/pipeline-funnel) tidak berubah.
const TAHAP = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED"];
// Ikon per tahap (hanya mode ringkas; tampilan, bukan data).
const IKON_TAHAP = { NEW: { Ikon: IkonOrang, tone: "blue" }, PROSPECT: { Ikon: IkAlur, tone: "indigo" }, TRANSACTION: { Ikon: IkonTas, tone: "blue" }, REVIEWED: { Ikon: IkCentang, tone: "green" } };

// `ringkas` (OPSIONAL, default false — PipelineWidget memakai kartu ini dan TIDAK berubah): bar horizontal per tahap —
// nama tahap, jumlah lead, nilai; panjang bar = jumlah lead ÷ jumlah terbesar × 100% (tanpa batas minimum); jumlah 0 → tanpa isian.
export default function PipelineFunnelCard({ range, className, ringkas = false }) {
  const params = useMemo(() => toApiParams(range), [range]);

  const q = useQuery({
    queryKey: ["pipeline-funnel", params],
    queryFn: () => api.getAnalyticsPipelineFunnel(params),
    staleTime: 60_000,
  });

  const funnel = q.data || [];
  const byStage = Object.fromEntries(funnel.map((f) => [f.stage, f]));
  const stages = TAHAP.map((s) => ({
    key: s,
    count: byStage[s]?.count ?? 0,
    label: STAGE_LABELS[s] || s,
    value: formatRupiah(byStage[s]?.value ?? 0),
  }));

  const adaData = stages.some((s) => s.count > 0);
  const maks = Math.max(1, ...stages.map((s) => s.count));

  return (
    <SectionCard title="Deal Pipeline" className={className}>
      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-btn" />)}
        </div>
      ) : q.isError ? (
        <p className={ringkas ? "crm-kosong" : "t-secondary py-8 text-center"}>Gagal memuat data pipeline.</p>
      ) : !adaData ? (
        <p className={ringkas ? "crm-kosong" : "t-secondary py-8 text-center"}>Belum ada data pipeline pada periode ini.</p>
      ) : ringkas ? (
        <ul className="crm-pipe" data-testid="pipeline-bar">
          {stages.map((s) => (
            <li key={s.key} className="crm-pipe-baris" data-stage={s.key}>
              <MiniTile className="crm-pipe-ikon" tone={IKON_TAHAP[s.key].tone} Ikon={IKON_TAHAP[s.key].Ikon} />
              <span className="crm-pipe-nama">{s.label}</span>
              <span className="crm-pipe-jumlah">{s.count}</span>
              <span className="crm-pipe-nilai">{s.value}</span>
              <span className="crm-pipe-jalur" role="presentation">
                {s.count > 0 && <span className="crm-pipe-isi" style={{ width: `${(s.count / maks) * 100}%` }} />}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Funnel stages={stages} />
      )}
    </SectionCard>
  );
}
