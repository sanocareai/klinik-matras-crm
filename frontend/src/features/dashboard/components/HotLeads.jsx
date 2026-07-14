import React from "react";
import { useNavigate } from "react-router-dom";
import { Flame, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { STAGE_LABELS, stageVariant, formatRupiahShort } from "../../../utils/format.js";

// Cincin skor 0–100 (EXPLAINABLE — sinyal & alasan tampil di bawah). Warna=urgensi.
function ScoreRing({ score }) {
  const color = score >= 85 ? "#dc2626" : score >= 70 ? "#f59e0b" : "#2064b7";
  const dash = (score / 100) * 94.2;
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#eef2f7" strokeWidth="3.5" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3.5" strokeDasharray={`${dash} 94.2`} strokeLinecap="round" />
      </svg>
      <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{score}</span>
    </span>
  );
}

// 🔥 Lead Panas — worklist terurut by skor, dengan EXPLAINABILITY: sinyal yang
// membentuk skor + rekomendasi langkah berikutnya. Wave 2B: /analytics/hot-leads.
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
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 14 }} />)
        ) : items.length === 0 ? (
          <EmptyState icon={Flame} title="Belum ada lead panas" description="Lead dengan sinyal beli akan muncul di sini." />
        ) : (
          items.map((l) => (
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate("/customers")}
              onKeyDown={(e) => { if (e.key === "Enter") navigate("/customers"); }}
              className="group cursor-pointer rounded-2xl border border-slate-100 p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/30"
            >
              <div className="flex items-start gap-3">
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
              </div>

              {/* Sinyal (kenapa skornya) */}
              {l.signals?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {l.signals.map((s, i) => (
                    <span key={i} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500">{s}</span>
                  ))}
                </div>
              )}

              {/* Rekomendasi langkah berikutnya */}
              {l.nextAction && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-[12px]">
                  <span className="font-medium text-slate-400">Langkah:</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{l.nextAction}</span>
                  <ArrowRight size={13} className="shrink-0 text-brand-500 transition-transform group-hover:translate-x-0.5" />
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
