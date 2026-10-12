import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { statusTone } from "@/features/production/productionLabels.js";

// Status global (milestone) — SATU kosakata di Sales CRM, detail order, Pipeline, Delivery, Warehouse, Produksi, Unit 360, laporan. Nilai datang dari server (read-model berbasis bukti);
// komponen ini hanya MEMFORMAT. Field status lama (Order.status) tetap ditampilkan/diedit oleh pemanggil — badge ini TAMBAHAN, bukan pengganti.
// Order dengan unit berbeda posisi: label = unit yang paling tertinggal + rincian ("2 dari 3 unit"), unit yang lebih maju di baris kedua. Order tanpa unit/sewa (legacy) tidak menampilkan badge.

/** Teks ringkas status global order, mis. "Diterima di Workshop · 2 dari 3 unit" (null bila tidak ada). */
export function orderMilestoneText(m) {
  if (!m || m.legacy || !m.label) return null;
  return m.summary || m.label;
}

export function OrderMilestoneBadge({ milestone, showAhead = true, className = "" }) {
  const text = orderMilestoneText(milestone);
  if (!text) return null;
  return (
    <span className={`inline-flex flex-col items-start gap-0.5 ${className}`} data-testid="order-milestone" data-milestone-key={milestone.key || ""} data-mixed={milestone.mixed ? "1" : "0"}>
      <Badge variant={statusTone(milestone.key)} title="Status global — posisi unit yang paling tertinggal">{text}</Badge>
      {showAhead && milestone.mixed && milestone.aheadText && <span className="text-[10.5px] leading-tight text-ink3" data-testid="order-milestone-ahead">Lainnya: {milestone.aheadText}</span>}
    </span>
  );
}

/** Status global satu UNIT (objek globalStatus dari server: { key, label, detail }). */
export function UnitGlobalStatusBadge({ globalStatus, className = "" }) {
  if (!globalStatus?.label) return null;
  return (
    <span className={`inline-flex flex-col items-start gap-0.5 ${className}`} data-testid="unit-global-status" data-global-status={globalStatus.key}>
      <Badge variant={statusTone(globalStatus.key)}>{globalStatus.label}</Badge>
      {globalStatus.detail && <span className="text-[10.5px] leading-tight text-ink3">{globalStatus.detail}</span>}
    </span>
  );
}

export default OrderMilestoneBadge;
