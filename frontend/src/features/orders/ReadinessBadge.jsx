import React from "react";
import { CheckCircle2, AlertTriangle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { evaluateReadiness, READINESS, READINESS_META } from "@/utils/orderReadiness.js";

const ICON = {
  [READINESS.READY]: CheckCircle2,
  [READINESS.NEEDS_INFO]: AlertTriangle,
  [READINESS.BLOCKED]: Ban,
};

// Badge kecil untuk kartu/baris order — ikon WAJIB ada (bukan cuma warna),
// sama aturan dengan StatusInvoiceBadge di InvoicePanel.jsx. `null` (order
// CANCELLED) sengaja tidak render apa pun — readiness tidak berlaku untuknya.
export default function ReadinessBadge({ order, className }) {
  const hasil = evaluateReadiness(order);
  if (!hasil) return null;

  const meta = READINESS_META[hasil.state];
  const Icon = ICON[hasil.state];
  const jumlahKurang = hasil.missingBlockers.length + hasil.missingWarnings.length;

  return (
    <Badge
      variant={meta.tone}
      className={className}
      title={
        hasil.state === READINESS.READY
          ? "Semua data wajib sudah lengkap"
          : `${jumlahKurang} data belum lengkap — buka rincian untuk lihat daftarnya`
      }
    >
      <Icon size={11} aria-hidden="true" /> {meta.label}
    </Badge>
  );
}
