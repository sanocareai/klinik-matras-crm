import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Camera, PenLine } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams, formatRangeText } from "@/lib/dateRange.js";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import Avatar from "@/components/Avatar.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import PodReviewDrawer from "@/features/armada/components/PodReviewDrawer.jsx";
import { POD_STATUS } from "@/features/armada/podStatus.js";
import { customerOf, orderNumberOf, jobLabelOf, JOB_TYPE_REAL } from "@/features/armada/jobStatus.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";

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
//
// REDESIGN + FILTER TANGGAL (D-085, 5 September 2026) — laporan owner:
// "redesign proof of delivery juga, kita buat lebih profesional, detail
// dan jangan lupa tambahkan tanggal seperti yang lain". Empat perubahan:
// 1. DateRangePicker (default "Semua" — konsisten dengan Semua Order,
//    D-078/D-085) memfilter `scheduledDate` di backend (GET /armada/pod
//    ?from=&to=). SENGAJA scheduledDate, bukan completedAt — lihat
//    catatan panjang di routes/armada.js kenapa: supaya tab "Belum
//    Lengkap" (job yang PERNAH menunggu, belum tentu completedAt terisi)
//    tidak selalu kosong begitu rentang dipersempit.
// 2. Data diambil SEKALI (tanpa `status` di query) lalu tab difilter DI
//    KLIEN dari satu dataset yang sama — sebelumnya tab memicu request
//    baru ke backend yang toh menghitung derivedPodStatus dari SELURUH
//    baris di setiap panggilan (kerja ulang percuma). Efek sampingnya
//    JUSTRU bagus: KPI strip di bawah bisa menghitung count PER STATUS
//    dari dataset yang sama, tidak ikut berubah saat tab diganti.
// 3. KPI strip (WorkspaceHero, pola sama dengan Semua Order/Papan) —
//    angka NYATA dari dataset yang sedang termuat: total, belum lengkap,
//    menunggu verifikasi, ditolak (paling butuh perhatian).
// 4. Tabel diperkaya: avatar pelanggan, chip tipe job (Pengambilan/
//    Pengiriman), kolom Tanggal (scheduledDate, terpisah dari Selesai/
//    completedAt — dua tanggal itu beda arti), DAN thumbnail foto
//    pertama (bukan cuma angka "3") supaya bisa sekilas menilai tanpa
//    buka drawer setiap baris. `.dh-table` (kaca, sama pola dengan Semua
//    Order) menggantikan tabel polos sebelumnya.
const TABS = [
  { key: "",               label: "Semua" },
  { key: "INCOMPLETE",     label: "Belum Lengkap" },
  { key: "PENDING_REVIEW", label: "Menunggu Verifikasi" },
  { key: "VERIFIED",       label: "Terverifikasi" },
  { key: "REJECTED",       label: "Ditolak" },
];

// Thumbnail foto pertama + badge "+N" kalau lebih dari satu — jauh lebih
// cepat dinilai sekilas dibanding angka polos. Placeholder kotak putus-putus
// (bukan kosong total) kalau belum ada foto sama sekali, supaya kolom ini
// tetap punya lebar konsisten dan "belum ada foto" terbaca sebagai FAKTA,
// bukan sel yang gagal render.
function FotoThumb({ job }) {
  const urls = job.proofPhotoUrls || [];
  if (urls.length === 0) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-btn border border-dashed border-border text-ink3">
        <Camera size={13} />
      </div>
    );
  }
  return (
    <div className="relative h-9 w-9 shrink-0">
      <img src={urls[0]} alt="" className="h-9 w-9 rounded-btn border border-border object-cover" />
      {urls.length > 1 && (
        <span className="absolute -bottom-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ink px-1 text-[9px] font-bold text-base">
          +{urls.length - 1}
        </span>
      )}
    </div>
  );
}

export default function ArmadaPod() {
  const [tab, setTab] = useState("");
  const [range, setRange] = useState(() => makeRange("all_time"));
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getPodJobs(toApiParams(range))
      .then((d) => setJobs(d.jobs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // Hitungan PER STATUS dari dataset yang sedang termuat — dipakai tab
  // (badge jumlah, opsional) DAN KPI strip. Dihitung sekali di sini,
  // bukan diam-diam berbeda antara tab dan hero.
  const counts = useMemo(() => {
    const c = { "": jobs?.length || 0, INCOMPLETE: 0, PENDING_REVIEW: 0, VERIFIED: 0, REJECTED: 0 };
    for (const j of jobs || []) c[j.derivedPodStatus] = (c[j.derivedPodStatus] || 0) + 1;
    return c;
  }, [jobs]);

  const filtered = tab ? (jobs || []).filter((j) => j.derivedPodStatus === tab) : jobs;
  const kosong = !loading && filtered && filtered.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title="Proof of Delivery"
        subtitle="Verifikasi foto dan tanda tangan penyelesaian job."
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <PageBody>
        {jobs && (
          <WorkspaceHero
            tone="blue"
            title="Ringkasan verifikasi"
            subtitle={`Job pada ${formatRangeText(range)} yang relevan ditinjau — bukan sedang berjalan/belum berangkat.`}
            health={
              counts.REJECTED > 0
                ? { label: `${counts.REJECTED} bukti ditolak — perlu ditindaklanjuti`, tone: "warn" }
                : counts.PENDING_REVIEW > 0
                  ? { label: `${counts.PENDING_REVIEW} menunggu verifikasi`, tone: "warn" }
                  : { label: "Semua bukti sudah ditinjau", tone: "ok" }
            }
            stats={[
              { label: "Total Job", value: counts[""] },
              { label: "Belum Lengkap", value: counts.INCOMPLETE, hint: "belum selesai / tanpa foto" },
              { label: "Menunggu Verifikasi", value: counts.PENDING_REVIEW },
              { label: "Ditolak", value: counts.REJECTED },
            ]}
          />
        )}

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
              {t.label}{jobs && ` (${counts[t.key]})`}
            </button>
          ))}
          {filtered && <span className="ml-auto self-center text-[11.5px] text-ink3">{filtered.length} job</span>}
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {/* Card SUDAH otomatis kaca (class `rounded-card` bawaannya cocok
            seleksi wildcard Delivery Hub) — beda dari TableWrap.jsx polos
            (rounded-2xl) yang butuh `.dh-table` eksplisit di halaman lain
            (Semua Order). Di sini TableWrap dipasang DI DALAM Card yang
            sudah kaca, jadi tidak perlu kaca kedua. */}
        <Card className="overflow-hidden p-0">
          {loading ? (
            <div className="p-4"><TableSkeletonRows rows={6} cols={9} /></div>
          ) : kosong ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tidak ada job pada tab ini"
              description={
                tab === "PENDING_REVIEW"
                  ? "Semua bukti sudah ditinjau."
                  : `Coba pilih tab lain atau ubah rentang tanggal (sekarang: ${formatRangeText(range)}).`
              }
            />
          ) : (
            <>
              <TableWrap className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Job</TH><TH>Order</TH><TH>Pelanggan</TH><TH>Tipe</TH><TH>Driver</TH>
                      <TH>Tanggal</TH><TH>Selesai</TH><TH>Bukti</TH><TH>TTD</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered?.map((j) => (
                      <TR key={j.id} clickable onClick={() => setSelected(j)}>
                        <TD className="font-semibold text-ink">{jobLabelOf(j)}</TD>
                        <TD className="text-ink2">{orderNumberOf(j) || "—"}</TD>
                        <TD>
                          <span className="flex items-center gap-2">
                            <Avatar name={customerOf(j) || "?"} size="sm" gradient className="h-6 w-6 shrink-0 text-[9px]" />
                            <span className="truncate">{customerOf(j) || "—"}</span>
                          </span>
                        </TD>
                        <TD>
                          <span className="rounded-chip bg-inset px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
                            {JOB_TYPE_REAL[j.type]?.label || j.type}
                          </span>
                        </TD>
                        <TD className="text-ink2">{j.driver?.name || "—"}</TD>
                        <TD className="whitespace-nowrap text-ink2">{j.scheduledDate ? formatTanggalPendek(j.scheduledDate) : "—"}</TD>
                        <TD className="whitespace-nowrap text-ink2">{j.completedAt ? formatTanggalPendek(j.completedAt) : "—"}</TD>
                        <TD><FotoThumb job={j} /></TD>
                        <TD>{j.signatureUrl ? <PenLine size={15} className="text-green" /> : <span className="text-ink3">—</span>}</TD>
                        <TD><StatusBadge map={POD_STATUS} value={j.derivedPodStatus} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line md:hidden">
                {filtered?.map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(j)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <FotoThumb job={j} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink">{customerOf(j) || "—"}</span>
                          <span className="ml-auto shrink-0"><StatusBadge map={POD_STATUS} value={j.derivedPodStatus} /></span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink3">
                          <span className="font-mono">{jobLabelOf(j)}</span>
                          <span aria-hidden>·</span>
                          <span>{JOB_TYPE_REAL[j.type]?.label || j.type}</span>
                          {j.scheduledDate && (<><span aria-hidden>·</span><span>{formatTanggalPendek(j.scheduledDate)}</span></>)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink2">
                          {j.driver?.name || "Belum ada driver"} · {j.proofPhotoUrls?.length || 0} foto · {j.signatureUrl ? "ada TTD" : "tanpa TTD"}
                        </div>
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
