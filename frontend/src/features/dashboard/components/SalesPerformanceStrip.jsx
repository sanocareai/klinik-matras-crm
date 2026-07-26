import React from "react";
import { Card } from "@/components/ui/card.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { formatRupiah } from "../../../utils/format.js";

// Strip tipis "Performa Tim" — pencapaian target tim bulan ini (agregat dari
// sales-performance). Detail per-orang ada di widget Team Health (Band 2).
export default function SalesPerformanceStrip({ data, loading, error }) {
  const rows = Array.isArray(data) ? data : [];
  const totalTarget = rows.reduce((s, r) => s + (r?.target || 0), 0);
  const totalAchieved = rows.reduce((s, r) => s + (r?.totalOrderValue || r?.achieved || 0), 0);
  const pct = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : null;
  const variant = pct == null ? "brand" : pct >= 100 ? "success" : pct >= 60 ? "brand" : "warning";

  if (loading) return <div className="skeleton skeleton-card" style={{ height: 64, marginBottom: 0 }} />;
  // API failure → strip tetap render tapi netral (tidak crash / tidak angka palsu).
  if (error) return (
    <Card className="flex items-center gap-2 p-4 text-[13px] text-ink3">
      <span className="text-sm font-semibold text-ink2">Performa Tim</span> · gagal memuat data
    </Card>
  );

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex items-baseline gap-2 sm:w-52 sm:shrink-0">
        <span className="text-sm font-semibold text-ink">Performa Tim</span>
        <span className="text-[12px] text-ink3">bulan ini</span>
      </div>
      <div className="min-w-0 flex-1">
        <ProgressBar value={pct || 0} variant={variant} />
      </div>
      <div className="flex items-center gap-4 text-[12px] sm:shrink-0">
        <span className="tabular-nums text-[15px] font-bold text-ink">{pct != null ? `${pct}%` : "—"}</span>
        <span className="tabular-nums text-ink2">
          {pct != null ? `${formatRupiah(totalAchieved)} / ${formatRupiah(totalTarget)}` : "Target belum diset"}
        </span>
      </div>
    </Card>
  );
}
