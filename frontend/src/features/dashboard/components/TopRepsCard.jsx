import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Avatar from "@/components/Avatar.jsx";
import RankBadge from "@/components/ui/rank-badge.jsx";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";
import { toApiParams } from "@/lib/dateRange.js";

// ─── TOP PERFORMING REPS ─────────────────────────────────────────────────────
// DS v2.4: periode SENDIRI (PeriodMenu) DIHAPUS — mengikuti SATU date picker
// di header Dashboard lewat prop `range` (sama seperti Sales Overview & Deal
// Pipeline). Sumber data tetap /analytics/cs-performance (mendukung from/to
// arbitrer, termasuk "Semua waktu"); kolom "% target" tetap tidak ada karena
// target bulanan tidak bermakna untuk rentang sembarang — diganti Closing Rate.
export default function TopRepsCard({ range }) {
  const navigate = useNavigate();
  const params = useMemo(() => toApiParams(range), [range]);

  const q = useQuery({
    queryKey: ["cs-performance", params],
    queryFn: () => api.getAnalyticsCsPerformance(params),
    staleTime: 60_000,
  });

  const rows = [...(Array.isArray(q.data) ? q.data : [])]
    .sort((a, b) => (b.totalOrderValue || 0) - (a.totalOrderValue || 0))
    .slice(0, 5);

  return (
    <SectionCard
      title="Top Performing Reps"
      footer={<ViewAllLink onClick={() => navigate("/laporan")}>Lihat semua sales</ViewAllLink>}
    >
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 rounded-btn" />)}
        </div>
      ) : q.isError ? (
        <p className="t-secondary py-8 text-center">Gagal memuat data sales.</p>
      ) : rows.length === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada data performa sales pada periode ini.</p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r, i) => (
            <div key={r.userId} className="flex items-center gap-2.5 py-2.5">
              <RankBadge rank={i + 1} />
              <Avatar name={r.name} src={r.avatarUrl} size="sm" />
              <span className="t-body min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-ink">
                {formatRupiah(r.totalOrderValue || 0)}
              </span>
              <span className="t-secondary w-20 shrink-0 text-right text-[11px] tabular-nums">
                {r.closingRate}% closing
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
