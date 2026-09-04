import React, { useCallback, useEffect, useState } from "react";
import { Search, Package, Tag, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows, TableEmptyRow } from "@/components/ui/table.jsx";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { formatRupiah, ORDER_STATUS_LABELS } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import OrderTimelineDrawer from "@/features/orders/OrderTimelineDrawer.jsx";

// Semua Order (D-052, 4 September 2026) — laporan owner: "gue mau yang di
// delivery semua order yang ada di sales/crm ada juga di semua divisi agar
// semua bisa pantau semua prosesnya". Sebelum halaman ini, Delivery Hub cuma
// menunjukkan order yang SUDAH punya Job (pickup/delivery) — order yang
// masih di tahap Diproses TANPA job aktif (kasus BARU, lihat D-051) sama
// sekali tidak kelihatan di Delivery, dispatcher harus pindah ke Sales CRM
// kalau mau tahu "order X sekarang sampai mana".
//
// Halaman ini MENAMBAH cara memantau, bukan mengganti — "Jadwal &
// Penugasan" (job-sentris, buat menugaskan driver) tetap tempatnya sendiri.
// Di sini SATU BARIS = SATU ORDER, dari sudut pandang lintas-divisi: status
// order (Sales/Produksi), plus ringkasan job pickup/delivery kalau ada.
//
// Endpoint dipakai APA ADANYA (GET /api/orders, sama persis dengan
// pages/Orders.jsx Sales CRM) — SATU sumber data untuk dua divisi, supaya
// "order X" tidak pernah punya dua definisi status yang bisa diam-diam beda.
// TIDAK menambah endpoint baru di sisi backend.
const KATEGORI_LABELS = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Baru" };

const STATUS_TONE = {
  PENDING:    "bg-orangebg text-orange",
  PICKUP:     "bg-accentbg text-accent",
  PROCESSING: "bg-accentbg text-accent",
  READY:      "bg-accentbg text-accent",
  DELIVERED:  "bg-greenbg text-green",
  CANCELLED:  "bg-redbg text-red",
};

const KATEGORI_OPTIONS = [
  { value: "LAYANAN", label: "Layanan" },
  { value: "SEWA", label: "Sewa" },
  { value: "BARU", label: "Baru" },
];

const STATUS_OPTIONS = Object.keys(ORDER_STATUS_LABELS).map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

function JobChip({ label, job }) {
  if (!job) return <span className="text-[11.5px] text-ink3">—</span>;
  return (
    <span
      title={job.driverName ? `${label} · ${job.driverName}` : label}
      className="inline-flex items-center gap-1 rounded-full bg-inset px-2 py-0.5 text-[11px] font-semibold text-ink2"
    >
      {label}: {job.status}
    </span>
  );
}

export default function ArmadaOrders() {
  const [cari, setCari] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [orders, setOrders] = useState(null);
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
        limit: 300,
      });
      setOrders(res.items || []);
    } catch (e) {
      setError(e.message || "Gagal memuat daftar order");
    } finally {
      setLoading(false);
    }
  }, [debounced, fKategori, fStatus]);

  useEffect(() => { load(); }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Semua Order"
        subtitle="Pantau seluruh order Sales CRM dari sisi Delivery — tahap sekarang & job pengambilan/pengiriman, kalau ada."
        actions={
          <Button size="sm" variant="neutral" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody>
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
                <TH>Pengambilan</TH>
                <TH>Pengiriman</TH>
                <TH numeric>Nilai</TH>
                <TH>Tanggal</TH>
              </TR>
            </THead>
            <TBody>
              {loading ? (
                <TableSkeletonRows rows={8} cols={8} />
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
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", STATUS_TONE[o.status])}>
                        {ORDER_STATUS_LABELS[o.status] || o.status}
                      </span>
                    </TD>
                    <TD><JobChip label="Ambil" job={o.pickupJob} /></TD>
                    <TD><JobChip label="Kirim" job={o.deliveryJob} /></TD>
                    <TD numeric>{formatRupiah(o.value || 0)}</TD>
                    <TD>{formatTanggalPendek(o.createdAt)}</TD>
                  </TR>
                ))
              ) : (
                <TableEmptyRow colSpan={8}>
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
