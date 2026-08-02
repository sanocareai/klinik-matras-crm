import React, { useCallback, useEffect, useState } from "react";
import { Inbox, Plus, RefreshCw } from "lucide-react";
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
import GoodsReceiptFormModal from "@/features/warehouse/components/GoodsReceiptFormModal.jsx";
import GoodsReceiptDetailDrawer from "@/features/warehouse/components/GoodsReceiptDetailDrawer.jsx";
import { RECEIPT_STATUS_REAL, RECEIPT_SOURCE_REAL } from "@/features/warehouse/inventoryReal.js";

// Goods Receipt — Warehouse Tahap 2B. DATA NYATA.
//
// Dokumen proses di depan ledger inventory: DRAFT → SCHEDULED → ARRIVED →
// INSPECTION → READY_FOR_PUTAWAY → COMPLETED. Baris ledger stock_movements
// RECEIPT baru ditulis SATU KALI, saat Confirm Putaway — lihat catatan
// panjang di schema.prisma & routes/goodsReceipt.js.
const TABS = [
  { key: "",                  label: "Semua" },
  { key: "DRAFT",             label: "Draft" },
  { key: "SCHEDULED",         label: "Scheduled" },
  { key: "ARRIVED",           label: "Arrived" },
  { key: "INSPECTION",        label: "Inspection" },
  { key: "READY_FOR_PUTAWAY", label: "Ready for Putaway" },
  { key: "COMPLETED",         label: "Completed" },
  { key: "REJECTED",          label: "Rejected" },
];

const tanggal = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

export default function WarehouseGoodsReceipt() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getGoodsReceipts({ status: tab || undefined })
      .then((d) => setRows(d.receipts))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && rows && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Goods Receipt"
        subtitle="Penerimaan barang dari supplier, produksi, atau retur."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> New Receipt
            </Button>
          </>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status receipt" className="flex flex-wrap gap-1 border-b border-line pb-2">
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
          {rows && <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} receipt</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={Inbox}
              title="Belum ada Goods Receipt"
              description="Supplier delivery atau penerimaan barang baru akan tampil di sini."
              action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Receipt</Button>}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Receipt ID</TH><TH>Reference</TH><TH>Source</TH><TH>Supplier</TH>
                      <TH>Expected</TH><TH numeric>Items</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={7} />}
                    {!loading && rows?.map((r) => (
                      <TR key={r.id} clickable onClick={() => setSelectedId(r.id)}>
                        <TD className="font-semibold text-ink">{r.receiptNumber}</TD>
                        <TD className="text-ink2">{r.sourceReference || "—"}</TD>
                        <TD className="whitespace-nowrap text-ink2">{RECEIPT_SOURCE_REAL[r.sourceType]?.label}</TD>
                        <TD truncate>{r.supplier || "—"}</TD>
                        <TD className="whitespace-nowrap text-ink2">{r.expectedDate ? tanggal(r.expectedDate) : "—"}</TD>
                        <TD numeric>{r.lines.length}</TD>
                        <TD><StatusBadge map={RECEIPT_STATUS_REAL} value={r.status} /></TD>
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
                        <span className="text-[12.5px] font-semibold text-ink">{r.receiptNumber}</span>
                        <StatusBadge map={RECEIPT_STATUS_REAL} value={r.status} className="ml-auto shrink-0" />
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{r.supplier || RECEIPT_SOURCE_REAL[r.sourceType]?.label}</div>
                      <div className="mt-0.5 text-[11px] text-ink2">
                        {r.lines.length} item{r.expectedDate ? ` · ${tanggal(r.expectedDate)}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <GoodsReceiptFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      <GoodsReceiptDetailDrawer receiptId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
    </PageContainer>
  );
}
