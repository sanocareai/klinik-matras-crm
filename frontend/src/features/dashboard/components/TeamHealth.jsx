import React from "react";
import { Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatRupiahShort } from "../../../utils/format.js";

// Kesehatan Tim Sales — progress per-orang vs target bulanan (dari
// sales-performance). Menggantikan tabel polos lama dengan milestone bar.
export default function TeamHealth({ data = [], loading }) {
  const rows = Array.isArray(data) ? data : [];

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Users size={15} className="text-brand-600" /> Kesehatan Tim Sales
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 10 }} />)
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Belum ada target"
            description="Set target bulanan sales di Pengaturan untuk memantau pencapaian tim."
          />
        ) : (
          rows.map((r) => {
            const pct = r.percentToTarget ?? (r.target > 0 ? Math.round(((r.totalOrderValue || 0) / r.target) * 100) : 0);
            const variant = pct >= 100 ? "success" : pct >= 60 ? "brand" : pct >= 30 ? "warning" : "danger";
            return (
              <div key={r.userId} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-slate-700">{r.name}</span>
                  <span className="tabular-nums font-semibold text-slate-900">{pct}%</span>
                </div>
                <ProgressBar value={pct} variant={variant} />
                <div className="flex justify-between text-[11px] tabular-nums text-slate-400">
                  <span>{formatRupiahShort(r.totalOrderValue || 0)}</span>
                  <span>target {formatRupiahShort(r.target || 0)}</span>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
