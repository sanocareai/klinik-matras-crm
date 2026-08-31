import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { formatTanggalJam } from "@/utils/formatDate.js";
import { STAGE_LOG_STATUS } from "@/features/bengkel/unitStatus.js";

// Antrean QC — Production Tahap 3. Daftar unit yang currentStage-nya
// gerbang QC (requiresQc=true), dari GET /production/qc-queue.
//
// Aksi mencatat verdict TETAP di halaman Detail Unit (satu tempat untuk
// semua aksi tahap — start/complete/fail/skip/QC), supaya tidak ada 2
// implementasi form yang bisa saling drift. Halaman ini murni triase:
// "siapa yang sedang menunggu diperiksa", klik baris untuk membuka
// detail dan mencatat hasilnya di sana.
const QC_STATE_STATUS = {
  READY: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
};

export default function ProductionQcQueue() {
  const navigate = useNavigate();
  const [units, setUnits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getQcQueue()
      .then((d) => setUnits(d.units))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && units && units.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="QC Inspection"
        subtitle="Unit yang sedang menunggu Uji Berat Badan (D-009)."
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={ShieldCheck}
              title="Tidak ada unit menunggu QC"
              description="Belum ada unit yang tahapnya sedang berada di gerbang Uji Berat Badan."
            />
          ) : (
            <>
              <TableWrap className="hidden lg:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Kode Unit</TH><TH>Order</TH><TH>Pelanggan</TH>
                      <TH>Layanan</TH><TH>Tahap QC</TH><TH>Menunggu Sejak</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={6} cols={7} />}
                    {!loading && units?.map((u) => (
                      <TR key={u.id} clickable onClick={() => navigate(`/bengkel/units/${u.id}`)}>
                        <TD className="font-semibold text-ink">{u.unitCode}</TD>
                        <TD className="text-ink2">{u.order?.orderNumber || "—"}</TD>
                        <TD truncate>{u.order?.customer?.name || "—"}</TD>
                        <TD truncate className="text-ink2">{u.service?.labelId || "—"}</TD>
                        <TD truncate className="text-ink2">{u.currentStage?.labelId || "—"}</TD>
                        <TD className="whitespace-nowrap text-ink2">{formatTanggalJam(u.sinceAt)}</TD>
                        <TD>
                          <Badge variant={STAGE_LOG_STATUS[QC_STATE_STATUS[u.qcState]]?.tone || "neutral"}>
                            {STAGE_LOG_STATUS[QC_STATE_STATUS[u.qcState]]?.label || u.qcState}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line lg:hidden">
                {!loading && units?.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/bengkel/units/${u.id}`)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{u.unitCode}</span>
                        <Badge variant={STAGE_LOG_STATUS[QC_STATE_STATUS[u.qcState]]?.tone || "neutral"} className="ml-auto shrink-0">
                          {STAGE_LOG_STATUS[QC_STATE_STATUS[u.qcState]]?.label || u.qcState}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{u.order?.customer?.name || "—"}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink2">
                        {u.order?.orderNumber || "—"}{u.currentStage?.labelId && ` · ${u.currentStage.labelId}`}
                        {` · ${formatTanggalJam(u.sinceAt)}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
