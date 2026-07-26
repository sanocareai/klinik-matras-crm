import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import SectionCard from "@/components/ui/section-card.jsx";
import PeriodMenu from "@/components/ui/period-menu.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Funnel from "@/components/ui/funnel.jsx";
import { api } from "@/api.js";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";
import { makeRange, toApiParams } from "@/lib/dateRange.js";

// Urutan tahap yang ditampilkan di corong. LOST sengaja TIDAK masuk: funnel
// menggambarkan alur menuju closing, dan menaruh "Gagal" di ujung bawah akan
// membuat tahap terpekat (paling menonjol) justru kegagalan.
const TAHAP = ["LEAD", "QUALIFIED", "QUOTED", "WON"];

// ─── DEAL PIPELINE ───────────────────────────────────────────────────────────
// SEKARANG SELF-FETCH dengan periode sendiri (PeriodMenu) — sebelumnya
// menerima `funnel` sebagai prop statis dari Dashboard.jsx dan tombol
// periodenya (FilterPill) tidak melakukan apa pun.
//
// SEMANTIK periode di sini: "dari lead yang MASUK pada periode ini, sedang di
// stage apa mereka SEKARANG" (filter by Customer.createdAt, group by stage
// saat ini) — lihat backend/src/routes/analytics.js /pipeline-funnel.
export default function PipelineFunnelCard() {
  const [presetId, setPresetId] = useState("all_time");
  const range = useMemo(() => makeRange(presetId), [presetId]);
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

  const lead = byStage.LEAD?.count ?? 0;
  const won  = byStage.WON?.count ?? 0;
  const konversi = lead > 0 ? Math.round((won / lead) * 100) : null;

  return (
    <SectionCard
      title="Deal Pipeline"
      action={<PeriodMenu value={presetId} onChange={setPresetId} />}
      footer={
        <div className="flex items-center justify-between">
          <span className="t-body">Conversion Rate</span>
          <span className="text-[17px] font-bold tabular-nums text-blue-700">
            {konversi != null ? `${konversi}%` : "—"}
          </span>
        </div>
      }
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-btn" />)}
        </div>
      ) : q.isError ? (
        <p className="t-secondary py-8 text-center">Gagal memuat data pipeline.</p>
      ) : lead === 0 && won === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada data pipeline pada periode ini.</p>
      ) : (
        <Funnel stages={stages} />
      )}
    </SectionCard>
  );
}
