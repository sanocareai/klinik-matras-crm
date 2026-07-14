import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatDuration } from "../../../utils/format.js";

// ⏱ Perlu Follow-up — antrean percakapan yang menunggu balasan (pesan terakhir
// dari customer). Wave 2A: data contoh (mock). Wave 2B: /analytics/follow-ups.
export default function FollowUpTasks({ items = [], loading, isMock }) {
  const navigate = useNavigate();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Clock size={15} className="text-brand-600" /> Perlu Follow-up
        </CardTitle>
        {isMock && <Badge variant="ai">Contoh</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10 }} />)
        ) : items.length === 0 ? (
          <EmptyState icon={Clock} title="Semua sudah dibalas" description="Tidak ada percakapan yang menunggu balasan." />
        ) : (
          items.map((t) => {
            const overdue = t.waitingMinutes >= 60;
            return (
              <button
                key={t.id}
                onClick={() => navigate("/inbox")}
                className="group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-slate-900">{t.customerName}</span>
                    {t.unassigned && <Badge variant="warning">Belum diambil</Badge>}
                  </div>
                  <div className="truncate text-[12px] text-slate-500">{t.preview}</div>
                </div>
                <Badge variant={overdue ? "danger" : "neutral"}>{formatDuration(t.waitingMinutes)}</Badge>
                <ArrowRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-brand-600" />
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
