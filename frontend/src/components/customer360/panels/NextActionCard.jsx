import React from "react";
import { ArrowRight, Target } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";

const TONE = { danger: "text-chart-rose", warning: "text-chart-orange", brand: "text-brand-700", neutral: "text-slate-700" };

// Langkah berikutnya (rule-based). CTA "Buka chat" = pintu masuk percakapan.
export default function NextActionCard({ action, onOpenChat }) {
  if (!action) return null;
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Target size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Langkah berikutnya</div>
        <div className={`mt-0.5 text-[13.5px] font-semibold ${TONE[action.tone] || TONE.neutral}`}>{action.label}</div>
      </div>
      <Button size="sm" onClick={onOpenChat} className="shrink-0">
        Buka chat <ArrowRight size={13} />
      </Button>
    </Card>
  );
}
