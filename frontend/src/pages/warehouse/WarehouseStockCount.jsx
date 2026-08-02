import React, { useCallback, useEffect, useState } from "react";
import { Scale, Plus, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import StatusBadge from "@/features/warehouse/components/StatusBadge.jsx";
import StockCountFormModal from "@/features/warehouse/components/StockCountFormModal.jsx";
import StockCountDetailDrawer from "@/features/warehouse/components/StockCountDetailDrawer.jsx";
import { COUNT_STATUS_REAL, COUNT_TYPE_REAL } from "@/features/warehouse/inventoryReal.js";

// Cycle Count & Stock Opname — Warehouse Tahap 5. DATA NYATA.
//
// Stok tidak berubah sampai Complete Count menulis ADJUSTMENT per baris
// berselisih — lihat catatan panjang di schema.prisma & routes/stockCount.js.
const TABS = [
  { key: "",               label: "Semua" },
  { key: "SCHEDULED",      label: "Scheduled" },
  { key: "IN_PROGRESS",    label: "In Progress" },
  { key: "WAITING_REVIEW", label: "Waiting Review" },
  { key: "COMPLETED",      label: "Completed" },
  { key: "CANCELLED",      label: "Cancelled" },
];

const tanggal = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

export default function WarehouseStockCount() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getStockCounts({ status: tab || undefined })
      .then((d) => setRows(d.counts))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && rows && rows.length === 0;

  function countedOf(row) {
    return row.lines.filter((l) => l.countedQty != null).length;
  }
  function differenceOf(row) {
    return row.lines.filter((l) => l.systemQty != null && l.countedQty != null && l.systemQty !== l.countedQty).length;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Cycle Count & Stock Opname"
        subtitle="Jadwal penghitungan stok berkala dan rekonsiliasi selisih."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> Schedule Count
            </Button>
          </>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status count" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}
            >
              {t.label}
            </button>
          ))}
          {rows && <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} sesi</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={Scale}
              title="Belum ada Stock Count"
              description="Jadwalkan cycle count atau stock opname untuk mulai merekonsiliasi stok."
              action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Schedule Count</Button>}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Count ID</TH><TH>Type</TH><TH>Scheduled</TH><TH>Assigned</TH>
                      <TH numeric>Total Items</TH><TH numeric>Counted</TH><TH numeric>Difference</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={8} />}
                    {!loading && rows?.map((r) => (
                      <TR key={r.id} clickable onClick={() => setSelectedId(r.id)}>
                        <TD className="font-semibold text-ink">{r.countNumber}</TD>
                        <TD className="whitespace-nowrap text-ink2">{COUNT_TYPE_REAL[r.countType]?.label}</TD>
                        <TD className="whitespace-nowrap text-ink2">{r.scheduledDate ? tanggal(r.scheduledDate) : "—"}</TD>
                        <TD className="text-ink2">{r.assignedTo?.name || "—"}</TD>
                        <TD numeric>{r.lines.length}</TD>
                        <TD numeric>{countedOf(r)}</TD>
                        <TD numeric className={differenceOf(r) > 0 ? "font-bold text-orange" : "text-ink3"}>
                          {differenceOf(r) || "—"}
                        </TD>
                        <TD><StatusBadge map={COUNT_STATUS_REAL} value={r.status} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line md:hidden">
                {!loading && rows?.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-ink">{r.countNumber}</span>
                        <StatusBadge map={COUNT_STATUS_REAL} value={r.status} className="ml-auto shrink-0" />
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{COUNT_TYPE_REAL[r.countType]?.label}</div>
                      <div className="mt-0.5 text-[11px] text-ink2">
                        {countedOf(r)}/{r.lines.length} counted{differenceOf(r) > 0 ? ` · ${differenceOf(r)} selisih` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <StockCountFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      <StockCountDetailDrawer countId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
    </PageContainer>
  );
}
