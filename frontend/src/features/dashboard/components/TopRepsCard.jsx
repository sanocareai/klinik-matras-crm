import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import SectionCard, { ViewAllLink } from "@/components/ui/section-card.jsx";
import PeriodMenu from "@/components/ui/period-menu.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Avatar from "@/components/Avatar.jsx";
import RankBadge from "@/components/ui/rank-badge.jsx";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";
import { makeRange, toApiParams } from "@/lib/dateRange.js";

// ─── TOP PERFORMING REPS ─────────────────────────────────────────────────────
// SEKARANG SELF-FETCH dengan periode sendiri — sebelumnya menerima `data`
// (selalu bulan berjalan, dari /sales-performance) sebagai prop statis, dan
// tombol periode (FilterPill) tidak melakukan apa pun.
//
// Sumber data DIGANTI ke /analytics/cs-performance (sudah mendukung from/to
// arbitrer). Konsekuensinya: kolom "% target" DIHAPUS — target bulanan adalah
// konsep KALENDER (SalesTarget per year+month), tidak ada artinya untuk
// rentang "7 hari terakhir" atau "Semua waktu". Diganti Closing Rate, yang
// valid untuk periode apa pun dan sudah tersedia di endpoint yang sama.
export default function TopRepsCard() {
  const navigate = useNavigate();
  const [presetId, setPresetId] = useState("this_month");
  const range = useMemo(() => makeRange(presetId), [presetId]);
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
      action={<PeriodMenu value={presetId} onChange={setPresetId} options={REP_PERIODS} />}
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

// "Bulan ini" ditambahkan (bukan cuma 4 preset default PeriodMenu) supaya
// makna "target bulanan" lama masih bisa direplikasi kalau perlu — meski
// kolom % target sendiri sudah dihapus (lihat catatan di atas).
const REP_PERIODS = [
  { id: "this_month",    label: "Bulan ini" },
  { id: "last_7_days",   label: "7 hari terakhir" },
  { id: "last_30_days",  label: "30 hari terakhir" },
  { id: "last_3_months", label: "3 bulan terakhir" },
  { id: "all_time",      label: "Semua waktu" },
];
