import React from "react";
import { ArrowRight, Target } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";

const TONE = { danger: "text-chart-rose", warning: "text-chart-orange", brand: "text-brand-700", neutral: "text-slate-700" };

// Langkah berikutnya (rule-based) — aksi + alasan/konteks + CTA. Action-oriented.
export default function NextActionCard({ action, onOpenChat }) {
  if (!action) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Target size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Langkah berikutnya</div>
          <div className={`mt-0.5 text-[14px] font-bold leading-snug ${TONE[action.tone] || TONE.neutral}`}>{action.label}</div>
          {action.reason && <div className="mt-1 text-[12px] leading-snug text-slate-500">{action.reason}</div>}
        </div>
      </div>
      <Button size="sm" onClick={onOpenChat} className="mt-3 w-full justify-center">
        Lanjutkan WhatsApp <ArrowRight size={13} />
      </Button>
    </Card>
  );
}
