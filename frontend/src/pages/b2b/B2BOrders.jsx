import React, { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X, Loader2, Handshake, Package } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows, TableEmptyRow } from "@/components/ui/table.jsx";
import Avatar from "@/components/Avatar.jsx";
import { formatRupiah, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentStatusVariant } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import OrderTimelineDrawer from "@/features/orders/OrderTimelineDrawer.jsx";

// Workspace B2B / Non-CRM (D-115, 11 September 2026) — permintaan owner:
// order vendor/korporat yang kontak LANGSUNG ke WA pribadi Gilang, sama
// sekali di luar Inbox omnichannel. Dibatasi Role.OWNER (Gilang/Juri/Kemal
// lewat Pengguna & Peran — backend menolak selain itu, lihat routes/b2b.js).
//
// SATU LANGKAH untuk mencatat deal baru: form di sini cuma menangkap data
// kontak vendor + kategori order, LANGSUNG membuat Customer(CORPORATE) +
// Order sekaligus (POST /b2b/orders). Item/harga/tanggal detail TIDAK
// diminta di form ini — begitu order lahir, drawer yang SAMA PERSIS dipakai
// Sales CRM (OrderTimelineDrawer) langsung terbuka untuk melengkapinya,
// supaya tidak ada 2 UI berbeda untuk "mengedit order" di seluruh sistem.
const KATEGORI_LABELS = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Baru" };
const KATEGORI_OPTIONS = ["LAYANAN", "SEWA", "BARU"];

function FormTambah({ open, onClose, onCreated }) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("LAYANAN");
  const [notesKontak, setNotesKontak] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCustomerName(""); setCustomerPhone(""); setCompanyName("");
      setCity(""); setCategory("LAYANAN"); setNotesKontak(""); setError("");
    }
  }, [open]);

  async function simpan() {
    if (!customerName.trim()) { setError("Nama vendor/PIC wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await api.createB2bOrder({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        companyName: companyName.trim() || undefined,
        city: city.trim() || undefined,
        notesKontak: notesKontak.trim() || undefined,
        category,
      });
      onCreated(result.order);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Tambah Order B2B"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[420px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Tambah Order B2B</Dialog.Title>
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <p className="text-[11.5px] leading-relaxed text-ink3">
              Untuk deal yang masuk langsung ke kontak pribadi — bukan lewat WhatsApp CS yang terpantau Inbox. Detail item/harga/tanggal diisi di langkah berikutnya.
            </p>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Nama Vendor / PIC *</label>
              <input
                type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                placeholder="mis. Budi (Purchasing Hotel ABC)"
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Nomor Kontak (opsional)</label>
              <input
                type="text" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="62812xxxxxxx — referensi, bukan channel WA CS"
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Nama Perusahaan (opsional)</label>
              <input
                type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
                placeholder="mis. Hotel ABC"
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Kota (opsional)</label>
              <input
                type="text" value={city} onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Kategori Order</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                {KATEGORI_OPTIONS.map((k) => <option key={k} value={k}>{KATEGORI_LABELS[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Catatan Awal (opsional)</label>
              <textarea
                value={notesKontak} onChange={(e) => setNotesKontak(e.target.value)}
                placeholder="Ringkasan percakapan/kesepakatan awal..."
                rows={3}
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-line p-3">
            {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
            <button
              type="button" onClick={simpan} disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Buat Order
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function B2BOrders() {
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [openOrder, setOpenOrder] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getB2bOrders();
      setOrders(res.items || []);
    } catch (e) {
      setError(e.message || "Gagal memuat order B2B");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleCreated(order) {
    setShowForm(false);
    load();
    // Langsung buka drawer edit — item/harga/tanggal belum diisi di form
    // tambah, ini kelanjutan alaminya (sama flow dengan Inbox/Drawer Sales CRM).
    setOpenOrder(order);
  }

  return (
    <PageContainer>
      <PageHeader
        title="B2B & Non-CRM Orders"
        subtitle="Order vendor/korporat yang kontak langsung ke WA pribadi — di luar Inbox omnichannel. Hanya Gilang, Juri, dan Kemal yang bisa mencatat di sini."
        actions={
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Tambah Order B2B
          </Button>
        }
      />

      <PageBody>
        {error && (
          <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>
        )}

        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Vendor / PIC</TH>
                <TH>Perusahaan</TH>
                <TH>Kategori</TH>
                <TH>Status</TH>
                <TH>Pembayaran</TH>
                <TH numeric>Nilai</TH>
                <TH>Tanggal</TH>
              </TR>
            </THead>
            <TBody>
              {loading ? (
                <TableSkeletonRows rows={6} cols={8} />
              ) : orders && orders.length > 0 ? (
                orders.map((o) => (
                  <TR key={o.id} clickable onClick={() => setOpenOrder(o)}>
                    <TD className="font-semibold text-ink">{o.orderNumber || o.id.slice(0, 8)}</TD>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={o.customer?.name} size="sm" />
                        <span className="truncate">{o.customer?.name || "—"}</span>
                      </span>
                    </TD>
                    <TD>{o.customer?.tags?.[0] || "—"}</TD>
                    <TD>{KATEGORI_LABELS[o.category] || o.category}</TD>
                    <TD><Badge variant="neutral">{ORDER_STATUS_LABELS[o.status] || o.status}</Badge></TD>
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
                <TableEmptyRow colSpan={8}>
                  <EmptyState
                    icon={Handshake}
                    title="Belum ada order B2B"
                    description="Klik 'Tambah Order B2B' untuk mencatat deal vendor/korporat pertama."
                  />
                </TableEmptyRow>
              )}
            </TBody>
          </Table>
        </TableWrap>
      </PageBody>

      <FormTambah open={showForm} onClose={() => setShowForm(false)} onCreated={handleCreated} />

      {openOrder && (
        <OrderTimelineDrawer
          order={openOrder}
          onClose={() => { setOpenOrder(null); load(); }}
          onOpenChat={(ord) => { window.location.href = `/customers?id=${ord.customerId || ""}`; }}
          onPaymentRecorded={load}
          canEditLunas
          canEditStatus
        />
      )}
    </PageContainer>
  );
}
