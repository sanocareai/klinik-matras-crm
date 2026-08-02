import React, { useCallback, useEffect, useState } from "react";
import { Undo2, Plus } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import RevisionRequestDrawer from "@/features/armada/components/RevisionRequestDrawer.jsx";
import RevisionDetailDrawer from "@/features/armada/components/RevisionDetailDrawer.jsx";
import { REVISION_STATUS, REVISION_TRIGGER, customerOfUnit } from "@/features/armada/revisionStatus.js";

// Retur — Delivery Tahap 6. Disebut "Revisi" secara internal (lihat catatan
// panjang di backend/prisma/schema.prisma model UnitRevision): kasur yang
// sudah diantar tapi teksturnya kurang pas (trial 7/30 hari), atau kena
// klaim garansi amblas (10/20 tahun), dibawa kembali, direvisi, diantar
// ulang — diulang sampai customer bilang "yes". BUKAN refund/replace/reject
// seperti "retur" pada umumnya.
const TABS = [
  { key: "",                label: "Semua" },
  { key: "REQUESTED",       label: "Diajukan" },
  { key: "IN_REWORK",       label: "Sedang Direvisi" },
  { key: "REDELIVERED",     label: "Sudah Diantar Ulang" },
  { key: "CONFIRMED",       label: "Selesai" },
];

export default function ArmadaReturns() {
  const [tab, setTab] = useState("");
  const [revisions, setRevisions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [showRequest, setShowRequest] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getRevisions({ status: tab || undefined })
      .then((d) => setRevisions(d.revisions))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && revisions && revisions.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Retur"
        subtitle="Revisi kasur pasca-antar — trial kenyamanan & klaim garansi."
        actions={
          <button
            type="button" onClick={() => setShowRequest(true)}
            className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} /> Ajukan Revisi
          </button>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status revisi" className="flex flex-wrap gap-1 border-b border-line pb-2">
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
          {revisions && <span className="ml-auto self-center text-[11.5px] text-ink3">{revisions.length} revisi</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={Undo2}
              title="Belum ada revisi"
              description={tab === "" ? "Ajukan revisi lewat tombol di atas." : "Coba pilih tab lain."}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR><TH>Unit</TH><TH>Pelanggan</TH><TH>Jenis</TH><TH>Keluhan</TH><TH>Diajukan</TH><TH>Status</TH></TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={5} cols={6} />}
                    {!loading && revisions?.map((r) => (
                      <TR key={r.id} clickable onClick={() => setSelected(r)}>
                        <TD className="font-semibold text-ink">{r.unit?.unitCode}</TD>
                        <TD truncate>{customerOfUnit(r.unit) || "—"}</TD>
                        <TD><StatusBadge map={REVISION_TRIGGER} value={r.trigger} /></TD>
                        <TD truncate className="text-ink2">{r.complaint}</TD>
                        <TD className="whitespace-nowrap text-ink2">{new Date(r.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</TD>
                        <TD><StatusBadge map={REVISION_STATUS} value={r.status} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line md:hidden">
                {!loading && revisions?.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-ink">{r.unit?.unitCode}</span>
                        <span className="ml-auto"><StatusBadge map={REVISION_STATUS} value={r.status} /></span>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-ink">{customerOfUnit(r.unit) || "—"}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink2">{r.complaint}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <RevisionRequestDrawer open={showRequest} onClose={() => setShowRequest(false)} onCreated={load} />
      <RevisionDetailDrawer revision={selected} onClose={() => setSelected(null)} onChanged={load} />
    </PageContainer>
  );
}
