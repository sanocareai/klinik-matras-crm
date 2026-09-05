import React, { useEffect, useState } from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";

// Wave 2 (redesign Inbox, lihat plan starry-humming-knuth) — MENYAMBUNGKAN
// engine yang sudah lama jadi (backend/src/services/intelligence/
// nextBestAction.js) tapi belum pernah dipanggil dari frontend manapun.
// TIDAK ADA logic baru di sini — engine yang memutuskan aksinya, komponen
// ini cuma menampilkan `{action, reason, urgency}` apa adanya.
//
// urgency → warna: dipetakan ke 4 hue semantik yang SUDAH ada di badge.jsx
// (aturan satu accent), bukan warna baru. urgent=red (butuh manusia SEKARANG,
// biasanya komplain), high=orange, medium=accent (biru, netral-informasi),
// low=neutral (abu, sekadar catatan, tidak mendesak).
const URGENCY_BADGE = { urgent: "red", high: "orange", medium: "accent", low: "neutral" };
const URGENCY_LABEL = { urgent: "Mendesak", high: "Tinggi", medium: "Sedang", low: "Rendah" };

export default function NextBestActionCard({ customerId }) {
  const [nextAction, setNextAction] = useState(null);
  // 403 (SALES membuka lead milik sales lain) BUKAN error yang perlu
  // ditampilkan — kartu ini dekoratif/pelengkap, bukan wajib. Gagal diam-
  // diam (skip render) lebih baik daripada kotak error di tengah panel
  // customer yang sedang sales pakai untuk kerja sungguhan.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setNextAction(null);
    setFailed(false);
    if (!customerId) return;
    api.getCustomerIntelligence(customerId)
      .then((data) => { if (alive) setNextAction(data?.nextAction || null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [customerId]);

  if (failed || !nextAction) return null;

  const badgeVariant = URGENCY_BADGE[nextAction.urgency] || "neutral";
  const urgencyLabel = URGENCY_LABEL[nextAction.urgency] || nextAction.urgency;

  return (
    <Card variant="ai-insight" className="animate-fade-rise p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-accent">
          <Sparkles size={13} /> Rekomendasi Aksi
        </span>
        <Badge variant={badgeVariant}>{urgencyLabel}</Badge>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
        <ArrowRight size={14} className="shrink-0 text-accent" />
        {nextAction.action}
      </p>
      <p className="mt-1 text-[12.5px] text-ink3">{nextAction.reason}</p>
    </Card>
  );
}
