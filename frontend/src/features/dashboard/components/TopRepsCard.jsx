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

// "Top Performing Reps" — urutan (nilai penjualan kotor, 5 teratas), sumber (sales-report), dan tujuan "Lihat semua sales" tidak berubah.
// Tampilan (redesain 31 Okt 2026): baris grid — peringkat · avatar+nama · nilai penjualan · closing; angka rata kanan + tabular agar mudah dibandingkan.
// HP: baris kedua (di bawah nama) memuat nilai dan closing.
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
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 rounded-btn" />)}
        </div>
      ) : q.isError ? (
        <p className="crm-kosong">Gagal memuat data sales.</p>
      ) : rows.length === 0 ? (
        <p className="crm-kosong" data-testid="top-reps-kosong">Belum ada data performa sales pada periode ini.</p>
      ) : (
        <div className="crm-reps" data-testid="top-reps-daftar">
          <div className="crm-rep crm-rep--kepala" aria-hidden="true">
            <span className="crm-rep-rank" /><span className="crm-rep-nama">Sales</span>
            <span className="crm-rep-nilai">Penjualan</span><span className="crm-rep-closing">Closing</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.userId} className="crm-rep">
              <span className="crm-rep-rank"><RankBadge rank={i + 1} /></span>
              <span className="crm-rep-nama">
                <Avatar name={r.name} src={r.avatarUrl} size="sm" />
                <span className="crm-rep-teks">{r.name}</span>
              </span>
              <span className="crm-rep-nilai">{formatRupiah(r.grossValue || 0)}</span>
              <span className="crm-rep-closing">{r.conversionRate == null ? "—" : `${r.conversionRate}%`}<span className="crm-rep-satuan"> closing</span></span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
