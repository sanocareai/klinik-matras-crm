import React from "react";
import { Badge } from "@/components/ui/badge.jsx";

// Status siklus produksi (Fase 5) — SATU kosakata untuk Meja, Corner, Dokumentasi, Unit 360, Status Produksi, dan laporan (server: lifecycleStatusOf). Tidak diturunkan ulang di layar.
const TONE = { SIAP_KIRIM: "green", TERKIRIM: "green", DALAM_PENGIRIMAN: "green", MENUNGGU_GUDANG: "orange", MENUNGGU_QC: "orange", REWORK: "red", DIBATALKAN: "neutral", BELUM_MULAI: "neutral", SIAP_DISELESAIKAN: "accent", MENUNGGU_CORNER: "accent", DI_CORNER: "accent", DI_MEJA: "accent" };
export function LifecycleBadge({ lifecycle, showCorner = true, className = "" }) {
  if (!lifecycle) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`} data-testid="lifecycle" data-lifecycle={lifecycle.key}>
      <Badge variant={TONE[lifecycle.key] || "neutral"} data-testid="lifecycle-badge">{lifecycle.label}</Badge>
      {showCorner && lifecycle.cornerNotApplicable && <Badge variant="neutral" data-testid="corner-na-badge" title={lifecycle.cornerReason || ""}>Corner tidak berlaku</Badge>}
    </span>
  );
}
export default LifecycleBadge;
