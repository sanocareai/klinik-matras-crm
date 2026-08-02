import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import IssueRescheduleDrawer from "@/features/armada/components/IssueRescheduleDrawer.jsx";
import { ISSUE_STATUS } from "@/features/armada/issueStatus.js";
import { customerOf, orderNumberOf } from "@/features/armada/jobStatus.js";

// Kendala & Reschedule — Delivery Tahap 5.
//
// ⚠️ CAKUPAN JUJUR: spesifikasi minta Category/Priority/Reported By/Current
// Owner + tab Escalated/Resolved — tidak satu pun itu punya struktur di
// sistem (bukan ticketing terpisah). Yang dibangun cuma yang nyata: daftar
// job GAGAL (failureReason + failurePhotoUrls, wajib diisi driver sejak
// Phase 2) dan kemampuan BARU menjadwalkan ulangnya — lihat catatan panjang
// di backend/src/routes/armada.js (deriveIssueStatus).
const TABS = [
  { key: "",            label: "Semua" },
  { key: "OPEN",        label: "Belum Dijadwalkan Ulang" },
  { key: "RESCHEDULED", label: "Sudah Dijadwalkan Ulang" },
];

export default function ArmadaIssues() {
  const [tab, setTab] = useState("");
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getIssues(tab || undefined)
      .then((d) => setJobs(d.jobs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && jobs && jobs.length === 0;

  return (
    <PageContainer>
      <PageHeader title="Kendala & Reschedule" subtitle="Job yang gagal terkirim, dan penjadwalan ulangnya." />

      <PageBody>
        <div role="tablist" aria-label="Saring status kendala" className="flex flex-wrap gap-1 border-b border-line pb-2">
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
          {jobs && <span className="ml-auto self-center text-[11.5px] text-ink3">{jobs.length} job</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={AlertTriangle}
              title="Tidak ada job pada tab ini"
              description={tab === "OPEN" ? "Tidak ada job gagal yang menunggu jadwal ulang." : "Coba pilih tab lain."}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR><TH>Job</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Driver</TH><TH>Alasan Gagal</TH><TH>Status</TH></TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={5} cols={6} />}
                    {!loading && jobs?.map((j) => (
                      <TR key={j.id} clickable onClick={() => setSelected(j)}>
                        <TD className="font-semibold text-ink">{j.id.slice(0, 8)}</TD>
                        <TD className="text-ink2">{orderNumberOf(j) || "—"}</TD>
                        <TD truncate>{customerOf(j) || "—"}</TD>
                        <TD className="text-ink2">{j.driver?.name || "—"}</TD>
                        <TD truncate className="text-ink2">{j.failureReason || "—"}</TD>
                        <TD><StatusBadge map={ISSUE_STATUS} value={j.issueStatus} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line md:hidden">
                {!loading && jobs?.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(j)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-ink">{j.id.slice(0, 8)}</span>
                        <span className="ml-auto"><StatusBadge map={ISSUE_STATUS} value={j.issueStatus} /></span>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-ink">{customerOf(j) || "—"}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink2">{j.failureReason || "—"}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <IssueRescheduleDrawer job={selected} onClose={() => setSelected(null)} onChanged={load} />
    </PageContainer>
  );
}
