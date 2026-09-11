import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X, Loader2, Handshake, Package, Building2, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import { TH } from "@/components/ui/table.jsx";
import { BadgeDropdown } from "@/components/ui/badge-dropdown.jsx";
import { badgeVariants } from "@/components/ui/badge.jsx";
import Avatar from "@/components/Avatar.jsx";
import {
  formatRupiah, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES,
  PRODUCT_TYPE_LABELS, parseOrderNotes,
} from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { StatusSelect } from "@/features/orders/StatusSelect.jsx";
import OrderTimelineDrawer from "@/features/orders/OrderTimelineDrawer.jsx";

// Workspace B2B / Non-CRM (D-115, 11 September 2026) — permintaan owner:
// order vendor/korporat yang kontak LANGSUNG ke WA pribadi Gilang, sama
// sekali di luar Inbox omnichannel. Dibatasi Role.OWNER (Gilang/Juri/Kemal
// lewat Pengguna & Peran — backend menolak selain itu, lihat routes/b2b.js).
//
// TABEL DETAIL, bukan cuma daftar order polos (koreksi 11 September 2026
// setelah versi pertama dianggap kurang detail) — meniru pola "dh-table"
// yang sama dipakai Semua Order Sales CRM (pages/Orders.jsx mode Tabel):
// avatar+kontak, layanan/produk & ukuran langsung dari data yang sama
// dengan export Excel (parseOrderNotes), status BISA diubah langsung dari
// baris (StatusSelect, shared dgn Delivery/Produksi), dan KPI ringkasan di
// atas. Divisi ini juga ikut "kaca" (glass-division) — lihat Layout.jsx.
const KATEGORI_LABELS = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Baru" };
const KATEGORI_OPTIONS = ["LAYANAN", "SEWA", "BARU"];

const PAYMENT_TONE = {
  BELUM_BAYAR: "bg-redbg text-red",
  DP:          "bg-orangebg text-orange",
  LUNAS:       "bg-greenbg text-green",
};
// Lokal (bukan diimpor dari Orders.jsx) — sengaja, sama alasan kenapa
// StatusSelect DIEKSTRAK jadi shared tapi PaymentStatusSelect di
// pages/Orders.jsx TIDAK: komponen ini kecil & murni presentasional, tidak
// ada logika lintas-divisi yang berisiko drift kalau diduplikasi.
function PaymentStatusSelect({ order, onChange }) {
  return (
    <BadgeDropdown
      value={order.paymentStatus || "BELUM_BAYAR"}
      onChange={(v) => onChange(order, v)}
      options={PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] || s }))}
      getChipClass={(v) => PAYMENT_TONE[v]}
      ariaLabel={`Ubah status pembayaran untuk ${order.customer?.name || "vendor"}`}
    />
  );
}

let itemKeySeq = 0;
function itemKosong() { return { key: ++itemKeySeq, layananName: "", hargaSatuan: "", qty: "1" }; }

function FormTambah({ open, onClose, onCreated }) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("LAYANAN");
  const [notesKontak, setNotesKontak] = useState("");
  // Item PESANAN (11 September 2026) — 1 order/resi B2B bisa berisi lebih
  // dari 1 produk/layanan sekaligus (mis. vendor pesan 10 unit tipe A + 5
  // unit tipe B dalam satu PO). Pola SAMA dengan form order Sales CRM
  // (OrderSection.jsx): baris diisi lokal dulu, order dibuat DULU (bare),
  // baru tiap baris dikirim lewat POST /orders/:orderId/items yang SUDAH
  // ADA dan dipakai di seluruh CRM — TIDAK menulis endpoint "create order
  // dengan item sekaligus" yang baru, supaya Order.value tetap dihitung
  // dari SATU tempat (syncOrderValue di routes/orders.js), bukan jalur
  // kedua yang bisa diam-diam beda hasilnya.
  const [items, setItems] = useState([itemKosong()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCustomerName(""); setCustomerPhone(""); setCompanyName("");
      setCity(""); setCategory("LAYANAN"); setNotesKontak("");
      setItems([itemKosong()]); setError("");
    }
  }, [open]);

  function ubahItem(key, field, value) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, [field]: value } : it)));
  }
  function tambahBarisItem() { setItems((prev) => [...prev, itemKosong()]); }
  function hapusBarisItem(key) { setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev)); }

  const totalPesanan = items.reduce((s, it) => s + (Number(it.hargaSatuan) || 0) * (Number(it.qty) || 0), 0);

  async function simpan() {
    if (!customerName.trim()) { setError("Nama vendor/PIC wajib diisi"); return; }
    const itemValid = items.filter((it) => it.layananName.trim() && Number(it.hargaSatuan) > 0);
    if (itemValid.length === 0) { setError("Isi minimal 1 produk/layanan dengan harga"); return; }

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
      // Ditambahkan SATU per SATU (bukan array sekali kirim) — endpoint
      // POST /orders/:orderId/items menghitung ulang Order.value tiap
      // dipanggil (syncOrderValue), jadi urutan sekuensial di sini aman;
      // 1 baris gagal (mis. harga tidak valid di server) tidak menggagalkan
      // baris lain yang sudah lebih dulu masuk.
      for (const it of itemValid) {
        const qty = Number(it.qty) || 1;
        const namaLengkap = qty > 1 ? `${it.layananName.trim()} (x${qty})` : it.layananName.trim();
        await api.addOrderItem(result.order.id, {
          layananName: namaLengkap,
          harga: (Number(it.hargaSatuan) || 0) * qty,
        });
      }
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
              Untuk deal yang masuk langsung ke kontak pribadi — bukan lewat WhatsApp CS yang terpantau Inbox. Tanggal pengambilan/pengiriman & alamat lengkap diisi di langkah berikutnya.
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
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-[11.5px] font-semibold text-ink2">Produk / Layanan *</label>
                <button type="button" onClick={tambahBarisItem} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
                  <Plus size={11} /> Tambah Item
                </button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => {
                  const subtotal = (Number(it.hargaSatuan) || 0) * (Number(it.qty) || 0);
                  return (
                    <div key={it.key} className="rounded-btn border border-border p-2">
                      <div className="flex items-start gap-1.5">
                        <input
                          type="text" value={it.layananName} onChange={(e) => ubahItem(it.key, "layananName", e.target.value)}
                          placeholder={`Produk/layanan ${idx + 1} — mis. Kasur Sano Queen 160x200`}
                          className="min-w-0 flex-1 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                        />
                        {items.length > 1 && (
                          <button
                            type="button" onClick={() => hapusBarisItem(it.key)}
                            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-btn text-ink3 hover:bg-redbg hover:text-red"
                            title="Hapus baris ini"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                      <div className="mt-1.5 grid grid-cols-[1fr_72px] gap-1.5">
                        <input
                          type="number" min="0" value={it.hargaSatuan} onChange={(e) => ubahItem(it.key, "hargaSatuan", e.target.value)}
                          placeholder="Harga satuan (Rp)"
                          className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                        />
                        <input
                          type="number" min="1" value={it.qty} onChange={(e) => ubahItem(it.key, "qty", e.target.value)}
                          placeholder="Qty"
                          className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-center text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                        />
                      </div>
                      {subtotal > 0 && (
                        <p className="mt-1 text-right text-[11px] font-semibold text-ink2">Subtotal: {formatRupiah(subtotal)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {totalPesanan > 0 && (
                <p className="mt-2 flex items-center justify-between rounded-btn bg-accentbg px-2.5 py-1.5 text-[12.5px] font-bold text-accent">
                  <span>Total Pesanan</span> <span>{formatRupiah(totalPesanan)}</span>
                </p>
              )}
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

  async function handleStatusChange(order, newStatus) {
    if (newStatus === order.status) return;
    try {
      await api.updateOrder(order.id, { status: newStatus });
      load();
    } catch (err) {
      alert("Gagal ubah status: " + err.message);
    }
  }

  async function handlePaymentChange(order, newPayment) {
    if (newPayment === (order.paymentStatus || "BELUM_BAYAR")) return;
    try {
      await api.updateOrder(order.id, { paymentStatus: newPayment });
      load();
    } catch (err) {
      alert("Gagal ubah status pembayaran: " + err.message);
    }
  }

  // KPI ringkasan (dihitung client-side dari `orders` — volume workspace
  // ini rendah/manual, tidak butuh agregat SQL server terpisah seperti
  // Semua Order Sales CRM yang bisa ribuan baris). CANCELLED dikecualikan
  // dari "aktif", pola sama dengan itemsAktif di pages/Orders.jsx.
  const summary = useMemo(() => {
    const list = orders || [];
    const aktif = list.filter((o) => o.status !== "CANCELLED");
    const nilai = aktif.reduce((s, o) => s + (o.value || 0), 0);
    const belumLunas = aktif.filter((o) => o.paymentStatus !== "LUNAS").reduce((s, o) => s + (o.value || 0), 0);
    return { total: aktif.length, nilai, belumLunas };
  }, [orders]);

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
        {orders && (
          <WorkspaceHero
            tone="blue"
            title="Ringkasan B2B"
            subtitle="Dari seluruh order yang lahir dari workspace ini."
            health={
              summary.belumLunas > 0
                ? { label: `${formatRupiah(summary.belumLunas)} belum lunas`, tone: "warn" }
                : { label: "Semua lunas", tone: "ok" }
            }
            stats={[
              { label: "Order aktif", value: summary.total, hint: "bukan Dibatalkan" },
              { label: "Nilai order aktif", value: formatRupiah(summary.nilai) },
              { label: "Belum lunas", value: formatRupiah(summary.belumLunas) },
            ]}
          />
        )}

        {error && (
          <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>
        )}

        {/* "dh-table" — sama pola dengan mode Tabel Semua Order Sales CRM
            (pages/Orders.jsx D-100): tabel ditulis manual (bukan lewat
            TableWrap), class ini yang membuatnya cocok seleksi wildcard
            kaca. No-op di luar .glass-division. */}
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-card dh-table">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <TH>ID Order</TH>
                <TH>Vendor / PIC</TH>
                <TH>Perusahaan</TH>
                <TH>Kategori</TH>
                <TH>Layanan/Produk</TH>
                <TH>Ukuran</TH>
                <TH>Status</TH>
                <TH>Pembayaran</TH>
                <TH numeric>Nilai</TH>
                <TH>Dibuat</TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-[12.5px] text-ink3">
                  <Loader2 size={16} className="mx-auto animate-spin" />
                </td></tr>
              ) : orders && orders.length > 0 ? (
                orders.map((o) => {
                  const info = parseOrderNotes(o.notes);
                  const layananProduk = (o.items || []).map((it) => it.layananName).filter(Boolean).join(", ")
                    || PRODUCT_TYPE_LABELS[o.productType] || "";
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setOpenOrder(o)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-hovertint"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-ink2">
                        {o.orderNumber || o.id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={o.customer?.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-ink">{o.customer?.name || "—"}</p>
                            <p className="truncate text-[11px] tabular-nums text-ink3">{o.customer?.phone || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink2">
                        {o.customer?.tags?.[0] ? (
                          <span className="flex items-center gap-1"><Building2 size={12} className="shrink-0 text-ink3" />{o.customer.tags[0]}</span>
                        ) : <span className="text-ink3">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink2">
                        {KATEGORI_LABELS[o.category] || o.category}
                      </td>
                      <td className="max-w-52 px-3 py-2.5">
                        {layananProduk ? (
                          <span className="block truncate text-[12.5px] text-ink2" title={layananProduk}>{layananProduk}</span>
                        ) : <span className="text-ink3">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-ink2">
                        {info.ukuranKasur || <span className="text-ink3">—</span>}
                        {info.merkKasur && <span className="text-ink3"> · {info.merkKasur}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <StatusSelect order={o} onChange={handleStatusChange} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <PaymentStatusSelect order={o} onChange={handlePaymentChange} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-ink">
                        {formatRupiah(o.value || 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-ink3">
                        {o.createdAt ? formatTanggalPendek(o.createdAt) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => setOpenOrder(o)} title="Rincian pesanan"
                          className="rounded-md p-1 text-ink3 hover:bg-hovertint hover:text-ink2">
                          <Package size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={11}>
                  <EmptyState
                    icon={Handshake}
                    title="Belum ada order B2B"
                    description="Klik 'Tambah Order B2B' untuk mencatat deal vendor/korporat pertama."
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
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
