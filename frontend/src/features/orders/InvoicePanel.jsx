import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FileText, Send, Eye, Ban, Check, Loader2, Copy, CalendarClock, AlertTriangle,
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
  const { invoice, order, customer, nominal } = v;
  const rp = (n) => formatRupiah(n || 0);
  const baris = [
    `🧾 *INVOICE* — ${invoice.invoiceNumber}`,
    `Order: ${order.orderNumber || "-"}`,
    ``,
    `👤 ${customer.nama || "-"}`,
    `${customer.phone || "-"}`,
    `${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`,
    ``,
    `🛏️ *Rincian*`,
    ...(order.items.length
      ? order.items.map((i) => `• ${i.nama}: ${rp(i.harga)}`)
      : ["• (belum ada item)"]),
  ];
  if (nominal.diskonPersen) {
    baris.push(``, `Harga sebelum diskon: ${rp(nominal.hargaSebelumDiskon)}`);
    baris.push(`Diskon ${nominal.diskonPersen}%${nominal.promoCode ? ` (${nominal.promoCode})` : ""}: -${rp(nominal.nilaiDiskon)}`);
  }
  if (nominal.ongkir) baris.push(`Ongkir: ${rp(nominal.ongkir)}`);
  baris.push(
    ``,
    `*TOTAL: ${rp(nominal.totalTagihan)}*`,
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

  const { invoice, order, customer, nominal } = view;
  const dibatalkan = invoice.status === "CANCELLED";

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

      {/* Rincian tagihan */}
      <div className="rounded-xl bg-surface p-3.5 shadow-card">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Rincian</p>
        {order.items.length === 0 ? (
          <p className="py-2 text-[12.5px] text-ink3">
            Belum ada item layanan — nominal masih Rp0 sampai item ditambahkan di order.
          </p>
        ) : (
          order.items.map((i) => (
            <BarisUang key={i.id} label={i.nama} value={formatRupiah(i.harga)} />
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

      {/* Data penerima — ikut tercetak di invoice nanti */}
      <div className="rounded-xl bg-surface p-3.5 shadow-card">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Ditagihkan ke</p>
        <p className="text-[13px] font-semibold text-ink">{customer.nama || "—"}</p>
        <p className="text-[12px] text-ink2">{customer.phone || "—"}</p>
        <p className="mt-0.5 text-[12px] text-ink2">
          {order.deliveryAddress || "Alamat belum diisi"}
          {order.deliveryCity ? `, ${order.deliveryCity}` : ""}
        </p>
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
