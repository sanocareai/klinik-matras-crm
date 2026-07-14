import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, X, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";

const SEV_DOT = { high: "bg-chart-rose", med: "bg-chart-orange", low: "bg-brand-400" };

// ✨ Rekomendasi Sano — widget unggulan. Menampilkan aksi paling penting yang
// harus dilakukan sekarang (ranked, bisa disembunyikan). Wave 2A: data CONTOH
// (mock) — ditandai badge. Wave 2B: dari /analytics/recommendations (rule-based
// atas sinyal nyata, bukan LLM). Lihat wave-2 architecture §5.
export default function AIRecommendations({ items = [], loading, isMock }) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState([]);
  const visible = items.filter((i) => !dismissed.includes(i.id));

  return (
    <Card variant="ai-insight" className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-ai-gradient text-white">
            <Sparkles size={13} />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ai-ink">Rekomendasi Sano</span>
        </div>
        {isMock && <Badge variant="ai">Contoh</Badge>}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="ai-shimmer h-14 rounded-xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-[13px] font-medium text-ai-ink">
          <CheckCircle2 size={16} /> Semua lead sudah ditangani, kerja bagus 👍
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/70 bg-white/70 p-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${SEV_DOT[r.severity] || SEV_DOT.low}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-slate-900">{r.title}</div>
                <div className="truncate text-[12px] text-slate-500">{r.detail}</div>
              </div>
              <button
                onClick={() => navigate(r.href)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-brand-600 transition-colors hover:bg-brand-50"
              >
                {r.actionLabel} <ArrowRight size={13} />
              </button>
              <button
                onClick={() => setDismissed((d) => [...d, r.id])}
                aria-label="Sembunyikan rekomendasi"
                className="shrink-0 rounded-md p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
