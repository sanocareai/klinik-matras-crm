import React, { useCallback, useEffect, useState } from "react";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
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
import MaterialIssueFormModal from "@/features/warehouse/components/MaterialIssueFormModal.jsx";
import MaterialIssueDetailDrawer from "@/features/warehouse/components/MaterialIssueDetailDrawer.jsx";
import { ISSUE_STATUS_REAL, ISSUE_PRIORITY_REAL } from "@/features/warehouse/inventoryReal.js";

// Material Issue — Warehouse Tahap 3. DATA NYATA.
//
// Alur REQUEST → APPROVAL → PICKING → ISSUE. Baris ledger stock_movements
// ISSUE baru ditulis SATU KALI, saat Confirm Issue. Selama status
// APPROVED..PICKED, requestedQty dihitung sebagai Reserved di Stock &
// Material — lihat catatan panjang di schema.prisma & routes/materialIssue.js.
const TABS = [
  { key: "",                label: "Semua" },
  { key: "WAITING_APPROVAL",label: "Waiting Approval" },
  { key: "APPROVED",        label: "Approved" },
  { key: "READY_TO_PICK",   label: "Ready to Pick" },
  { key: "PICKED",          label: "Picked" },
  { key: "ISSUED",          label: "Issued" },
  { key: "CANCELLED",       label: "Cancelled" },
];

const tanggal = (s) => new Date(s).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

export default function WarehouseMaterialIssue() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getMaterialIssues({ status: tab || undefined })
      .then((d) => setRows(d.issues))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && rows && rows.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Material Issue"
        subtitle="Pengeluaran material untuk kebutuhan produksi."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus size={14} /> New Request
            </Button>
          </>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status issue" className="flex flex-wrap gap-1 border-b border-line pb-2">
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
          {rows && <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} request</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={ClipboardList}
              title="Belum ada Material Issue"
              description="Permintaan material dari Production akan tampil di sini."
              action={<Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> New Request</Button>}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Issue ID</TH><TH>Reference</TH><TH>Department</TH><TH>Requested By</TH>
                      <TH numeric>Items</TH><TH>Required</TH><TH>Priority</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={8} />}
                    {!loading && rows?.map((r) => (
                      <TR key={r.id} clickable onClick={() => setSelectedId(r.id)}>
                        <TD className="font-semibold text-ink">{r.issueNumber}</TD>
                        <TD className="text-ink2">{r.sourceReference || "—"}</TD>
                        <TD truncate>{r.department || "—"}</TD>
                        <TD className="text-ink2">{r.requestedBy?.name || "—"}</TD>
                        <TD numeric>{r.lines.length}</TD>
                        <TD className="whitespace-nowrap text-ink2">{r.requiredDate ? tanggal(r.requiredDate) : "—"}</TD>
                        <TD><StatusBadge map={ISSUE_PRIORITY_REAL} value={r.priority} /></TD>
                        <TD><StatusBadge map={ISSUE_STATUS_REAL} value={r.status} /></TD>
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
                        <span className="text-[12.5px] font-semibold text-ink">{r.issueNumber}</span>
                        <StatusBadge map={ISSUE_STATUS_REAL} value={r.status} className="ml-auto shrink-0" />
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{r.department || r.sourceReference || "—"}</div>
                      <div className="mt-0.5 text-[11px] text-ink2">
                        {r.lines.length} item{r.requiredDate ? ` · ${tanggal(r.requiredDate)}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <MaterialIssueFormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={load} />
      <MaterialIssueDetailDrawer issueId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
    </PageContainer>
  );
}
