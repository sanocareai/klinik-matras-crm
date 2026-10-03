import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Card } from "@/components/ui/card.jsx";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { isDemoActive } from "@/features/production/demo/demoGate.js";
import { PANEL_COPY, summarizeV1, topV1Units } from "@/features/production/nonV2OrdersModel.js";
import { PRODUCTION_PRIORITY_REAL, UNIT_STATUS_REAL } from "@/features/bengkel/unitStatus.js";

// P12B.5 — "Order asli di luar Production V2" (sumber V1), dipakai Ringkasan, Status Produksi, dan Rencana Produksi. Data = getWorkOrders (endpoint lama);
// tiap unit memakai sumber TEPAT SATU (server menandai inProductionV2). Klik baris → drawer Unit 360 (aksi V1 sah untuk unit non-V2).
// Tersembunyi saat Mode Latihan (dataset latihan murni V2) atau bila akun tak berhak membaca (403/galat) — tanpa pesan galat yang mengganggu.
export default function NonV2OrdersPanel({ page = "status" }) {
  const [units, setUnits] = useState(null);
  const [openId, setOpenId] = useState(null);
  const demo = isDemoActive();
  const load = useCallback(() => api.getWorkOrders({}).then((d) => setUnits(d.units || [])).catch(() => setUnits(false)), []);
  useEffect(() => { if (!demo) load(); }, [demo, load]);
  const summary = useMemo(() => (units ? summarizeV1(units) : null), [units]);
  const rows = useMemo(() => (units ? topV1Units(units, 8) : []), [units]);
  if (demo || units === false || (summary && summary.total === 0)) return null;
  return (
    <Card className="min-w-0 overflow-hidden p-0" data-testid="nonv2-orders" data-page={page}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="m-0 text-[13.5px] font-bold text-ink">Order asli di luar Production V2</h2>
        <Badge variant="neutral" data-testid="nonv2-source">Sumber: V1</Badge>
        {summary && <span className="text-[12px] text-ink3" data-testid="nonv2-total">{summary.total} unit aktif{summary.blocked ? ` · ${summary.blocked} terhambat` : ""}</span>}
        <Link to="/bengkel/order-produksi" className="ml-auto text-[12.5px] font-semibold text-accent underline">Semua order →</Link>
      </div>
      <p className="m-0 px-4 pt-3 text-[12px] text-ink3" data-testid="nonv2-copy">{PANEL_COPY[page]}</p>
      {!summary ? <p className="m-0 px-4 py-4 text-[12.5px] text-ink3">Memuat order asli…</p> : (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {summary.byStatus.map((s) => <span key={s.status} className="rounded-chip bg-inset px-2 py-0.5 text-[11.5px] text-ink2">{UNIT_STATUS_REAL[s.status]?.label || s.status} <b className="text-ink">{s.count}</b></span>)}
          </div>
          <ul className="m-0 list-none divide-y divide-line p-0 pt-2">
            {rows.map((u) => (
              <li key={u.id}>
                <button type="button" data-testid="nonv2-row" data-unit-code={u.unitCode} onClick={() => setOpenId(u.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-hovertint">
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold text-ink">{u.unitCode}</span><span className="block truncate text-[12px] text-ink3">{u.order?.customer?.name || "—"}{u.order?.orderNumber ? ` · ${u.order.orderNumber}` : ""}</span></span>
                  {u.priority && u.priority !== "NORMAL" && <Badge variant={PRODUCTION_PRIORITY_REAL[u.priority]?.tone || "neutral"}>{PRODUCTION_PRIORITY_REAL[u.priority]?.label || u.priority}</Badge>}
                  {u.productionStatus === "BLOCKED" && <Badge variant="red">Terhambat</Badge>}
                  <Badge variant={UNIT_STATUS_REAL[u.status]?.tone || "neutral"}>{UNIT_STATUS_REAL[u.status]?.label || u.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
          {summary.total > rows.length && <p className="m-0 border-t border-line px-4 py-2 text-[11.5px] text-ink3">+{summary.total - rows.length} unit lainnya di Order Produksi.</p>}
        </>
      )}
      <UnitOverviewDrawer unitId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </Card>
  );
}
