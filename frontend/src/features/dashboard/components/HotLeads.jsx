import React from "react";
import { useNavigate } from "react-router-dom";
import { Flame, ArrowRight, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { STAGE_LABELS, stageVariant, formatRupiahShort } from "../../../utils/format.js";

// Cincin skor 0–100 (EXPLAINABLE — sinyal & alasan tampil di bawah). Warna=urgensi.
function ScoreRing({ score = 0 }) {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const color = s >= 85 ? "var(--red)" : s >= 70 ? "var(--orange)" : "var(--accent)";
  const dash = (s / 100) * 94.2;
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--hairline)" strokeWidth="3.5" />
        <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3.5" strokeDasharray={`${dash} 94.2`} strokeLinecap="round" />
      </svg>
      <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{s}</span>
    </span>
  );
}

// 🔥 Lead Panas — worklist terurut by skor, dengan EXPLAINABILITY: sinyal yang
// membentuk skor + rekomendasi langkah berikutnya. Wave 2B: /analytics/hot-leads.
// Defensive: tahan empty response, API failure (error), & field hilang.
export default function HotLeads({ items, loading, error, isMock }) {
  const navigate = useNavigate();
  const list = Array.isArray(items) ? items : [];

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Flame size={15} className="text-orange" /> Lead Panas
        </CardTitle>
        {isMock && <Badge variant="ai">Contoh</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 14 }} />)
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Gagal memuat" description="Tidak bisa memuat lead panas. Coba muat ulang." />
        ) : list.length === 0 ? (
          <EmptyState icon={Flame} title="Belum ada lead panas" description="Lead dengan sinyal beli akan muncul di sini." />
        ) : (
          list.map((l) => (
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate("/customers")}
              onKeyDown={(e) => { if (e.key === "Enter") navigate("/customers"); }}
              className="group cursor-pointer rounded-2xl p-3 transition-colors hover:bg-accentbg/30"
            >
              <div className="flex items-start gap-3">
                <ScoreRing score={l.score} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{l.name}</span>
                    <Badge variant={stageVariant(l.stage)}>{STAGE_LABELS[l.stage] || l.stage}</Badge>
                  </div>
                  <div className="truncate text-[12px] text-ink2">{l.reason}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-semibold tabular-nums text-ink">
                    {l.valueEstimate > 0 ? formatRupiahShort(l.valueEstimate) : "—"}
                  </div>
                  <div className="text-[10px] text-ink3">{l.assignedTo || "Belum diambil"}</div>
                </div>
              </div>

              {/* Sinyal (kenapa skornya) */}
              {l.signals?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {l.signals.map((s, i) => (
                    <span key={i} className="rounded-md bg-inset px-1.5 py-0.5 text-[10.5px] font-medium text-ink2">{s}</span>
                  ))}
                </div>
              )}

              {/* Rekomendasi langkah berikutnya */}
              {l.nextAction && (
                <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-[12px]">
                  <span className="font-medium text-ink3">Langkah:</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{l.nextAction}</span>
                  <ArrowRight size={13} className="shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
