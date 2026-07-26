import React from "react";
import { Users, Target, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatRupiah, formatRupiahShort } from "../../../utils/format.js";

const ErrState = () => (
  <EmptyState icon={AlertTriangle} title="Gagal memuat" description="Tidak bisa memuat data performa. Coba muat ulang." />
);

function pctOf(r) {
  return r.percentToTarget ?? (r.target > 0 ? Math.round(((r.totalOrderValue || 0) / r.target) * 100) : 0);
}
// DS v2: progress ke target SELALU accent. Mewarnai merah/oranye tiap kali di
// bawah target membuat dashboard terlihat alarm terus-menerus dan membuat warna
// semantik kehilangan arti. Angka persennya sendiri sudah menyampaikan posisi.
function variantOf() {
  return "accent";
}

// Kesehatan Tim — ROLE-AWARE:
//  • ADMIN/OWNER → daftar seluruh tim (progress per-orang vs target).
//  • SALES → tampilan personal (target saya bulan ini + sisa).
// Wave 2A: data dari sales-performance (nyata); scoping final per-role di Wave 2B.
export default function TeamHealth({ data, loading, error, user }) {
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
            <Target size={15} className="text-ink3" /> Target Saya
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-28 animate-pulse rounded-btn bg-inset" />
          ) : error ? (
            <ErrState />
          ) : !me || !me.target ? (
            <EmptyState icon={Target} title="Target belum diset" description="Minta admin menetapkan target bulanan Anda di Pengaturan." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-end justify-between">
                <span className="t-metric">{pct}%</span>
                <span className="t-secondary pb-1">bulan ini</span>
              </div>
              <ProgressBar value={pct} variant={variantOf()} />
              <div className="flex justify-between text-[13px]">
                <span className="tabular-nums text-ink2">{formatRupiah(me.totalOrderValue || 0)} / {formatRupiah(me.target)}</span>
                <span className="tabular-nums font-medium text-ink">Sisa {formatRupiahShort(remaining)}</span>
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
          <Users size={15} className="text-ink3" /> Kesehatan Tim Sales
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3.5">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="h-11 animate-pulse rounded-btn bg-inset" />)
        ) : error ? (
          <ErrState />
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="Belum ada target" description="Set target bulanan sales di Pengaturan untuk memantau pencapaian tim." />
        ) : (
          rows.map((r) => {
            const pct = pctOf(r);
            return (
              <div key={r.userId} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink">{r.name}</span>
                  <span className="text-right tabular-nums font-semibold text-ink">{pct}%</span>
                </div>
                <ProgressBar value={pct} variant={variantOf()} />
                <div className="flex justify-between text-[11px] tabular-nums text-ink3">
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
