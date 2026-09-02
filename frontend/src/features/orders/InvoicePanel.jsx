import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FileText, Send, Eye, Ban, Check, Loader2, Copy, CalendarClock, AlertTriangle, Pencil, X, RotateCcw, GitMerge,
} from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";

// ─── PANEL INVOICE (31 Agustus 2026) ────────────────────────────────────────
// Komponen ini SENGAJA tidak menghitung apa pun. Seluruh nominal & status
// datang jadi dari backend (services/invoice.js) — kalau UI ikut menghitung,
// akan ada dua sumber kebenaran untuk angka tagihan yang sama, persis kelas
// bug yang sudah berulang di project ini. Di sini murni tampilan + aksi.

// Status → tampilan. Ikon WAJIB ada di tiap status (bukan cuma warna) supaya
// tetap terbaca oleh yang buta warna & saat di-print hitam putih.
const STATUS_META = {
  DRAFT:          { label: "Draft",       variant: "neutral", Icon: FileText },
  SENT:           { label: "Terkirim",    variant: "accent",  Icon: Send },
  VIEWED:         { label: "Dilihat",     variant: "accent",  Icon: Eye },
  PARTIALLY_PAID: { label: "Bayar Sebagian", variant: "orange", Icon: AlertTriangle },
  PAID:           { label: "Lunas",       variant: "green",   Icon: Check },
  CANCELLED:      { label: "Dibatalkan",  variant: "neutral", Icon: Ban },
  OVERDUE:        { label: "Jatuh Tempo", variant: "red",     Icon: CalendarClock },
};

const PAYMENT_METHOD_LABEL = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS" };

function StatusInvoiceBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.DRAFT;
  const { Icon } = meta;
  return (
    <Badge variant={meta.variant}>
      <Icon size={11} aria-hidden="true" /> {meta.label}
    </Badge>
  );
}

function BarisUang({ label, value, tone, strong, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={cn("text-[12.5px]", strong ? "font-semibold text-ink" : "text-ink2")}>
        {label}
        {hint && <span className="ml-1 text-[11px] text-ink3">{hint}</span>}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          strong ? "text-[15px] font-bold" : "text-[13px]",
          tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Teks invoice untuk disalin/ditempel ke WA. Formatnya sengaja mengikuti gaya
// ringkasan order yang SUDAH dipakai sales tiap hari (buildRingkasanOrder di
// backend routes/orders.js) supaya customer tidak menerima dua dokumen dengan
// gaya & angka yang berbeda dari bisnis yang sama.
function buatTeksInvoice(v) {
  const { invoice, order, orders, items, customer, nominal, payments } = v;
  const rp = (n) => formatRupiah(n || 0);
  const baris = [
    `🧾 *INVOICE* — ${invoice.invoiceNumber}`,
    `Order: ${(orders || [order]).map((o) => o.orderNumber).filter(Boolean).join(", ") || "-"}`,
    ``,
    `👤 ${invoice.namaTujuan || customer.nama || "-"}`,
    `${customer.phone || "-"}`,
    invoice.alamatTujuan || `${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`,
    ``,
    `🛏️ *Rincian*`,
    ...((items?.length ?? order.items.length)
      ? (items || order.items).map((i) => `• ${i.nama}: ${rp(i.harga)}`)
      : ["• (belum ada item)"]),
  ];
  if (nominal.diskonPersen) {
    baris.push(``, `Harga sebelum diskon: ${rp(nominal.hargaSebelumDiskon)}`);
    baris.push(`Diskon ${nominal.diskonPersen}%${nominal.promoCode ? ` (${nominal.promoCode})` : ""}: -${rp(nominal.nilaiDiskon)}`);
  }
  if (nominal.ongkir) baris.push(`Ongkir: ${rp(nominal.ongkir)}`);
  baris.push(``, `*TOTAL: ${rp(nominal.totalTagihan)}*`);
  // Rincian per transaksi (2 Sep 2026) — kalau lebih dari 1 pembayaran
  // (mis. DP lalu pelunasan), teks WA ikut sebutkan satu-satu, konsisten
  // dengan PDF-nya, bukan cuma angka gabungan.
  if (payments?.length > 1) {
    baris.push(`Riwayat pembayaran:`);
    payments.forEach((p) => {
      baris.push(`• ${formatTanggalPendek(p.createdAt)} — ${rp(p.amount)} (${PAYMENT_METHOD_LABEL[p.method] || p.method})`);
    });
  }
  baris.push(
    `Sudah dibayar: ${rp(nominal.dibayar)}`,
    `*Sisa: ${rp(nominal.sisa)}*`,
  );
  if (invoice.dueDate) baris.push(``, `Jatuh tempo: ${formatTanggalPendek(invoice.dueDate)}`);
  if (order.pickupConfirmedDate || order.pickupEstimate) {
    baris.push(`Pick up: ${order.pickupConfirmedDate ? formatTanggalPendek(order.pickupConfirmedDate) : order.pickupEstimate}`);
  }
  if (invoice.notes) baris.push(``, invoice.notes);
  if (customer.salesOwner) baris.push(``, `CS: ${customer.salesOwner}`);
  return baris.join("\n");
}

export default function InvoicePanel({ orderId, onChanged }) {
  const navigate = useNavigate();
  const [view, setView]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [aksi, setAksi]       = useState(null); // nama aksi yang sedang jalan
  const [error, setError]     = useState(null);
  const [tersalin, setTersalin] = useState(false);
  const [editPenerima, setEditPenerima] = useState(false);
  const [namaDraft, setNamaDraft] = useState("");
  const [alamatDraft, setAlamatDraft] = useState("");
  // Gabung invoice lintas-order (2 Sep 2026).
  const [showMergePicker, setShowMergePicker] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [attachingId, setAttachingId] = useState(null);
  const [detachingId, setDetachingId] = useState(null);

  useEffect(() => {
    if (!orderId) return;
    let batal = false;
    setLoading(true);
    api.getOrderInvoice(orderId)
      .then((r) => { if (!batal) { setView(r); setError(null); } })
      .catch((e) => { if (!batal) setError(e.message); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [orderId]);

  async function ubah(data, namaAksi) {
    setAksi(namaAksi);
    try {
      const r = await api.updateOrderInvoice(orderId, data);
      setView(r);
      setError(null);
      onChanged?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  async function salinTeks() {
    try {
      await navigator.clipboard.writeText(buatTeksInvoice(view));
      setTersalin(true);
      setTimeout(() => setTersalin(false), 2000);
    } catch {
      setError("Gagal menyalin — salin manual dari layar.");
    }
  }

  async function previewPdf() {
    setAksi("PREVIEW");
    try {
      const { blob } = await api.getOrderInvoicePdf(orderId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      // Revoke ditunda — tab baru butuh waktu memuat blob-nya SEBELUM url-nya
      // dicabut, mencabut langsung bikin tab baru itu blank di sebagian browser.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  async function downloadPdf() {
    setAksi("DOWNLOAD");
    try {
      const { blob, namaFile } = await api.getOrderInvoicePdf(orderId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = namaFile; a.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  async function bukaMergePicker() {
    if (showMergePicker) { setShowMergePicker(false); return; }
    setShowMergePicker(true);
    setMergeLoading(true);
    try {
      const list = await api.getMergeableOrders(orderId);
      setMergeCandidates(list);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setMergeLoading(false);
    }
  }

  async function gabungkanKe(targetOrderId) {
    setAttachingId(targetOrderId);
    try {
      const r = await api.attachOrderToInvoice(orderId, targetOrderId);
      setView(r);
      setShowMergePicker(false);
      setError(null);
      onChanged?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setAttachingId(null);
    }
  }

  async function pisahkan(memberOrderId) {
    setDetachingId(memberOrderId);
    try {
      // detach dipanggil dengan order id ANGGOTA yang mau dipisah — bisa
      // beda dari `orderId` panel ini (panel bisa dibuka dari primary,
      // tapi anggota mana pun boleh dipisah). Refetch dari `orderId` panel
      // supaya tampilan yang di-refresh selalu punya sudut pandang yang benar.
      await api.detachInvoiceFromBundle(memberOrderId);
      const r = await api.getOrderInvoice(orderId);
      setView(r);
      setError(null);
      onChanged?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetachingId(null);
    }
  }

  async function kirimWa() {
    setAksi("KIRIM");
    try {
      const r = await api.sendOrderInvoice(orderId);
      setView(r);
      setError(null);
      onChanged?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="rounded-xl bg-surface px-4 py-8 text-center shadow-card">
        <FileText className="mx-auto text-ink3" size={22} />
        <p className="mt-1.5 text-[13px] font-semibold text-ink2">Invoice belum tersedia</p>
        {error && <p className="mt-1 text-[11.5px] text-red">{error}</p>}
      </div>
    );
  }

  const { invoice, order, orders = [order], items: itemsGabungan, customer, nominal, payments } = view;
  const items = itemsGabungan || order.items;
  const dibatalkan = invoice.status === "CANCELLED";
  const primaryOrderId = orders[0]?.id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="flex flex-col gap-3"
    >
      {/* Kepala invoice */}
      <div className="rounded-xl bg-surface p-3.5 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[13px] font-bold text-ink">{invoice.invoiceNumber}</p>
            <p className="mt-0.5 text-[11.5px] text-ink3">
              Dibuat {formatTanggalPendek(invoice.createdAt)}
              {invoice.createdBy ? ` · ${invoice.createdBy}` : ""}
            </p>
          </div>
          <StatusInvoiceBadge status={invoice.status} />
        </div>

        {invoice.dueDate && (
          <p className={cn(
            "mt-2 flex items-center gap-1.5 text-[11.5px]",
            invoice.status === "OVERDUE" ? "font-semibold text-red" : "text-ink2",
          )}>
            <CalendarClock size={12} /> Jatuh tempo {formatTanggalPendek(invoice.dueDate)}
          </p>
        )}
      </div>

      {/* Gabung invoice lintas-order (2 Sep 2026) — chip per order anggota
          (+ "Pisahkan" utk yg bukan primary) begitu invoice ini gabungan,
          dan tombol "Gabungkan dengan Order Lain" selama belum terkirim. */}
      {orders.length > 1 && (
        <div className="rounded-xl bg-surface p-3.5 shadow-card">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
            Gabungan {orders.length} Order
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orders.map((o) => (
              <span key={o.id} className="flex items-center gap-1 rounded-lg bg-inset px-2 py-1 text-[11.5px] font-medium text-ink2">
                {o.orderNumber || o.id}
                {o.id !== primaryOrderId && !invoice.sentAt && (
                  <button
                    type="button"
                    disabled={detachingId === o.id}
                    onClick={() => pisahkan(o.id)}
                    className="text-ink3 hover:text-red"
                    title="Pisahkan order ini dari gabungan"
                  >
                    {detachingId === o.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {!invoice.sentAt && !dibatalkan && (
        <div className="rounded-xl bg-surface p-3.5 shadow-card">
          <button
            type="button"
            onClick={bukaMergePicker}
            className="flex w-full items-center justify-between gap-2 text-[12.5px] font-semibold text-accent"
          >
            <span className="flex items-center gap-1.5"><GitMerge size={14} /> Gabungkan dengan Order Lain</span>
            {mergeLoading && <Loader2 size={13} className="animate-spin" />}
          </button>
          {showMergePicker && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
              {!mergeLoading && mergeCandidates.length === 0 && (
                <p className="text-[11.5px] text-ink3">Tidak ada order lain milik pelanggan ini yang bisa digabung.</p>
              )}
              {mergeCandidates.map((c) => (
                <button
                  key={c.orderId}
                  type="button"
                  disabled={attachingId === c.orderId}
                  onClick={() => gabungkanKe(c.orderId)}
                  className="flex items-center justify-between gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-left text-[12px] text-ink2 transition-colors hover:bg-hovertint disabled:opacity-60"
                >
                  <span>{c.orderNumber} <span className="text-ink3">({c.category})</span></span>
                  {attachingId === c.orderId ? <Loader2 size={12} className="animate-spin" /> : <span className="font-semibold text-accent">Gabung</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rincian tagihan */}
      <div className="rounded-xl bg-surface p-3.5 shadow-card">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Rincian</p>
        {items.length === 0 ? (
          <p className="py-2 text-[12.5px] text-ink3">
            Belum ada item layanan — nominal masih Rp0 sampai item ditambahkan di order.
          </p>
        ) : (
          items.map((i) => (
            <BarisUang
              key={i.id}
              label={orders.length > 1 && i.orderNumber ? `${i.nama} · ${i.orderNumber}` : i.nama}
              value={formatRupiah(i.harga)}
            />
          ))
        )}

        <div className="my-2 border-t border-line" />

        {nominal.diskonPersen ? (
          <>
            <BarisUang label="Harga sebelum diskon" value={formatRupiah(nominal.hargaSebelumDiskon)} />
            <BarisUang
              label={`Diskon ${nominal.diskonPersen}%`}
              hint={nominal.promoCode ? `(${nominal.promoCode})` : null}
              value={`−${formatRupiah(nominal.nilaiDiskon)}`}
              tone="green"
            />
          </>
        ) : null}
        {nominal.ongkir > 0 && <BarisUang label="Ongkir" value={formatRupiah(nominal.ongkir)} />}
        <BarisUang label="Total tagihan" value={formatRupiah(nominal.totalTagihan)} strong />

        <div className="my-2 border-t border-line" />
        <BarisUang
          label="Sudah dibayar"
          hint={nominal.dibayarTidakRinci ? "(nominal DP belum tercatat)" : null}
          value={nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.dibayar)}
          tone="green"
        />
        <BarisUang
          label="Sisa tagihan"
          value={nominal.dibayarTidakRinci ? "—" : formatRupiah(nominal.sisa)}
          tone={nominal.sisa > 0 ? "red" : "green"}
          strong
        />

        {/* DP disepakati (2 Sep 2026) — MURNI pembanding terhadap
            kesepakatan awal, cuma tampil kalau ledger-nya ada (dpKurang
            null/0 kalau dibayarTidakRinci, lihat hitungNominal). */}
        {nominal.dpTarget > 0 && nominal.sumber === "ledger" && (
          <p className={cn(
            "mt-2 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed",
            nominal.dpKurang > 0 ? "bg-orangebg text-ink" : "bg-greenbg text-ink"
          )}>
            DP disepakati <strong>{formatRupiah(nominal.dpTarget)}</strong> —{" "}
            {nominal.dpKurang > 0
              ? <>kurang <strong className="text-orange">{formatRupiah(nominal.dpKurang)}</strong> dari kesepakatan.</>
              : <strong className="text-green">terpenuhi.</strong>}
          </p>
        )}

        {/* Rincian per transaksi (2 Sep 2026) — untuk order yang dibayar
            bertahap (DP dulu, pelunasan belakangan), lebih dari 1 baris
            di sini supaya customer/sales lihat riwayat lengkap. */}
        {payments?.length > 1 && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg bg-inset px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink3">Riwayat Pembayaran</p>
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="text-ink3">
                  {formatTanggalPendek(p.createdAt)} · {PAYMENT_METHOD_LABEL[p.method] || p.method}
                </span>
                <span className="shrink-0 font-medium text-ink tabular-nums">{formatRupiah(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Jujur soal ASAL angkanya — jangan sampai terbaca seolah ada
            rincian pembayaran tercatat padahal cuma dropdown status. */}
        {nominal.sumber === "statusManual" && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-orangebg px-2.5 py-2 text-[11px] leading-relaxed text-ink">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-orange" />
            <span>
              Angka bayar mengikuti <strong>status pembayaran order</strong> — belum ada rincian
              pembayaran tercatat (siapa terima, kapan, lewat apa). Catat di tab
              <strong> Bayar</strong> supaya invoice punya jejak yang bisa diaudit.
            </span>
          </p>
        )}

        {nominal.ongkirKlaimGaransi > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink3">
            Ongkir klaim garansi {formatRupiah(nominal.ongkirKlaimGaransi)} ditanggung Klinik Matras —
            tidak masuk tagihan customer.
          </p>
        )}
      </div>

      {/* Data penerima — ikut tercetak di invoice nanti. Nama & alamat bisa
          di-override MANUAL di sini (2 Sep 2026) tanpa mengubah data
          customer/order asli. Alasan: nama di CRM kadang nama panggilan/
          inisial dan alamat order sering berantakan/salah ketik, tapi
          data itu sendiri sudah dipakai di banyak tempat lain (WA, laporan)
          jadi tidak bisa asal diedit — override ini HANYA memengaruhi
          tampilan invoice, satu tombol edit untuk keduanya sekaligus karena
          selalu tampil & diedit bersamaan. */}
      <div className="rounded-xl bg-surface p-3.5 shadow-card">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink3">Ditagihkan ke</p>
          {!editPenerima && (
            <button
              type="button"
              onClick={() => {
                setNamaDraft(invoice.namaTujuan || customer.nama || "");
                setAlamatDraft(
                  invoice.alamatTujuan ||
                  `${order.deliveryAddress || ""}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`
                );
                setEditPenerima(true);
              }}
              className="shrink-0 rounded-lg p-1 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
              title="Perbaiki nama/alamat yang tercetak di invoice"
            >
              <Pencil size={13} />
            </button>
          )}
        </div>

        {!editPenerima ? (
          <>
            <p className="text-[13px] font-semibold text-ink">
              {invoice.namaTujuan || customer.nama || "—"}
              {invoice.namaTujuan && (
                <span className="ml-1.5 rounded bg-orangebg px-1.5 py-0.5 text-[10px] font-semibold text-orange">
                  override
                </span>
              )}
            </p>
            <p className="text-[12px] text-ink2">{customer.phone || "—"}</p>
            <p className="mt-0.5 text-[12px] text-ink2">
              {invoice.alamatTujuan || order.deliveryAddress || "Alamat belum diisi"}
              {!invoice.alamatTujuan && order.deliveryCity ? `, ${order.deliveryCity}` : ""}
              {invoice.alamatTujuan && (
                <span className="ml-1.5 rounded bg-orangebg px-1.5 py-0.5 text-[10px] font-semibold text-orange">
                  override
                </span>
              )}
            </p>
          </>
        ) : (
          <div className="mt-1 flex flex-col gap-1.5">
            <label className="text-[10.5px] font-semibold text-ink3">Nama di invoice</label>
            <input
              type="text"
              value={namaDraft}
              onChange={(e) => setNamaDraft(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-line bg-inset px-2.5 py-1.5 text-[12.5px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              placeholder={customer.nama || "Nama pelanggan"}
            />
            <label className="mt-1 text-[10.5px] font-semibold text-ink3">Alamat di invoice</label>
            <textarea
              value={alamatDraft}
              onChange={(e) => setAlamatDraft(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-line bg-inset px-2.5 py-1.5 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              placeholder="Alamat yang ditampilkan di invoice PDF"
            />
            <p className="text-[10.5px] text-ink3">
              Cuma mengubah tampilan invoice — data pelanggan/order tidak ikut berubah.
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={aksi === "PENERIMA"}
                onClick={async () => {
                  await ubah({
                    namaTujuan: namaDraft.trim() || null,
                    alamatTujuan: alamatDraft.trim() || null,
                  }, "PENERIMA");
                  setEditPenerima(false);
                }}
                className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {aksi === "PENERIMA" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Simpan
              </button>
              <button
                type="button"
                onClick={() => setEditPenerima(false)}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-ink3 hover:bg-hovertint"
              >
                <X size={12} /> Batal
              </button>
              {(invoice.namaTujuan || invoice.alamatTujuan) && (
                <button
                  type="button"
                  disabled={aksi === "PENERIMA"}
                  onClick={async () => {
                    await ubah({ namaTujuan: null, alamatTujuan: null }, "PENERIMA");
                    setEditPenerima(false);
                  }}
                  className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-ink3 hover:bg-hovertint"
                  title="Kembali ke nama & alamat asli"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
          </div>
        )}

        {customer.salesOwner && (
          <p className="mt-1.5 text-[11.5px] text-ink3">Sales: {customer.salesOwner}</p>
        )}
        {customer.id && (
          // Navigasi dalam aplikasi yang sama — lihat catatan di ReadinessPanel.jsx.
          <button
            type="button"
            onClick={() => navigate(`/customers?id=${customer.id}`)}
            className="mt-2 text-[11.5px] font-semibold text-accent hover:underline"
          >
            Buka profil pelanggan →
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-redbg px-3 py-2 text-[11.5px] text-red">{error}</p>
      )}

      {/* Aksi — PDF & kirim WA (31 Agustus 2026) beneran men-generate dokumen
          server-side & mengirim ke nomor pelanggan lewat sesi WA aktifnya
          (bukan tombol mati). "Kirim ke WhatsApp" otomatis menandai invoice
          SENT karena dokumennya sungguh sampai — beda dari "Tandai terkirim"
          manual di bawah (utk kasus dikirim MANUAL di luar sistem, mis.
          sales screenshot dari HP-nya sendiri). */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={aksi === "PREVIEW"}
          onClick={previewPdf}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
        >
          {aksi === "PREVIEW" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          Preview PDF
        </button>
        <button
          type="button"
          disabled={aksi === "DOWNLOAD"}
          onClick={downloadPdf}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
        >
          {aksi === "DOWNLOAD" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          Download PDF
        </button>

        {!dibatalkan && (
          <button
            type="button"
            disabled={aksi === "KIRIM"}
            onClick={kirimWa}
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-green px-3 py-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40 disabled:opacity-60"
          >
            {aksi === "KIRIM" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Kirim ke WhatsApp Pelanggan
          </button>
        )}

        <button
          type="button"
          onClick={salinTeks}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {tersalin ? <Check size={14} className="text-green" /> : <Copy size={14} />}
          {tersalin ? "Tersalin" : "Salin teks"}
        </button>

        {invoice.lifecycleStatus === "DRAFT" && !dibatalkan && (
          <button
            type="button"
            disabled={aksi === "SENT"}
            onClick={() => ubah({ lifecycleStatus: "SENT" }, "SENT")}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-accentbg px-3 py-2.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
            title="Untuk kasus dikirim manual di luar sistem"
          >
            {aksi === "SENT" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Tandai terkirim manual
          </button>
        )}

        {invoice.lifecycleStatus === "SENT" && (
          <button
            type="button"
            disabled={aksi === "VIEWED"}
            onClick={() => ubah({ lifecycleStatus: "VIEWED" }, "VIEWED")}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-accentbg px-3 py-2.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
          >
            {aksi === "VIEWED" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
            Tandai dilihat
          </button>
        )}

        {dibatalkan ? (
          <button
            type="button"
            disabled={aksi === "DRAFT"}
            onClick={() => ubah({ lifecycleStatus: "DRAFT" }, "DRAFT")}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
          >
            {aksi === "DRAFT" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Aktifkan lagi
          </button>
        ) : (
          <button
            type="button"
            disabled={aksi === "CANCELLED"}
            onClick={() => ubah({ lifecycleStatus: "CANCELLED" }, "CANCELLED")}
            className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-ink3 transition-colors hover:bg-redbg hover:text-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
          >
            {aksi === "CANCELLED" ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
            Batalkan invoice
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink3">
        Status <strong>Lunas / Bayar Sebagian / Jatuh Tempo</strong> mengikuti pembayaran yang
        tercatat di tab Pembayaran — tidak bisa (dan tidak perlu) diubah manual dari sini.
      </p>
    </motion.div>
  );
}
