import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { isDemoActive } from "@/features/production/demo/demoGate.js";
import { selectV1Units, sourceOf, topV1Units } from "@/features/production/nonV2OrdersModel.js";
import { PRODUCTION_PRIORITY_REAL, UNIT_STATUS_REAL } from "@/features/bengkel/unitStatus.js";

// P12B.6 — order asli V1 di papan/daftar UTAMA (Status, Rencana, Ringkasan, Order Produksi) dengan badge sumber — bukan panel/workspace kedua.
// Sumber data = work-orders (endpoint lama) yang ditandai server `inProductionV2` (cohort reader yang sama dengan Unit 360); tiap unit tampil TEPAT SATU kali.
// Mode Latihan: tidak memuat (dataset latihan murni V2). Galat/403: kosong (tanpa pesan yang mengganggu).
export function SourceBadge({ source, className = "" }) {
  const v2 = source === "V2";
  return <Badge variant={v2 ? "accent" : "neutral"} className={className} data-testid="source-badge" data-source={source} title={v2 ? "Dikelola Production V2" : "Order asli — jalur V1 (belum Production V2)"}>{v2 ? "V2" : "V1"}</Badge>;
}

export function useV1Units() {
  const [units, setUnits] = useState(null);
  const demo = isDemoActive();
  const load = useCallback(() => api.getWorkOrders({}).then((d) => setUnits(d.units || [])).catch(() => setUnits([])), []);
  useEffect(() => { if (!demo) load(); }, [demo, load]);
  const v1 = useMemo(() => (demo ? [] : selectV1Units(units || [])), [units, demo]);
  return { v1, loaded: units !== null || demo, reload: load, top: (n) => topV1Units(units || [], n) };
}

// Kartu ringkas order V1 (setara UpcomingCard): kode unit, pelanggan, status, prioritas/terhambat, badge sumber. Klik → drawer Unit 360 (fallback V1).
export function V1UnitCard({ unit, onOpen }) {
  const st = UNIT_STATUS_REAL[unit.status];
  return (
    <button type="button" data-testid="v1-card" data-unit-code={unit.unitCode} onClick={() => onOpen(unit.id)}
      className="flex w-full min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface p-3 text-left hover:bg-hovertint">
      <span className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{unit.unitCode}</span><SourceBadge source={sourceOf(unit)} /></span>
      <span className="truncate text-[12px] text-ink3">{unit.order?.customer?.name || "—"}{unit.order?.orderNumber ? ` · ${unit.order.orderNumber}` : ""}</span>
      <span className="flex flex-wrap items-center gap-1">
        <Badge variant={st?.tone || "neutral"}>{st?.label || unit.status}</Badge>
        {unit.currentStage?.labelId && <span className="text-[11.5px] text-ink3">{unit.currentStage.labelId}</span>}
        {unit.priority && unit.priority !== "NORMAL" && <Badge variant={PRODUCTION_PRIORITY_REAL[unit.priority]?.tone || "neutral"}>{PRODUCTION_PRIORITY_REAL[unit.priority]?.label || unit.priority}</Badge>}
        {unit.productionStatus === "BLOCKED" && <Badge variant="red">Terhambat</Badge>}
      </span>
    </button>
  );
}
