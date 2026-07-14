import React from "react";
import { Users, Target } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatRupiah, formatRupiahShort } from "../../../utils/format.js";

function pctOf(r) {
  return r.percentToTarget ?? (r.target > 0 ? Math.round(((r.totalOrderValue || 0) / r.target) * 100) : 0);
}
function variantOf(pct) {
  return pct >= 100 ? "success" : pct >= 60 ? "brand" : pct >= 30 ? "warning" : "danger";
}

// Kesehatan Tim — ROLE-AWARE:
//  • ADMIN/OWNER → daftar seluruh tim (progress per-orang vs target).
//  • SALES → tampilan personal (target saya bulan ini + sisa).
// Wave 2A: data dari sales-performance (nyata); scoping final per-role di Wave 2B.
export default function TeamHealth({ data = [], loading, user }) {
  const rows = Array.isArray(data) ? data : [];
  const isSales = user?.role === "SALES";

  // ── Tampilan personal (SALES) ──
  if (isSales) {
    const me = rows.find((r) => r.userId === user?.id) || rows[0] || null;
    const pct = me ? pctOf(me) : 0;
    const remaining = me ? Math.max(0, (me.target || 0) - (me.totalOrderValue || 0)) : 0;
    return (
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Target size={15} className="text-brand-600" /> Target Saya
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ) : !me || !me.target ? (
            <EmptyState icon={Target} title="Target belum diset" description="Minta admin menetapkan target bulanan Anda di Pengaturan." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-end justify-between">
                <span className="text-[34px] font-bold leading-none tabular-nums text-slate-900">{pct}%</span>
                <span className="pb-1 text-[12px] text-slate-400">bulan ini</span>
              </div>
              <ProgressBar value={pct} variant={variantOf(pct)} />
              <div className="flex justify-between text-[12px]">
                <span className="tabular-nums text-slate-500">{formatRupiah(me.totalOrderValue || 0)} / {formatRupiah(me.target)}</span>
                <span className="tabular-nums font-semibold text-slate-700">Sisa {formatRupiahShort(remaining)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Tampilan tim (ADMIN/OWNER) ──
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
          <EmptyState icon={Users} title="Belum ada target" description="Set target bulanan sales di Pengaturan untuk memantau pencapaian tim." />
        ) : (
          rows.map((r) => {
            const pct = pctOf(r);
            return (
              <div key={r.userId} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-slate-700">{r.name}</span>
                  <span className="tabular-nums font-semibold text-slate-900">{pct}%</span>
                </div>
                <ProgressBar value={pct} variant={variantOf(pct)} />
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
