import React from "react";
import { Card } from "@/components/ui/card.jsx";

// "Sano Insight" — ringkasan RULE-BASED (bukan AI). Sengaja tanpa gradient/glyph
// AI supaya tidak terbaca sebagai AI. Phase-4 LLM bisa mengganti mesinnya nanti.
export default function CustomerOverview({ text }) {
  return (
    <Card className="p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink2">Sano Insight</span>
        <span className="rounded bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">
          Rule-based
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-ink">
        {text || "Belum ada cukup data untuk ringkasan pelanggan."}
      </p>
    </Card>
  );
}
