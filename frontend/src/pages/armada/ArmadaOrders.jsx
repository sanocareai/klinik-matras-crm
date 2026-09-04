import React, { useCallback, useEffect, useState } from "react";
import { Search, Package, Tag, RefreshCw, Factory, CreditCard } from "lucide-react";
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
  orderStatusVariant, paymentStatusVariant,
} from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { JOB_STATUS_REAL } from "@/features/armada/jobStatus.js";
import OrderTimelineDrawer from "@/features/orders/OrderTimelineDrawer.jsx";

// Semua Order (D-052, 4 September 2026) — laporan owner: "gue mau yang di
// delivery semua order yang ada di sales/crm ada juga di semua divisi agar
// semua bisa pantau semua prosesnya". Sebelum halaman ini, Delivery Hub cuma
// menunjukkan order yang SUDAH punya Job (pickup/delivery) — order yang
// masih di tahap Diproses TANPA job aktif (kasus BARU, lihat D-051) sama
// sekali tidak kelihatan di Delivery, dispatcher harus pindah ke Sales CRM
// kalau mau tahu "order X sekarang sampai mana".
//
// Halaman ini MENAMBA cara memantau, bukan mengganti — "Jadwal &
// Penugasan" (job-sentris, buat menugaskan driver) tetap tempatnya sendiri.
// Di sini SATU BARIS = SATU ORDER, dari sudut pandang lintas-divisi: status
// order (Sales/Produksi), plus ringkasan job pengambilan/pengiriman kalau ada.
//
// Endpoint dipakai APA ADANYA (GET /api/orders, sama persis dengan
// pages/Orders.jsx Sales CRM) — SATU sumber data untuk dua divisi, supaya
// "order X" tidak pernah punya dua definisi status yang bisa diam-diam beda.
//
// REDESIGN + LINTAS DIVISI PENUH (D-078, 5 September 2026) — laporan owner:
// "redesign dan sempurnakan ui semua order yang terkoneksi dengan semua
// divisi". Sebelumnya halaman ini baru menyambungkan 2 dari 4 divisi
// operasional (Sales via order.status/pipelineStage, Delivery via
// pickup/deliveryJob) — Produksi (tahap unit di Bengkel) dan Finance
// (paymentStatus) SUDAH ADA di data API tapi TIDAK PERNAH ditampilkan di
// tabel ini sama sekali. Tiga perubahan:
// 1. Kolom baru "Produksi" (tahap unit PERSIS, bukan cuma bucket kasar
//    order.status — lihat `productionStage` dari GET /orders, dihitung di
//    routes/orders.js dari Unit.currentStage) dan "Pembayaran" (badge
//    BELUM_BAYAR/DP/LUNAS, sebelumnya ada di data tapi tidak ditampilkan).
// 2. KPI strip (WorkspaceHero, pola yang sama dengan Papan/Dashboard
//    Armada) dari `summary`/`perStatus` yang backend SUDAH hitung tapi
//    sebelumnya dibuang begitu saja oleh halaman ini (`res.items` doang
//    yang dipakai) — total order aktif, nilai aktif, belum lunas (Finance),
//    siap kirim (Delivery/Produksi).
// 3. Badge status pindah dari warna hardcode (STATUS_TONE lama) ke
//    <Badge variant={orderStatusVariant(...)}> — SATU sumber kebenaran
//    warna status yang sama dipakai Orders.jsx Sales CRM, otomatis ikut
//    tema kaca terang/gelap Delivery Hub (dh-table, lihat delivery-dark/
//    light.css) alih-alih tabel polos sebelumnya.
const KATEGORI_LABELS = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Baru" };

const KATEGORI_OPTIONS = [
  { value: "LAYANAN", label: "Layanan" },
  { value: "SEWA", label: "Sewa" },
  { value: "BARU", label: "Baru" },
];

const STATUS_OPTIONS = Object.keys(ORDER_STATUS_LABELS).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

// D-079 (5 September 2026) — laporan owner: chip Produksi/Pengambilan/
// Pengiriman "masih pakai UI lama" (pil `bg-inset` polos, beda dari Badge
// yang dipakai kolom Status/Pembayaran) DAN menampilkan enum job MENTAH
// ("Ambil: EN_ROUTE", "Ambil: UNSCHEDULED") — tidak terbaca untuk siapa pun
// yang bukan developer. Diganti <Badge> yang SAMA persis dipakai kolom
// lain (satu bahasa visual di seluruh tabel), label lewat JOB_STATUS_REAL
// (SATU sumber kebenaran label+warna job — sudah dipakai Armada.jsx/
// JobDetailDrawer, bukan peta baru yang bisa drift).
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

// Chip Produksi (D-078, dipindah ke <Badge> D-079) — lihat `productionStage`
// di routes/orders.js untuk aturan agregasinya. `mixed` (beberapa unit di
// tahap berbeda) dapat title tooltip berisi daftar tahapnya, supaya masih
// bisa diperiksa tanpa buka drawer — tapi TIDAK menjejalkan semuanya ke
// chip (bisa panjang sekali untuk order banyak unit).
function ProduksiChip({ stage }) {
  if (!stage) return <span className="text-[11.5px] text-ink3">—</span>;
  const belumMulai = stage.label === "Belum mulai produksi";
  return (
    <Badge
      variant={belumMulai ? "neutral" : "accent"}
      title={stage.mixed ? stage.detail.join(", ") : undefined}
    >
      {stage.label}{stage.unitCount > 1 && !stage.mixed ? ` (${stage.unitCount} unit)` : ""}
    </Badge>
  );
}

export default function ArmadaOrders() {
  const [cari, setCari] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fStatus, setFStatus] = useState("");
  // Date range picker (D-085, 5 September 2026) — laporan owner: "di tab
  // 'semua order' bisa tambahkan tanggal juga yang di set default 'semua
  // tanggal'". Default "all_time" PERSIS diminta ("semua tanggal" dulu,
  // bukan 30 hari terakhir seperti kebanyakan Laporan lain) — order lama
  // yang MASIH nyangkut di produksi (belum Terkirim) tidak boleh hilang
  // dari pandangan cuma karena tanggal `createdAt`-nya sudah lewat jendela
  // waktu, sama semangatnya dengan `hideFinished` di bawah (yang menyaring
  // berdasarkan STATUS, bukan tanggal). GET /orders SUDAH dukung `from`/
  // `to` (filter createdAt) — cuma belum pernah dipakai halaman ini.
  const [range, setRange] = useState(() => makeRange("all_time"));
  const [orders, setOrders] = useState(null);
  const [summary, setSummary] = useState(null);
  const [perStatus, setPerStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openOrder, setOpenOrder] = useState(null);

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
        // Default (tanpa filter status eksplisit): sembunyikan yang sudah
        // Terkirim/Dibatalkan — dispatcher paling sering perlu tahu order
        // yang MASIH berjalan, bukan riwayat yang sudah tuntas. Sama pola
        // dengan pages/Orders.jsx.
        hideFinished: fStatus ? undefined : "true",
        ...toApiParams(range), // {} untuk preset "Semua" — tanpa filter tanggal
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
        {/* KPI lintas divisi (D-078) — angka NYATA dari `summary`/`perStatus`
            (GET /orders sudah menghitungnya, sebelumnya dibuang oleh halaman
            ini). `belumLunas` mewakili Finance, `siapKirimCount` mewakili
            titik temu Produksi→Delivery (unit selesai, tinggal dijadwalkan). */}
        {summary && (
          <WorkspaceHero
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

        {/* dh-table (D-078) — TableWrap default (`rounded-2xl bg-surface`)
            TIDAK cocok pola seleksi kaca otomatis Delivery Hub
            ([class*="rounded-card"]/.card, lihat delivery-dark.css §4d),
            jadi tabel ini tetap tampil polos walau sudah dikelilingi panel
            kaca lain — sama akar masalahnya dengan job/stop card sebelum
            dikasih .dh-job-card/.dh-stop-card. Kelas ini yang menyamakannya. */}
        <TableWrap className="dh-table">
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Pelanggan</TH>
                <TH>Kategori</TH>
                <TH>Status</TH>
                <TH>Produksi</TH>
                <TH>Pengambilan</TH>
                <TH>Pengiriman</TH>
                <TH>Pembayaran</TH>
                <TH numeric>Nilai</TH>
                <TH>Tanggal</TH>
              </TR>
            </THead>
            <TBody>
              {loading ? (
                <TableSkeletonRows rows={8} cols={10} />
              ) : orders && orders.length > 0 ? (
                orders.map((o) => (
                  <TR key={o.id} clickable onClick={() => setOpenOrder(o)}>
                    <TD className="font-semibold text-ink">{o.orderNumber || o.id.slice(0, 8)}</TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={o.customerName} size="sm" />
                        <span className="truncate">{o.customerName || "—"}</span>
                      </span>
                    </TD>
                    <TD>{KATEGORI_LABELS[o.category] || o.category}</TD>
                    <TD>
                      <Badge variant={orderStatusVariant(o.status)}>
                        {ORDER_STATUS_LABELS[o.status] || o.status}
                      </Badge>
                    </TD>
                    <TD><ProduksiChip stage={o.productionStage} /></TD>
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
                <TableEmptyRow colSpan={10}>
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
          // Dispatcher tidak masuk konteks Inbox (divisi terpisah) — arahkan
          // ke halaman Pelanggan alih-alih diam menggantung tanpa aksi.
          onOpenChat={(ord) => { window.location.href = `/customers?id=${ord.customerId || ""}`; }}
          onPaymentRecorded={load}
          canEditLunas={false}
        />
      )}
    </PageContainer>
  );
}
