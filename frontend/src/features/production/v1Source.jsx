import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { isDemoActive } from "@/features/production/demo/demoGate.js";
import { selectV1Units, topV1Units } from "@/features/production/nonV2OrdersModel.js";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";
import { DELAY_TITLE, presenceTone, priorityOf, salesServicesText, statusOf } from "@/features/production/productionLabels.js";

// Unit yang belum punya rencana di papan Production (daftar ringkas untuk Ringkasan/Status). Simplifikasi slice 1: TANPA label sumber (V1/V2) — pengguna hanya melihat
// status (Pengambilan/Diproses/Siap Kirim/Terkirim), prioritas (Normal/Tinggi/Komplain), dan Layanan Sales. Sumber = work-orders yang disaring & dipaginasi SERVER
// (order nyata berstatus Diproses; halaman pertama 200 unit + total sebenarnya), bukan seluruh daftar. Mode Latihan: tidak memuat (dataset latihan murni papan).
export const OFF_BOARD_PAGE_SIZE = 200;

export function useV1Units() {
  const [state, setState] = useState({ units: null, total: 0, hasMore: false });
  const demo = isDemoActive();
  const load = useCallback(() => api.getWorkOrders({ displayStatus: "DIPROSES", real: "1", pageSize: String(OFF_BOARD_PAGE_SIZE) })
    .then((d) => setState({ units: d.units || [], total: d.total ?? (d.units || []).length, hasMore: !!d.hasMore }))
    .catch(() => setState({ units: [], total: 0, hasMore: false })), []);
  useEffect(() => { if (!demo) load(); }, [demo, load]);
  const v1 = useMemo(() => (demo ? [] : selectV1Units(state.units || [])), [state.units, demo]);
  return { v1, total: demo ? 0 : state.total, hasMore: !demo && state.hasMore, loaded: state.units !== null || demo, reload: load, top: (n) => topV1Units(state.units || [], n) };
}

// Kartu ringkas unit (setara UpcomingCard): kode unit, pelanggan, Layanan Sales, status, posisi fisik, prioritas, "Pekerjaan Tertunda". Klik → drawer Unit 360.
export function V1UnitCard({ unit, onOpen }) {
  const st = statusOf(unit);
  const pr = priorityOf(unit);
  const sales = salesServicesText((unit.order?.items || []).map((i) => i.layananName).filter(Boolean));
  return (
    <button type="button" data-testid="v1-card" data-unit-code={unit.unitCode} onClick={() => onOpen(unit.id)}
      className="flex w-full min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface p-3 text-left hover:bg-hovertint">
      <span className="truncate text-[13px] font-bold text-ink">{unit.unitCode}</span>
      <span className="truncate text-[12px] text-ink3">{unit.order?.customer?.name || "—"}{unit.order?.orderNumber ? ` · ${unit.order.orderNumber}` : ""}</span>
      <span className="break-words text-[12px] text-ink2 [overflow-wrap:anywhere]"><span className="font-semibold text-ink3">Layanan Sales: </span>{sales}</span>
      <PkrRujukan pkr={unit.penjualanKaryawan} />
      <span className="flex flex-wrap items-center gap-1">
        <Badge variant={st.tone} data-testid="status-badge">{st.label}</Badge>
        {unit.presence?.label && <Badge variant={presenceTone(unit.presence)}>{unit.presence.label}</Badge>}
        {unit.currentStage?.labelId && <span className="text-[11.5px] text-ink3">{unit.currentStage.labelId}</span>}
        {pr.key !== "NORMAL" && <Badge variant={pr.tone}>{pr.label}</Badge>}
        {unit.productionStatus === "BLOCKED" && <Badge variant="red">{DELAY_TITLE}</Badge>}
      </span>
    </button>
  );
}
