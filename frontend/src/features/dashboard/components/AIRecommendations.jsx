import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, X, CheckCircle2, Zap } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

const SEV = {
  high: { dot: "bg-chart-rose", label: "Prioritas tinggi", pill: "bg-chart-rose-soft text-chart-rose" },
  med:  { dot: "bg-chart-orange", label: "Prioritas sedang", pill: "bg-chart-orange-soft text-chart-orange" },
  low:  { dot: "bg-brand-400", label: "Info", pill: "bg-brand-50 text-brand-700" },
};

// ✨ Rekomendasi Sano — PANEL AKSI AI UNGGULAN. Rekomendasi teratas ditonjolkan
// (hierarki kuat + alasan explainable + dampak + CTA solid); sisanya ringkas.
// Wave 2A: data CONTOH (mock). Wave 2B: /analytics/recommendations (rule-based).
export default function AIRecommendations({ items = [], loading, isMock }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState([]);
  const visible = items.filter((i) => !dismissed.includes(i.id));
  const [primary, ...rest] = visible;

  return (
    <Card variant="ai-insight" className="overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ai-gradient text-white shadow-[0_4px_12px_-3px_rgba(124,58,237,0.5)]">
            <Sparkles size={16} />
          </span>
          <div>
            <div className="text-[14px] font-bold leading-tight text-slate-900">Rekomendasi Sano</div>
            <div className="text-[11px] text-ai-ink/70">Prioritas hari ini · diperbarui otomatis</div>
          </div>
        </div>
        {isMock && <Badge variant="ai">Contoh</Badge>}
      </div>

      <div className="p-4 pt-3">
        {loading ? (
          <div className="flex flex-col gap-2">
            <div className="ai-shimmer h-[92px] rounded-xl" />
            <div className="ai-shimmer h-12 rounded-xl" />
            <div className="ai-shimmer h-12 rounded-xl" />
          </div>
        ) : !primary ? (
          <div className="flex items-center gap-2 py-6 text-[13px] font-medium text-ai-ink">
            <CheckCircle2 size={16} /> Semua lead sudah ditangani, kerja bagus 👍
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* PRIMARY — rekomendasi teratas, ditonjolkan */}
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${SEV[primary.severity]?.pill || SEV.low.pill}`}>
                  <Zap size={11} /> {SEV[primary.severity]?.label || SEV.low.label}
                </span>
                {primary.impact && <span className="text-[11px] font-semibold text-slate-400">· {primary.impact}</span>}
              </div>
              <div className="text-[16px] font-bold leading-snug tracking-[-0.01em] text-slate-900">{primary.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{primary.detail}</p>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="ai" size="sm" onClick={() => navigate(primary.href)}>
                  {primary.actionLabel} <ArrowRight size={14} />
                </Button>
                <button
                  onClick={() => setDismissed((d) => [...d, primary.id])}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  Nanti saja
                </button>
              </div>
            </div>

            {/* SECONDARY — ringkas, tetap ada CTA */}
            {rest.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/60 bg-white/60 py-2.5 pl-3 pr-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV[r.severity]?.dot || SEV.low.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-900">{r.title}</div>
                  <div className="truncate text-[11.5px] text-slate-500">{r.detail}</div>
                </div>
                <Button variant="ghost" size="sm" className="shrink-0 text-brand-600 hover:bg-brand-50" onClick={() => navigate(r.href)}>
                  {r.actionLabel} <ArrowRight size={13} />
                </Button>
                <button
                  onClick={() => setDismissed((d) => [...d, r.id])}
                  aria-label="Sembunyikan"
                  className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
