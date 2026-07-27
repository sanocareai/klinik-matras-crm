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
// Pipeline); kolom "% target" tetap tidak ada karena target bulanan tidak
// bermakna untuk rentang sembarang — diganti Closing Rate.
//
// BUG YANG DIPERBAIKI (28 Jul 2026): sumber data SEBELUMNYA /analytics/
// cs-performance — `closingRate` di situ = % PERCAKAPAN berstatus RESOLVED,
// metrik operasional CS (chat sudah "beres ditangani"), BUKAN metrik closing
// SALES. Sales bisa saja SUDAH closing order hari ini tapi chat-nya tetap
// terbuka (customer lanjut chat soal pengiriman dll) — tampil "Rp4.740.000,
// 0% closing" yang membingungkan karena dua angka itu kelihatan berkaitan
// padahal dari 2 definisi berbeda total. Sekarang pakai /analytics/
// sales-report (endpoint yang sama dipakai Laporan > Sales Report,
// SalesReportTab.jsx) — `orderConversionRate` di situ = % percakapan yang
// DITANGANI sales ini yang customer-nya benar-benar bikin ORDER, jadi
// sejalan dengan nilai Rupiah di sebelahnya (sama-sama berbasis order).
export default function TopRepsCard({ range }) {
  const navigate = useNavigate();
  const params = useMemo(() => toApiParams(range), [range]);

  const q = useQuery({
    queryKey: ["sales-report", params],
    queryFn: () => api.getSalesReport(params),
    staleTime: 60_000,
  });

  const rows = [...(Array.isArray(q.data?.rows) ? q.data.rows : [])]
    .sort((a, b) => (b.grossValue || 0) - (a.grossValue || 0))
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
                {formatRupiah(r.grossValue || 0)}
              </span>
              <span className="t-secondary w-24 shrink-0 text-right text-[11px] tabular-nums">
                {r.orderConversionRate == null ? "—" : `${r.orderConversionRate}%`} closing
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
