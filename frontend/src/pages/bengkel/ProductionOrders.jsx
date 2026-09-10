import React, { useCallback, useEffect, useState } from "react";
import { Search, Package, Tag, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows, TableEmptyRow } from "@/components/ui/table.jsx";
import Avatar from "@/components/Avatar.jsx";
import {
  formatRupiah, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  paymentStatusVariant,
} from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { JOB_STATUS_REAL } from "@/features/armada/jobStatus.js";
import OrderTimelineDrawer from "@/features/orders/OrderTimelineDrawer.jsx";
import { StatusSelect } from "@/features/orders/StatusSelect.jsx";

// Semua Order — Produksi (D-086, 5 September 2026). Laporan owner: "sales
// suka lupa ubah status order, jadi kenapa gue ingin disemua workspace sales
// crm, delivery, produksi itu ada 'semua order' which means untuk
// masing-masing admin update status ordernya" — halaman ini pasangan
// Bengkel dari pages/armada/ArmadaOrders.jsx (Delivery sudah lebih dulu
// punya sejak D-052/D-078). SATU BARIS = SATU ORDER, endpoint dan kolom
// SAMA PERSIS (GET /api/orders, StatusSelect/OrderTimelineDrawer yang sama)
// — sengaja tidak dibuat "versi Produksi" yang beda kolomnya, supaya "order
// X" tidak pernah punya definisi status yang bisa diam-diam beda antar
// divisi (aturan proyek: satu sumber kebenaran).
//
// Yang beda dari ArmadaOrders.jsx cuma framing halaman (judul/subtitle) dan
// role yang mengaksesnya (PRODUCTION_LEAD, lewat ORDER_WRITE yang
// ditambahkan bareng perubahan ini — lihat backend/src/constants/
// permissions.js). Kalau ArmadaOrders.jsx diubah strukturnya nanti, halaman
// ini kemungkinan besar perlu ikut diubah — belum diekstrak jadi satu
// komponen bersama supaya tidak menyentuh file yang sedang aktif dikerjakan
// sesi lain di waktu yang sama (lihat catatan commit).
const KATEGORI_LABELS = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Baru" };

const KATEGORI_OPTIONS = [
  { value: "LAYANAN", label: "Layanan" },
  { value: "SEWA", label: "Sewa" },
  { value: "BARU", label: "Baru" },
];

const STATUS_OPTIONS = Object.keys(ORDER_STATUS_LABELS).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

function JobChip({ label, job }) {
  if (!job) return <span className="text-[11.5px] text-ink3">—</span>;
  const info = JOB_STATUS_REAL[job.status];
  return (
    <Badge
      variant={info?.tone || "neutral"}
      title={job.driverName ? `${label} · ${job.driverName}` : label}
    >
      {label}: {info?.label || job.status}
    </Badge>
  );
}

function ProduksiChip({ stage }) {
  if (!stage) return <span className="text-[11.5px] text-ink3">—</span>;
  // D-148 (audit konsistensi) — "Belum mulai produksi" (unit sudah diadopsi
  // ke stage engine, cuma belum jalan tahap pertama) dan "Belum diadopsi ke
  // tahap" (unit backfill lama, TIDAK PERNAH masuk stage engine sama sekali
  // — order-nya sendiri bisa saja sudah terkirim lewat alur lama) SENGAJA
  // dibedakan labelnya (lihat routes/orders.js) supaya tidak lagi dibaca
  // seolah "order ini belum dikerjakan" padahal cuma datanya yang lama.
  const netral = stage.label === "Belum mulai produksi" || stage.legacy;
  return (
    <Badge
      variant={netral ? "neutral" : "accent"}
      title={
        stage.mixed
          ? stage.detail.join(", ")
          : stage.legacy
            ? "Order lama dari sebelum sistem tahap produksi dipakai — bukan berarti belum dikerjakan/dikirim"
            : undefined
      }
    >
      {stage.label}{stage.unitCount > 1 && !stage.mixed ? ` (${stage.unitCount} unit)` : ""}
    </Badge>
  );
}

// Kolom Revisi (D-109, 9 September 2026) — ini "keterlibatan Produksi" yang
// hilang di kasus Dewi: sebelumnya satu-satunya cara tahu ada revisi/klaim
// garansi berjalan adalah buka Delivery > Retur, Produksi buta total.
// activeRevision datang dari GET /orders (units.revisions, lihat orders.js).
// Tombol "Tandai Selesai" HANYA muncul untuk IN_REWORK — itu satu-satunya
// transisi yang boleh dilakukan role Produksi (UNIT_STAGE_WRITE) lewat
// PATCH /armada/revisions/:id (lihat guard di armada.js).
const REVISI_LABEL = {
  REQUESTED: "Diajukan", PICKUP_SCHEDULED: "Dijadwalkan Jemput",
  IN_REWORK: "Dikerjakan Ulang", READY_REDELIVER: "Siap Dikirim Ulang",
};
function RevisiChip({ revision, busy, onSelesai }) {
  if (!revision) return <span className="text-[11.5px] text-ink3">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant={revision.status === "READY_REDELIVER" ? "success" : "warning"}>
        {REVISI_LABEL[revision.status] || revision.status}
      </Badge>
      {revision.status === "IN_REWORK" && (
        <button
          type="button" disabled={busy}
          onClick={(e) => { e.stopPropagation(); onSelesai(revision.id); }}
          className="flex items-center gap-1 rounded-btn bg-accentbg px-2 py-1 text-[11px] font-bold text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
          title="Tandai unit ini sudah selesai direvisi, siap dikirim ulang"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Tandai Selesai
        </button>
      )}
    </span>
  );
}

export default function ProductionOrders() {
  const [cari, setCari] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [range, setRange] = useState(() => makeRange("all_time"));
  const [orders, setOrders] = useState(null);
  const [summary, setSummary] = useState(null);
  const [perStatus, setPerStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openOrder, setOpenOrder] = useState(null);
  const [revisiBusyId, setRevisiBusyId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(cari.trim()), 300);
    return () => clearTimeout(t);
  }, [cari]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getOrders({
        search: debounced || undefined,
        category: fKategori || undefined,
        status: fStatus || undefined,
        // KOREKSI (6 September 2026) — laporan owner: cari nama customer
        // spesifik (order sudah Terkirim) hasilnya "Tidak ada order yang
        // cocok". Search itu MAKSUD EKSPLISIT mencari 1 order tertentu,
        // hideFinished tidak boleh diam-diam menyembunyikan hasil yang
        // justru sedang dicari (lihat catatan sama di ArmadaOrders.jsx).
        hideFinished: (fStatus || debounced) ? undefined : "true",
        ...toApiParams(range),
        limit: 300,
      });
      setOrders(res.items || []);
      setSummary(res.summary || null);
      setPerStatus(res.perStatus || []);
    } catch (e) {
      setError(e.message || "Gagal memuat daftar order");
    } finally {
      setLoading(false);
    }
  }, [debounced, fKategori, fStatus, range]);

  useEffect(() => { load(); }, [load]);

  // Backend: PATCH /orders/:id sekarang menerima PRODUCTION_LEAD (ORDER_WRITE
  // ditambahkan bareng perubahan ini, lihat permissions.js) — bukan cuma
  // ADMIN/SALES seperti sebelumnya.
  async function handleStatusChange(order, newStatus) {
    if (newStatus === order.status) return;
    try {
      await api.updateOrder(order.id, { status: newStatus });
      load();
    } catch (err) {
      alert("Gagal ubah status: " + err.message);
    }
  }

  // D-109 (9 September 2026) — quick-action Produksi: tandai revisi IN_REWORK
  // selesai dikerjakan, tanpa pindah ke Delivery > Retur. Backend menerima ini
  // dari UNIT_STAGE_WRITE (permission yang sudah dipegang Kepala/Admin
  // Produksi) HANYA untuk transisi persis ini — lihat guard di armada.js
  // PATCH /revisions/:id.
  async function tandaiSelesaiRevisi(revisionId) {
    setRevisiBusyId(revisionId);
    try {
      await api.updateRevision(revisionId, { status: "READY_REDELIVER" });
      load();
    } catch (err) {
      alert("Gagal menandai revisi selesai: " + err.message);
    } finally {
      setRevisiBusyId(null);
    }
  }

  const siapKirimCount = perStatus.find((s) => s.status === "READY")?.count || 0;

  return (
    <PageContainer>
      <PageHeader
        title="Semua Order"
        subtitle="Pantau seluruh order Sales CRM lintas divisi — Sales, Produksi, Pengambilan/Pengiriman, dan Pembayaran, dalam satu layar."
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button size="sm" variant="neutral" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
          </div>
        }
      />

      <PageBody>
        {summary && (
          <WorkspaceHero
            // D-148 (9 September 2026, audit konsistensi) — tone="blue" DI
            // SINI SENGAJA, bukan lupa mengganti ke "amber" (warna Bengkel).
            // Halaman ini eksplisit "Ringkasan LINTAS DIVISI" (data order dari
            // Sales CRM, bukan cuma milik Bengkel) — kembarannya persis di
            // armada/ArmadaOrders.jsx juga tone="blue" untuk alasan yang sama.
            // Warna divisi (amber/sky/violet) dipakai KHUSUS landing page
            // masing-masing workspace (Bengkel/Gudang/Kendali) yang isinya
            // murni milik divisi itu — JANGAN ikut-ikutan diubah ke warna
            // divisi kalau nanti diaudit ulang.
            tone="blue"
            title="Ringkasan lintas divisi"
            subtitle="Dihitung dari filter yang sedang aktif — bukan cuma 300 baris pertama di tabel."
            health={
              summary.belumLunas > 0
                ? { label: `${formatRupiah(summary.belumLunas)} belum lunas`, tone: "warn" }
                : { label: "Semua lunas", tone: "ok" }
            }
            stats={[
              { label: "Order aktif", value: summary.totalOrderAktif, hint: "sesuai filter" },
              { label: "Nilai order aktif", value: formatRupiah(summary.nilaiOrderAktif) },
              { label: "Siap kirim", value: siapKirimCount, hint: "unit selesai produksi" },
              { label: "Belum lunas", value: formatRupiah(summary.belumLunas), hint: "Finance" },
            ]}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari pelanggan, nomor order, atau HP…"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] text-ink outline-none focus:border-accent"
            />
          </div>
          <FilterDropdown
            value={fKategori}
            onChange={setFKategori}
            options={KATEGORI_OPTIONS}
            placeholder="Semua Kategori"
            icon={Tag}
          />
          <FilterDropdown
            value={fStatus}
            onChange={setFStatus}
            options={STATUS_OPTIONS}
            placeholder="Semua Status"
            icon={Package}
          />
        </div>

        {error && (
          <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>
        )}

        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Pelanggan</TH>
                <TH>Kategori</TH>
                <TH>Status</TH>
                <TH>Produksi</TH>
                <TH>Revisi</TH>
                <TH>Pengambilan</TH>
                <TH>Pengiriman</TH>
                <TH>Pembayaran</TH>
                <TH numeric>Nilai</TH>
                <TH>Tanggal</TH>
              </TR>
            </THead>
            <TBody>
              {loading ? (
                <TableSkeletonRows rows={8} cols={11} />
              ) : orders && orders.length > 0 ? (
                orders.map((o) => (
                  <TR key={o.id} clickable onClick={() => setOpenOrder(o)}>
                    <TD className="font-semibold text-ink">{o.orderNumber || o.id.slice(0, 8)}</TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={o.customerName} size="sm" />
                        <span className="truncate">{o.customerName || "—"}</span>
                        {/* Komplain (D-108, 6 September 2026) — laporan owner: komplain
                            yang dicatat Sales CRM tidak pernah kelihatan di Produksi/
                            Delivery (silo total). Datanya SUDAH ada di respons ini
                            (Order.hasComplaint disertakan apa adanya) — cuma belum
                            pernah ditampilkan di sini. */}
                        {o.hasComplaint && !o.complaintResolvedAt && (
                          <AlertTriangle
                            size={13} className="shrink-0 text-red"
                            title={`Ada komplain: ${o.complaintDetail || "(tanpa detail)"}`}
                          />
                        )}
                      </span>
                    </TD>
                    <TD>{KATEGORI_LABELS[o.category] || o.category}</TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <StatusSelect order={o} onChange={handleStatusChange} />
                    </TD>
                    <TD><ProduksiChip stage={o.productionStage} /></TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      <RevisiChip revision={o.activeRevision} busy={revisiBusyId === o.activeRevision?.id} onSelesai={tandaiSelesaiRevisi} />
                    </TD>
                    <TD><JobChip label="Ambil" job={o.pickupJob} /></TD>
                    <TD><JobChip label="Kirim" job={o.deliveryJob} /></TD>
                    <TD>
                      <Badge variant={paymentStatusVariant(o.paymentStatus)}>
                        {PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus}
                      </Badge>
                    </TD>
                    <TD numeric>{formatRupiah(o.value || 0)}</TD>
                    <TD>{formatTanggalPendek(o.createdAt)}</TD>
                  </TR>
                ))
              ) : (
                <TableEmptyRow colSpan={11}>
                  <EmptyState
                    icon={Package}
                    title="Tidak ada order yang cocok"
                    description="Coba longgarkan filter atau kata kuncinya."
                  />
                </TableEmptyRow>
              )}
            </TBody>
          </Table>
        </TableWrap>
      </PageBody>

      {openOrder && (
        <OrderTimelineDrawer
          order={openOrder}
          onClose={() => setOpenOrder(null)}
          // Produksi tidak masuk konteks Inbox (divisi terpisah) — arahkan
          // ke halaman Pelanggan alih-alih diam menggantung tanpa aksi.
          onOpenChat={(ord) => { window.location.href = `/customers?id=${ord.customerId || ""}`; }}
          onPaymentRecorded={load}
          canEditLunas={false}
          canEditStatus
        />
      )}
    </PageContainer>
  );
}
