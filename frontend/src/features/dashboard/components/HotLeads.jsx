import React from "react";
import { useNavigate } from "react-router-dom";
import { Flame, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { STAGE_LABELS, stageVariant, formatRupiahShort } from "../../../utils/format.js";

// Cincin skor 0–100 (EXPLAINABLE — alasan tampil di baris). Warna = urgensi.
function ScoreRing({ score }) {
  const color = score >= 85 ? "#dc2626" : score >= 70 ? "#f59e0b" : "#2064b7";
  const dash = (score / 100) * 94.2;
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#eef2f7" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${dash} 94.2`} strokeLinecap="round" />
      </svg>
      <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{score}</span>
    </span>
  );
}

// 🔥 Lead Panas — worklist terurut by skor (recency + stage + value + sinyal).
// Wave 2A: data contoh (mock). Wave 2B: /analytics/hot-leads.
export default function HotLeads({ items = [], loading, isMock }) {
  const navigate = useNavigate();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Flame size={15} className="text-chart-orange" /> Lead Panas
        </CardTitle>
        {isMock && <Badge variant="ai">Contoh</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10 }} />)
        ) : items.length === 0 ? (
          <EmptyState icon={Flame} title="Belum ada lead panas" description="Lead dengan sinyal beli akan muncul di sini." />
        ) : (
          items.map((l) => (
            <button
              key={l.id}
              onClick={() => navigate("/customers")}
              className="group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-slate-50"
            >
              <ScoreRing score={l.score} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-slate-900">{l.name}</span>
                  <Badge variant={stageVariant(l.stage)}>{STAGE_LABELS[l.stage] || l.stage}</Badge>
                </div>
                <div className="truncate text-[12px] text-slate-500">{l.reason}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[12px] font-semibold tabular-nums text-slate-700">
                  {l.valueEstimate > 0 ? formatRupiahShort(l.valueEstimate) : "—"}
                </div>
                <div className="text-[10px] text-slate-400">{l.assignedTo || "Belum diambil"}</div>
              </div>
              <ArrowRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-brand-600" />
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}
