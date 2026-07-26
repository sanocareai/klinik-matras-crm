import React from "react";
import { useNavigate } from "react-router-dom";
import SectionCard, { FilterPill, ViewAllLink } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Avatar from "@/components/Avatar.jsx";
import RankBadge from "@/components/ui/rank-badge.jsx";
import { formatRupiah } from "@/utils/format.js";

// ─── TOP PERFORMING REPS ─────────────────────────────────────────────────────
// Leaderboard sales. Baris: peringkat → avatar → nama → nilai order → jumlah
// order. Diurutkan dari nilai order TERBESAR, dan hanya 5 teratas — kartu ini
// untuk "siapa yang sedang jalan", bukan daftar lengkap (itu di /laporan).
export default function TopRepsCard({ data = [], loading, error, periodLabel = "Bulan ini" }) {
  const navigate = useNavigate();
  const rows = [...(Array.isArray(data) ? data : [])]
    .sort((a, b) => (b.totalOrderValue || 0) - (a.totalOrderValue || 0))
    .slice(0, 5);

  return (
    <SectionCard
      title="Top Performing Reps"
      action={<FilterPill>{periodLabel}</FilterPill>}
      footer={<ViewAllLink onClick={() => navigate("/laporan")}>Lihat semua sales</ViewAllLink>}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 rounded-btn" />)}
        </div>
      ) : error ? (
        <p className="t-secondary py-8 text-center">Gagal memuat data sales.</p>
      ) : rows.length === 0 ? (
        <p className="t-secondary py-8 text-center">Belum ada data performa sales.</p>
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
              <span className="t-secondary w-16 shrink-0 text-right text-[11px]">
                {r.percentToTarget != null ? `${r.percentToTarget}% target` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
