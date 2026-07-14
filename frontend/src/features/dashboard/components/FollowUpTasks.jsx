import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatDuration } from "../../../utils/format.js";

// ⏱ Perlu Follow-up — antrean action-oriented: waktu tunggu menonjol (overdue
// merah) + CTA kontekstual ("Ambil & balas" utk unassigned, "Balas" utk yg
// sudah dipegang). Wave 2B: /analytics/follow-ups.
// Defensive: tahan empty response, API failure (error), & field hilang.
export default function FollowUpTasks({ items, loading, error, isMock }) {
  const navigate = useNavigate();
  const list = Array.isArray(items) ? items : [];

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Clock size={15} className="text-brand-600" /> Perlu Follow-up
        </CardTitle>
        {isMock && <Badge variant="ai">Contoh</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 66, borderRadius: 14 }} />)
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Gagal memuat" description="Tidak bisa memuat antrean follow-up. Coba muat ulang." />
        ) : list.length === 0 ? (
          <EmptyState icon={Clock} title="Semua sudah dibalas" description="Tidak ada percakapan yang menunggu balasan." />
        ) : (
          list.map((t) => {
            const overdue = (t.waitingMinutes || 0) >= 60;
            return (
              <div key={t.id} className="rounded-2xl border border-slate-100 p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/30">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-slate-900">{t.customerName}</span>
                  {t.unassigned && <Badge variant="warning">Belum diambil</Badge>}
                  <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-bold tabular-nums ${overdue ? "text-chart-rose" : "text-slate-400"}`}>
                    <Clock size={11} /> {formatDuration(t.waitingMinutes)}
                  </span>
                </div>
                <div className="mt-1 truncate text-[12px] text-slate-500">“{t.preview}”</div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[10.5px] font-medium text-slate-400">{t.sessionLabel}</span>
                  <Button
                    size="sm"
                    variant={t.unassigned ? "default" : "outline"}
                    onClick={() => navigate("/inbox")}
                  >
                    {t.nextAction || "Balas"}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
