import React, { useCallback, useEffect, useState } from "react";
import { TrendingUp, Plus, RefreshCw, Download } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { exportToCSV } from "@/utils/export.js";
import StatusBadge from "@/features/warehouse/components/StatusBadge.jsx";
import ReplenishmentFormModal from "@/features/warehouse/components/ReplenishmentFormModal.jsx";
import ReplenishmentDetailDrawer from "@/features/warehouse/components/ReplenishmentDetailDrawer.jsx";
import { REPLENISHMENT_STATUS_REAL, REPLENISHMENT_SOURCE_REAL } from "@/features/warehouse/inventoryReal.js";

// Replenishment — Warehouse Tahap 7. DATA NYATA.
//
// Saran (Suggested) DIHITUNG on-the-fly dari available ≤ reorderPoint,
// TIDAK PERNAH disimpan sebagai baris — baru jadi ReplenishmentRequest
// nyata begitu "Create Request" diklik. Tidak ada tab "Suggested" di
// tabel bawah karena bukan status baris sungguhan; sarannya tampil
// sebagai section terpisah di atas. Lihat schema.prisma.
const TABS = [
  { key: "",               label: "Semua" },
  { key: "DRAFT",          label: "Draft" },
  { key: "WAITING_APPROVAL",label: "Waiting Approval" },
  { key: "APPROVED",       label: "Approved" },
  { key: "ORDERED",        label: "Ordered" },
  { key: "COMPLETED",      label: "Completed" },
  { key: "REJECTED",       label: "Rejected" },
];

export default function WarehouseReplenishment() {
  const [suggestions, setSuggestions] = useState(null);
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const loadSuggestions = useCallback(() => {
    api.getReplenishmentSuggestions().then((d) => setSuggestions(d.suggestions)).catch(() => setSuggestions([]));
  }, []);
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getReplenishmentRequests({ status: tab || undefined })
      .then((d) => setRows(d.requests)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  function refreshSemua() { load(); loadSuggestions(); }
  function buatDariSaran(s) { setPrefill(s); setFormOpen(true); }
  function buatManual() { setPrefill(null); setFormOpen(true); }

  function ekspor() {
    if (!rows || rows.length === 0) return;
    exportToCSV(rows.map((r) => ({
      "Request ID": r.requestNumber,
      Item: r.material.code,
      "Current Stock": r.currentStockSnapshot,
      "Minimum Stock": r.minimumStockSnapshot ?? "",
      "Suggested Quantity": r.suggestedQty,
      "Required Date": r.requiredDate || "",
      Source: REPLENISHMENT_SOURCE_REAL[r.source]?.label,
      Supplier: r.supplier || "",
      Priority: r.priority,
      Status: REPLENISHMENT_STATUS_REAL[r.status]?.label,
    })), "replenishment-requests");
  }

  const kosong = !loading && rows && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Replenishment"
        subtitle="Saran restok berdasarkan minimum stock, dan permintaan yang perlu ditinjau."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={refreshSemua} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
            <Button variant="secondary" size="sm" onClick={ekspor} disabled={!rows?.length}>
              <Download size={14} /> Export
            </Button>
            <Button size="sm" onClick={buatManual}><Plus size={14} /> Manual Request</Button>
          </>
        }
      />

      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Suggested</CardTitle>
            <CardDescription>Item dengan stok tersedia sudah di titik atau di bawah reorder point.</CardDescription>
          </CardHeader>
          {suggestions === null ? (
            <div className="px-5 pb-5"><div className="h-16 animate-pulse rounded-btn bg-inset" /></div>
          ) : suggestions.length === 0 ? (
            <div className="px-5 pb-5">
              <p className="text-[12.5px] text-ink3">Tidak ada item yang perlu direstok saat ini.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {suggestions.map((s) => (
                <li key={s.materialId} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink">{s.code} — {s.name}</p>
                    <p className="text-[11px] text-ink3">
                      Available {s.available} / Reorder Point {s.reorderPoint}
                      {s.reorderQty != null && ` · Suggested Qty ${s.reorderQty}`}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => buatDariSaran(s)}>Create Request</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div role="tablist" aria-label="Saring status request" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              {t.label}
            </button>
          ))}
          {rows && <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} request</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState icon={TrendingUp} title="Belum ada Replenishment Request" description="Buat dari saran di atas, atau ajukan manual."
              action={<Button size="sm" onClick={buatManual}><Plus size={14} /> Manual Request</Button>} />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Request ID</TH><TH>Item</TH><TH numeric>Current</TH><TH numeric>Minimum</TH>
                    <TH numeric>Suggested</TH><TH>Required</TH><TH>Source</TH><TH>Supplier</TH><TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {loading && <TableSkeletonRows rows={6} cols={9} />}
                  {!loading && rows?.map((r) => (
                    <TR key={r.id} clickable onClick={() => setSelectedId(r.id)}>
                      <TD className="font-semibold text-ink">{r.requestNumber}</TD>
                      <TD truncate>{r.material.code}</TD>
                      <TD numeric className="text-ink3">{r.currentStockSnapshot}</TD>
                      <TD numeric className="text-ink3">{r.minimumStockSnapshot ?? "—"}</TD>
                      <TD numeric className="font-semibold text-ink">{r.suggestedQty}</TD>
                      <TD className="whitespace-nowrap text-ink2">{r.requiredDate ? new Date(r.requiredDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—"}</TD>
                      <TD className="whitespace-nowrap text-ink2">{REPLENISHMENT_SOURCE_REAL[r.source]?.label}</TD>
                      <TD className="text-ink2">{r.supplier || "—"}</TD>
                      <TD><StatusBadge map={REPLENISHMENT_STATUS_REAL} value={r.status} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </PageBody>

      <ReplenishmentFormModal open={formOpen} prefill={prefill} onClose={() => setFormOpen(false)} onCreated={refreshSemua} />
      <ReplenishmentDetailDrawer requestId={selectedId} onClose={() => setSelectedId(null)} onChanged={refreshSemua} />
    </PageContainer>
  );
}
