import React from "react";
import SectionCard, { FilterPill } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Funnel from "@/components/ui/funnel.jsx";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";

// Urutan tahap yang ditampilkan di corong. LOST sengaja TIDAK masuk: funnel
// menggambarkan alur menuju closing, dan menaruh "Gagal" di ujung bawah akan
// membuat tahap terpekat (paling menonjol) justru kegagalan.
const TAHAP = ["LEAD", "QUALIFIED", "QUOTED", "WON"];

// ─── DEAL PIPELINE ───────────────────────────────────────────────────────────
// Corong + footer "Tingkat Konversi". Konversi dihitung WON / LEAD — rasio yang
// paling sering ditanyakan, dan satu-satunya angka di kartu ini yang layak
// ditonjolkan, jadi ditaruh di footer dengan warna accent.
export default function PipelineFunnelCard({ funnel = [], loading, periodLabel = "Bulan ini" }) {
  const byStage = Object.fromEntries((funnel || []).map((f) => [f.stage, f]));
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
      action={<FilterPill>{periodLabel}</FilterPill>}
      footer={
        <div className="flex items-center justify-between">
          <span className="t-body">Conversion Rate</span>
          <span className="text-[17px] font-bold tabular-nums text-blue-700">
            {konversi != null ? `${konversi}%` : "—"}
          </span>
        </div>
      }
    >
      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 rounded-btn" />)}
        </div>
      ) : lead === 0 && won === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada data pipeline.</p>
      ) : (
        <Funnel stages={stages} />
      )}
    </SectionCard>
  );
}
