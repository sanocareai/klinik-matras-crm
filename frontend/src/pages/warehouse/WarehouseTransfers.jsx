import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Plus, RefreshCw } from "lucide-react";
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
import StockTransferFormModal from "@/features/warehouse/components/StockTransferFormModal.jsx";
import StockTransferDetailDrawer from "@/features/warehouse/components/StockTransferDetailDrawer.jsx";
import { TRANSFER_STATUS_REAL } from "@/features/warehouse/inventoryReal.js";

// Stock Transfer — Warehouse Tahap 4. DATA NYATA.
//
// Dua baris ledger per transfer, dua langkah: Confirm Dispatch (keluar dari
// asal) lalu Confirm Receipt (masuk ke tujuan) — lihat catatan panjang di
// schema.prisma & routes/stockTransfer.js.
const TABS = [
  { key: "",                label: "Semua" },
  { key: "WAITING_APPROVAL",label: "Waiting Approval" },
  { key: "APPROVED",        label: "Approved" },
  { key: "PICKED",          label: "Picked" },
  { key: "IN_TRANSIT",      label: "In Transit" },
  { key: "COMPLETED",       label: "Completed" },
  { key: "CANCELLED",       label: "Cancelled" },
];

export default function WarehouseTransfers() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getStockTransfers({ status: tab || undefined })
      .then((d) => setRows(d.transfers))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && rows && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Stock Transfer"
        subtitle="Mutasi barang antar lokasi, rak, atau gudang."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> New Transfer
            </Button>
          </>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status transfer" className="flex flex-wrap gap-1 border-b border-line pb-2">
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
          {rows && <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} transfer</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="Belum ada Stock Transfer"
              description="Mutasi barang antar lokasi akan tampil di sini."
              action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Transfer</Button>}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Transfer ID</TH><TH>Source</TH><TH>Destination</TH>
                      <TH numeric>Items</TH><TH>Requested By</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={6} />}
                    {!loading && rows?.map((r) => (
                      <TR key={r.id} clickable onClick={() => setSelectedId(r.id)}>
                        <TD className="font-semibold text-ink">{r.transferNumber}</TD>
                        <TD className="text-ink2">{r.sourceLocation.code}</TD>
                        <TD className="text-ink2">{r.destinationLocation.code}</TD>
                        <TD numeric>{r.lines.length}</TD>
                        <TD className="text-ink2">{r.requestedBy?.name || "—"}</TD>
                        <TD><StatusBadge map={TRANSFER_STATUS_REAL} value={r.status} /></TD>
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
                        <span className="text-[12.5px] font-semibold text-ink">{r.transferNumber}</span>
                        <StatusBadge map={TRANSFER_STATUS_REAL} value={r.status} className="ml-auto shrink-0" />
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{r.sourceLocation.code} → {r.destinationLocation.code}</div>
                      <div className="mt-0.5 text-[11px] text-ink2">{r.lines.length} item</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <StockTransferFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      <StockTransferDetailDrawer transferId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
    </PageContainer>
  );
}
