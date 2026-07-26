import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import SectionCard from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Funnel from "@/components/ui/funnel.jsx";
import { api } from "@/api.js";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";
import { toApiParams } from "@/lib/dateRange.js";

// Revisi 26 Jul 2026: pipeline 8-stage (LOST dihapus dari sistem, jadi tidak
// ada lagi stage negatif yang perlu disembunyikan dari corong) — seluruh
// tahap NEW→REVIEWED ditampilkan supaya corong mencerminkan exit-criteria
// nyata di tiap tahap operasional.
const TAHAP = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "PAID", "REVIEWED"];

// ─── DEAL PIPELINE ───────────────────────────────────────────────────────────
// DS v2.4: periode SENDIRI (PeriodMenu) DIHAPUS — sekarang mengikuti SATU
// date picker di header Dashboard lewat prop `range`, sama seperti Sales
// Overview & Top Performing Reps. Sebelumnya tiap kartu punya pemilih periode
// masing-masing yang independen — pilih tanggal di satu kartu tidak
// mengubah kartu lain, padahal semuanya menampilkan data yang "sama-sama
// tentang periode ini" di mata pengguna.
export default function PipelineFunnelCard({ range }) {
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

  const lead = byStage.NEW?.count ?? 0;
  const won  = byStage.PAID?.count ?? 0;
  const konversi = lead > 0 ? Math.round((won / lead) * 100) : null;

  return (
    <SectionCard
      title="Deal Pipeline"
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
