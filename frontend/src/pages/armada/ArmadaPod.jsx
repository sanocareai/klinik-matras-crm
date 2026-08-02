import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import PodReviewDrawer from "@/features/armada/components/PodReviewDrawer.jsx";
import { POD_STATUS } from "@/features/armada/podStatus.js";
import { customerOf, orderNumberOf } from "@/features/armada/jobStatus.js";

// Proof of Delivery — Delivery Tahap 4.
//
// ⚠️ SISI VERIFIKASI, bukan sumber data baru — data NYATA (tidak ada badge
// "Contoh"). Foto & tanda tangan sudah diunggah driver lewat aplikasinya
// sejak Phase 2; halaman ini yang baru: admin/dispatcher meninjaunya.
//
// ⚠️ TIDAK ADA "Checklist Penyelesaian" (8 item dari spesifikasi) DAN TIDAK
// ADA "Nama Penerima" — diperiksa langsung ke pages/DriverJobs.jsx &
// backend POST /jobs/:id/complete: keduanya TIDAK PERNAH dikumpulkan
// aplikasi driver. Menampilkan checklist yang tidak pernah bisa dicentang
// siapa pun lebih menyesatkan daripada tidak menampilkannya — konsisten
// dengan aturan yang dipegang sejak Tahap 1 (jangan mengarang struktur
// data yang tidak benar-benar terisi).
const TABS = [
  { key: "",               label: "Semua" },
  { key: "INCOMPLETE",     label: "Belum Lengkap" },
  { key: "PENDING_REVIEW", label: "Menunggu Verifikasi" },
  { key: "VERIFIED",       label: "Terverifikasi" },
  { key: "REJECTED",       label: "Ditolak" },
];

export default function ArmadaPod() {
  const [tab, setTab] = useState("");
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getPodJobs(tab || undefined)
      .then((d) => setJobs(d.jobs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const kosong = !loading && jobs && jobs.length === 0;

  return (
    <PageContainer>
      <PageHeader title="Proof of Delivery" subtitle="Verifikasi foto dan tanda tangan penyelesaian job." />

      <PageBody>
        <div role="tablist" aria-label="Saring status POD" className="flex flex-wrap gap-1 border-b border-line pb-2">
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
              icon={CheckCircle2}
              title="Tidak ada job pada tab ini"
              description={tab === "PENDING_REVIEW" ? "Semua bukti sudah ditinjau." : "Coba pilih tab lain."}
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR><TH>Job</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Driver</TH><TH>Selesai</TH><TH>Foto</TH><TH>Tanda Tangan</TH><TH>Status</TH></TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={5} cols={8} />}
                    {!loading && jobs?.map((j) => (
                      <TR key={j.id} clickable onClick={() => setSelected(j)}>
                        <TD className="font-semibold text-ink">{j.id.slice(0, 8)}</TD>
                        <TD className="text-ink2">{orderNumberOf(j) || "—"}</TD>
                        <TD truncate>{customerOf(j) || "—"}</TD>
                        <TD className="text-ink2">{j.driver?.name || "—"}</TD>
                        <TD className="whitespace-nowrap text-ink2">
                          {j.completedAt ? new Date(j.completedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—"}
                        </TD>
                        <TD numeric>{j.proofPhotoUrls?.length || 0}</TD>
                        <TD>{j.signatureUrl ? "Ada" : "—"}</TD>
                        <TD><StatusBadge map={POD_STATUS} value={j.derivedPodStatus} /></TD>
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
                        <span className="ml-auto"><StatusBadge map={POD_STATUS} value={j.derivedPodStatus} /></span>
                      </div>
                      <div className="mt-1 truncate text-[13px] text-ink">{customerOf(j) || "—"}</div>
                      <div className="mt-0.5 text-[11px] text-ink2">
                        {j.proofPhotoUrls?.length || 0} foto · {j.signatureUrl ? "ada TTD" : "tanpa TTD"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      <PodReviewDrawer job={selected} onClose={() => setSelected(null)} onChanged={load} />
    </PageContainer>
  );
}
