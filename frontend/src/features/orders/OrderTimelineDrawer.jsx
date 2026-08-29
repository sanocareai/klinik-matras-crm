import React, { useEffect, useState } from "react";
import {
  X, Clock, MessageSquare, Timer, Camera, ImageOff, Send, Loader2, CheckCircle2,
  Wallet, PackageCheck, Wrench, Truck, PenTool, Hash, MapPin, Link2, Weight,
  Bed, HeartPulse, Banknote, CalendarClock, Tag, MessageSquareText,
} from "lucide-react";
import { api } from "../../api.js";
import {
  formatRupiah, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  HEALTH_LABELS, HEALTH_COMPLAINT_LABELS, parseOrderNotes, promoLabel,
  PRODUCT_LINE_LABELS, PRODUCT_TYPE_LABELS,
} from "../../utils/format.js";
import { formatTanggal } from "../../utils/formatDate.js";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { cn } from "@/lib/utils.js";

const PAYMENT_METHOD_LABEL = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS" };

// Warna khas per kategori dokumentasi — supaya sekilas lihat langsung
// kebaca "ini tahap yang mana" (Penjemputan/Produksi/Pengiriman), mengikuti
// gaya tracking paket marketplace yang sudah familiar buat sales/customer.
const KATEGORI_TONE = {
  PENJEMPUTAN: { icon: PackageCheck, chip: "bg-orangebg text-orange", dot: "bg-orange" },
  PRODUKSI:    { icon: Wrench,       chip: "bg-accentbg text-accent", dot: "bg-accent" },
  PENGIRIMAN:  { icon: Truck,        chip: "bg-greenbg text-green",   dot: "bg-green" },
};

// D-030 (revisi 20 Agustus 2026) — "rincian pesanan" sebelumnya cuma
// ringkasan status/pembayaran/nilai, tanpa alamat pengiriman & detail
// produk (persis yang tampak di reference tracking marketplace: alamat,
// merk/ukuran kasur, keluhan, ongkir, estimasi pickup, dst). Semua field
// ini SUDAH ada di `order` (D-027/D-028/D-029) — tinggal ditampilkan.
const DETAIL_TONE = {
  address: { icon: MapPin,           hex: "#ea580c" },
  link:    { icon: Link2,            hex: "#0891b2" },
  bed:     { icon: Bed,              hex: "#7c3aed" },
  weight:  { icon: Weight,           hex: "#2563eb" },
  note:    { icon: MessageSquareText,hex: "#4b5563" },
  health:  { icon: HeartPulse,       hex: "#dc2626" },
  money:   { icon: Banknote,         hex: "#16a34a" },
  pickup:  { icon: CalendarClock,    hex: "#0891b2" },
  delivery: { icon: Truck,           hex: "#16a34a" },
  promo:   { icon: Tag,              hex: "#db2777" },
};
function DetailRow({ tone, label, children }) {
  const t = DETAIL_TONE[tone];
  const Icon = t.icon;
  return (
    <div className="flex gap-2.5 border-b border-line py-2.5 last:border-0">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: `${t.hex}1f`, color: t.hex }}
      >
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
        <div className="mt-0.5 text-[13px] text-ink">{children}</div>
      </div>
    </div>
  );
}

function DetailPesananSection({ order }) {
  const info = parseOrderNotes(order.notes);
  const berat = (order.weightEntries || []).map((w) => `${w.label}: ${w.beratKg} kg`).join(" · ");
  const layanan = (order.items || []).map((it) => it.layananName).filter(Boolean).join(", ");
  // Label baris dinamis (29 Agustus 2026) — dulu selalu "Kasur" krn cuma
  // ada satu lini produk. lineLabel fallback "Kasur" utk order lama
  // (sebelum kolom productLine ada, migrasi backfill semuanya ke KASUR).
  const lineLabel = PRODUCT_LINE_LABELS[order.productLine] || "Kasur";
  const produk = [PRODUCT_TYPE_LABELS[order.productType], info.merkKasur, info.ukuranKasur].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl bg-surface px-3 shadow-card">
      <DetailRow tone="address" label="Alamat Pengiriman">
        {order.deliveryAddress || order.deliveryCity ? (
          <>
            {order.deliveryAddress || ""}
            {order.deliveryCity && <span className="font-semibold"> · {order.deliveryCity}</span>}
          </>
        ) : <span className="text-ink3">—</span>}
      </DetailRow>

      {order.locationUrl && (
        <DetailRow tone="link" label="Link Lokasi">
          <a href={order.locationUrl} target="_blank" rel="noreferrer" className="text-accent underline">
            Buka lokasi ↗
          </a>
        </DetailRow>
      )}

      {(produk || layanan) && (
        <DetailRow tone="bed" label={`${lineLabel} & Layanan`}>
          {produk && <p>{produk}</p>}
          {layanan && <p className={cn(produk && "mt-0.5 text-ink2")}>{layanan}</p>}
        </DetailRow>
      )}

      {info.keluhanCustomer && (
        <DetailRow tone="note" label="Keluhan / Catatan">
          {info.keluhanCustomer}
        </DetailRow>
      )}

      {berat && (
        <DetailRow tone="weight" label="Berat Badan">
          {berat}
        </DetailRow>
      )}

      {order.healthStatus && (
        <DetailRow tone="health" label="Kondisi Kesehatan">
          <span className={order.healthStatus === "SAKIT" ? "font-semibold text-red" : "font-semibold text-green"}>
            {HEALTH_LABELS[order.healthStatus] || order.healthStatus}
          </span>
          {(order.complaintCategory || []).length > 0 && (
            <span className="text-ink2"> — {order.complaintCategory.map((c) => HEALTH_COMPLAINT_LABELS[c] || c).join(", ")}</span>
          )}
        </DetailRow>
      )}

      {(order.ongkir || order.ongkirKlaimGaransi) && (
        <DetailRow tone="money" label="Ongkir">
          {order.ongkir ? formatRupiah(order.ongkir) : "Rp0"}
          {order.ongkirKlaimGaransi ? ` · Klaim Garansi: ${formatRupiah(order.ongkirKlaimGaransi)}` : ""}
        </DetailRow>
      )}

      {(order.pickupEstimate || order.pickupConfirmedDate) && (
        <DetailRow tone="pickup" label="Jadwal Pick Up">
          {order.pickupEstimate && <p>{order.pickupEstimate}</p>}
          {order.pickupConfirmedDate && (
            <p className={cn(order.pickupEstimate && "mt-0.5 text-ink2")}>
              Pasti: {formatTanggal(order.pickupConfirmedDate)}
            </p>
          )}
        </DetailRow>
      )}

      {(order.deliveryEstimate || order.deliveryConfirmedDate) && (
        <DetailRow tone="delivery" label="Jadwal Kirim">
          {order.deliveryEstimate && <p>{order.deliveryEstimate}</p>}
          {order.deliveryConfirmedDate && (
            <p className={cn(order.deliveryEstimate && "mt-0.5 text-ink2")}>
              Pasti: {formatTanggal(order.deliveryConfirmedDate)}
            </p>
          )}
        </DetailRow>
      )}

      {order.promo && (
        <DetailRow tone="promo" label="Promo">
          {promoLabel(order.promo)}
        </DetailRow>
      )}
    </div>
  );
}

// Tab "Pembayaran" (D-023) — DP di konfirmasi order + riwayat pembayaran
// dari SEMUA sumber (sales di sini, driver di stop pengiriman D-011).
// Order.paymentStatus dihitung ULANG di backend tiap kali payment baru
// tercatat (services/paymentLedger.js) — `onRecorded` di sini cuma
// memicu Orders.jsx refetch daftar order supaya badge status langsung
// menampilkan nilai baru tanpa navigasi ulang.
function PaymentTab({ order, onRecorded }) {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("TRANSFER");
  const [photo, setPhoto] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");

  function load() {
    setError("");
    api.getOrderPayments(order.id).then(setPayments).catch((e) => setError(e.message));
  }
  useEffect(() => { setPayments(null); load(); }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const { url } = await api.uploadPaymentProof(order.id, fd);
      setPhoto(url);
    } catch (e2) {
      setFormErr("Gagal upload foto: " + e2.message);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    const amountInt = parseInt(amount, 10);
    if (!amountInt || amountInt <= 0) { setFormErr("Jumlah wajib diisi"); return; }
    setBusy(true);
    setFormErr("");
    try {
      await api.recordOrderPayment(order.id, { amount: amountInt, method, proofPhotoUrl: photo });
      setForm(false); setAmount(""); setMethod("TRANSFER"); setPhoto(null);
      load();
      onRecorded?.();
    } catch (e2) {
      setFormErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const paid = (payments || []).reduce((n, p) => n + p.amount, 0);
  const outstanding = Math.max((order.value || 0) - paid, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl bg-surface p-2.5 shadow-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink3">Sudah Dibayar</p>
          <p className="mt-0.5 text-[13px] font-bold text-green">{formatRupiah(paid)}</p>
        </div>
        <div className="rounded-xl bg-surface p-2.5 shadow-card">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink3">Sisa Tagihan</p>
          <p className={cn("mt-0.5 text-[13px] font-bold", outstanding > 0 ? "text-red" : "text-ink")}>
            {formatRupiah(outstanding)}
          </p>
        </div>
      </div>

      {error && <p className="text-[12px] text-red">{error}</p>}
      {!payments && !error && (
        <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      )}
      {payments?.length === 0 && (
        <p className="rounded-xl bg-surface px-3.5 py-3 text-center text-[12px] text-ink3 shadow-card">
          Belum ada pembayaran tercatat.
        </p>
      )}
      {payments?.map((p) => {
        const verified = p.verifications?.length > 0;
        return (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface p-2.5 shadow-card">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">{formatRupiah(p.amount)}</p>
              <p className="text-[11px] text-ink3">
                {PAYMENT_METHOD_LABEL[p.method] || p.method} · {p.recordedBy?.name || "—"} · {formatTanggal(p.createdAt)}
                {p.job?.type && (p.job.type === "PICKUP" ? " · saat ambil" : " · saat kirim")}
              </p>
            </div>
            {verified && <CheckCircle2 size={14} className="shrink-0 text-green" />}
          </div>
        );
      })}

      {!form ? (
        <button
          type="button" onClick={() => setForm(true)}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accentbg text-[13px] font-semibold text-accent"
        >
          <Wallet size={14} /> Catat Pembayaran
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl bg-surface p-3 shadow-card">
          <input
            type="number" inputMode="numeric" placeholder="Jumlah diterima (Rp)"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="h-10 rounded-lg border border-line px-3 text-[13px] outline-none focus:border-accent"
          />
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
              <button
                key={value} type="button" onClick={() => setMethod(value)}
                className={cn(
                  "h-9 rounded-lg border-2 text-[12px] font-medium",
                  method === value ? "border-accent bg-accentbg text-accent" : "border-line text-ink2"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-[12px] font-medium text-ink2">
            {uploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {photo ? "Foto siap" : "Foto Bukti (opsional)"}
            <input type="file" accept="image/*" hidden onChange={handlePhoto} disabled={uploadingPhoto} />
          </label>
          {formErr && <p className="text-[11px] text-red">{formErr}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setForm(false); setFormErr(""); }}
              className="h-9 flex-1 rounded-lg text-[12px] font-semibold text-ink2">Batal</button>
            <button
              type="button" disabled={busy} onClick={handleSave}
              className="h-9 flex-1 rounded-lg bg-accent text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : "Simpan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab "Dokumentasi" (D-015) — berkas foto per tahap produksi untuk order ini,
// dikumpulkan dari unit_stage_logs.photo_urls milik SEMUA unit order. Ini
// yang "kelebihan Sano" yang Gilang sebut: tiap proses/uji didokumentasikan
// dan dikirim ke customer.
//
// DUA cara pakai:
//  1. Klik foto → buka ukuran penuh di tab baru → simpan & forward manual
//     lewat WhatsApp pribadi sales (cara lama, tetap bisa dipakai).
//  2. Centang tahap yang mau dikirim → "Kirim ke Customer" → terkirim
//     LANGSUNG lewat WAHA ke chat WhatsApp customer ini (POST
//     /conversations/:id/send-documentation, backend/routes/conversations.js).
//     Manusia (sales) tetap yang MEMILIH & MEMICU — bukan sistem auto-kirim.
function DocumentationTab({ orderId, conversationId }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { sent, total } | { error }

  useEffect(() => {
    let batal = false;
    setLoading(true);
    setError("");
    setSelected(new Set());
    setSendResult(null);
    api.getOrderDocumentation(orderId)
      .then((r) => { if (!batal) setDoc(r); })
      .catch((e) => { if (!batal) setError(e.message); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [orderId]);

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function handleSend() {
    if (!conversationId || selected.size === 0) return;
    setSending(true);
    setSendResult(null);
    try {
      const entries = [...selected].map((i) => doc.entries[i]);
      const result = await api.sendDocumentation(conversationId, orderId, entries);
      setSendResult({ sent: result.sent, total: result.total });
      setSelected(new Set());
    } catch (e) {
      setSendResult({ error: e.message });
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  if (error) {
    return <p className="rounded-xl bg-redbg px-3.5 py-3 text-[12px] text-red">{error}</p>;
  }

  if (!doc || doc.entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-xl bg-surface px-4 py-8 text-center shadow-card">
        <ImageOff className="text-ink3" size={24} />
        <p className="text-[13px] font-semibold text-ink2">Belum ada dokumentasi</p>
        <p className="text-[11px] leading-relaxed text-ink3">
          Foto muncul di sini begitu driver mendokumentasikan penjemputan, kepala
          produksi mencatat tahap yang wajib foto, atau driver menyelesaikan pengiriman.
        </p>
      </div>
    );
  }

  // Dikelompokkan per KATEGORI mengikuti urutan nyata di lapangan
  // (Penjemputan → Produksi → Pengiriman), lalu di dalam Produksi masih
  // dipecah per UNIT — order multi-kasur (mis. hotel) perlu jelas "ini foto
  // kasur yang mana", bukan daftar foto tercampur (D-002).
  //
  // Index ASLI di doc.entries dipertahankan di `_idx` (bukan index-dalam-grup)
  // supaya toggle/selected tetap merujuk baris yang benar setelah dikelompokkan
  // dua lapis.
  const KATEGORI = [
    { key: "PENJEMPUTAN", label: "Penjemputan", sub: "Bukti kondisi kasur saat diambil dari customer" },
    { key: "PRODUKSI",    label: "Proses Produksi", sub: "Foto per tahap pengerjaan di bengkel" },
    { key: "PENGIRIMAN",  label: "Pengiriman", sub: "Bukti kasur sudah sampai & diterima" },
  ];
  const withIdx = doc.entries.map((e, i) => ({ ...e, _idx: i }));

  return (
    <div className="flex flex-col gap-4 pb-16">
      <p className="text-[11px] text-ink3">
        {doc.totalPhotos} foto sepanjang perjalanan order ini. Klik foto untuk buka
        ukuran penuh (simpan & forward manual), atau centang lalu kirim langsung
        lewat WhatsApp CRM.
      </p>

      {KATEGORI.map(({ key, label, sub }) => {
        const items = withIdx.filter((e) => e.kategori === key);
        if (items.length === 0) return null;
        // Produksi dipecah lagi per unit; penjemputan/pengiriman itu level
        // ORDER (satu job bisa membawa beberapa unit), jadi tidak dipecah.
        const grup = key === "PRODUKSI"
          ? Object.entries(items.reduce((acc, e) => {
              (acc[e.unitCode || "—"] = acc[e.unitCode || "—"] || []).push(e);
              return acc;
            }, {}))
          : [[null, items]];
        const tone = KATEGORI_TONE[key];
        const ToneIcon = tone.icon;

        return (
          <div key={key}>
            <div className="mb-2 flex items-center gap-2 border-b border-line pb-1.5">
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", tone.chip)}>
                <ToneIcon size={13} />
              </span>
              <div>
                <p className="text-[12px] font-bold text-ink">{label}</p>
                <p className="text-[10.5px] text-ink3">{sub}</p>
              </div>
            </div>
            {grup.map(([unitCode, entries]) => (
              <div key={unitCode || key} className="mb-2">
                {unitCode && (
                  <p className="mb-1.5 font-mono text-[11px] font-semibold text-ink2">{unitCode}</p>
                )}
                <div className="flex flex-col gap-2.5">
            {entries.map((entry) => (
              <div
                key={entry._idx}
                className={cn(
                  "rounded-xl border-2 bg-surface p-2.5 shadow-card transition-colors",
                  selected.has(entry._idx) ? "border-accent" : "border-transparent"
                )}
              >
                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(entry._idx)}
                      onChange={() => toggle(entry._idx)}
                    />
                    <span className="text-[12px] font-semibold text-ink">{entry.stageLabel}</span>
                  </span>
                  <span className="text-[10px] text-ink3">{formatTanggal(entry.recordedAt)}</span>
                </label>
                {entry.note && <p className="mt-0.5 pl-6 text-[11px] text-ink2">{entry.note}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                  {entry.photoUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      <img
                        src={url} alt={entry.stageLabel}
                        className="h-16 w-16 rounded-lg object-cover transition-opacity hover:opacity-80"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* Tanda tangan customer — DIPISAH dari daftar foto & TIDAK bisa
          dicentang untuk dikirim. Ini bukti internal serah terima; mengirim
          balik tanda tangan seseorang ke WhatsApp-nya sendiri tidak ada
          gunanya. Ketiadaannya WAJAR (opsional by design — penerima tidak
          selalu ada di tempat), jadi blok ini cuma muncul kalau memang ada. */}
      {doc.tandaTangan && (
        <div>
          <div className="mb-2 flex items-center gap-2 border-b border-line pb-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-greenbg text-green">
              <PenTool size={12} />
            </span>
            <div>
              <p className="text-[12px] font-bold text-ink">Tanda Tangan Penerima</p>
              <p className="text-[10.5px] text-ink3">
                Bukti serah terima internal — tidak ikut dikirim ke customer
              </p>
            </div>
          </div>
          <div className="rounded-xl border-2 border-green/30 bg-greenbg/40 p-2.5 shadow-card">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-green">
              <CheckCircle2 size={13} /> Diterima
            </div>
            <img
              src={doc.tandaTangan.url} alt="Tanda tangan penerima"
              className="h-20 rounded-lg bg-white object-contain px-2"
            />
            <p className="mt-1.5 text-[10.5px] text-ink3">
              {formatTanggal(doc.tandaTangan.waktu)}
              {doc.tandaTangan.driver && ` · diterima oleh driver ${doc.tandaTangan.driver}`}
            </p>
          </div>
        </div>
      )}

      {/* Bar kirim — absolute relatif ke <aside> (aside sudah `fixed`, jadi
          jadi containing block untuk descendant absolute-nya) supaya bar ini
          hugs LEBAR DRAWER, bukan lebar viewport, dan tidak ikut scroll
          bersama daftar foto yang panjang. */}
      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-line bg-base px-4 py-3 shadow-popover">
        {sendResult?.sent > 0 && (
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-green">
            <CheckCircle2 size={14} /> Terkirim {sendResult.sent}/{sendResult.total} foto ke customer.
          </p>
        )}
        {sendResult?.error && (
          <p className="mb-2 text-[12px] font-medium text-red">{sendResult.error}</p>
        )}
        {!conversationId ? (
          <p className="text-center text-[11px] text-ink3">
            Belum ada percakapan WhatsApp untuk pelanggan ini — tidak bisa kirim langsung.
          </p>
        ) : (
          <button
            type="button"
            disabled={selected.size === 0 || sending}
            onClick={handleSend}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[13px]
                       font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {sending ? "Mengirim…" : selected.size > 0 ? `Kirim ${selected.size} dokumentasi ke customer` : "Pilih dokumentasi untuk dikirim"}
          </button>
        )}
      </div>
    </div>
  );
}

// Riwayat status satu order. Sumbernya tabel order_status_transitions yang
// APPEND-ONLY dan TIDAK bisa di-backfill — jadi untuk order yang dibuat sebelum
// tabel itu ada, riwayatnya memang kosong. Empty state di bawah MENJELASKAN
// itu, bukan sekadar bilang "tidak ada data" (yang terbaca seperti fitur rusak).
const TONE = {
  PENDING: "bg-orange", PICKUP: "bg-accent", PROCESSING: "bg-accent",
  READY: "bg-accent", DELIVERED: "bg-green", CANCELLED: "bg-red",
};

export default function OrderTimelineDrawer({ order, onClose, onOpenChat, onPaymentRecorded }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState("status"); // "status" | "dokumentasi" | "pembayaran"

  // Balik ke tab Status tiap kali drawer dibuka order BARU — supaya sales
  // yang barusan lihat dokumentasi order sebelumnya tidak salah kira sedang
  // lihat dokumentasi order yang baru dibuka.
  useEffect(() => { if (order) setTab("status"); }, [order?.id]);

  useEffect(() => {
    if (!order) { setData(null); return; }
    let batal = false;
    setLoading(true);
    api.getOrderTimeline(order.id)
      .then((r) => { if (!batal) setData(r); })
      .catch(() => { if (!batal) setData(null); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [order]);

  // Esc menutup drawer — pola yang sama dengan drawer lain di app.
  useEffect(() => {
    if (!order) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, onClose]);

  if (!order) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog" aria-modal="true" aria-label="Riwayat status order"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-base shadow-popover"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">
              {order.customerName || order.customerPhone || "Tanpa nama"}
            </p>
            <span className="mt-1 inline-flex items-center gap-1 rounded-chip bg-greenbg px-2 py-0.5 font-mono text-[11px] font-bold text-green">
              <Hash size={10} />{order.orderNumber || "tanpa ID order"}
            </span>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Tutup"
            className="shrink-0 rounded-md p-1.5 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Ringkasan order */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { l: "Status", v: ORDER_STATUS_LABELS[order.status] || order.status },
              { l: "Pembayaran", v: PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus },
              { l: "Nilai", v: formatRupiah(order.value || 0) },
              { l: "Lama di status", v: `${order.daysInStatus} hari${order.daysInStatusPerkiraan ? "*" : ""}` },
            ].map((k) => (
              <div key={k.l} className="rounded-xl bg-surface p-2.5 shadow-card">
                <p className="text-[10px] font-medium uppercase tracking-wide text-ink3">{k.l}</p>
                <p className="mt-0.5 text-[13px] font-bold text-ink">{k.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <DetailPesananSection order={order} />
          </div>

          {order.conversationId && (
            <button
              type="button"
              onClick={() => { onOpenChat(order); onClose(); }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accentbg px-3 py-2.5 text-[13px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
            >
              <MessageSquare size={14} /> Buka chat customer
            </button>
          )}

          {/* Tab Status/Dokumentasi — dua sumber data terpisah (order_status_
              transitions vs unit_stage_logs.photo_urls), disatukan di satu
              drawer supaya sales tidak perlu pindah layar (PRD FR-G-08). */}
          <div className="mt-4 flex gap-1 rounded-xl bg-inset p-1">
            {[
              { key: "status", label: "Status", icon: Clock },
              { key: "dokumentasi", label: "Dokumentasi", icon: Camera },
              { key: "pembayaran", label: "Pembayaran", icon: Wallet },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold transition-colors",
                  tab === t.key ? "bg-base text-ink shadow-card" : "text-ink3 hover:text-ink2"
                )}
              >
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>

          {tab === "dokumentasi" ? (
            <div className="mt-4">
              <DocumentationTab orderId={order.id} conversationId={order.conversationId} />
            </div>
          ) : tab === "pembayaran" ? (
            <div className="mt-4">
              <PaymentTab order={order} onRecorded={onPaymentRecorded} />
            </div>
          ) : (
          <>
          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : data?.riwayatKosong ? (
            <div className="flex flex-col items-center gap-1.5 rounded-xl bg-surface px-4 py-8 text-center shadow-card">
              <Timer className="text-ink3" size={24} />
              <p className="text-[13px] font-semibold text-ink2">Belum ada riwayat</p>
              <p className="text-[11px] leading-relaxed text-ink3">
                Sistem baru mulai merekam perpindahan status order, dan perpindahan
                sebelum itu tidak bisa dihitung ulang. Riwayat akan terisi begitu
                status order ini diubah berikutnya.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col">
              {/* Titik awal: order dibuat. Selalu diketahui dari createdAt, jadi
                  aman ditampilkan walau riwayat transisi masih kosong. */}
              <li className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-ink3" />
                  <span className="w-px flex-1 bg-line" />
                </div>
                <div className="pb-4">
                  <p className="text-[13px] font-semibold text-ink">Order dibuat</p>
                  <p className="text-[11px] text-ink3">{formatTanggal(data?.dibuatPada || order.createdAt)}</p>
                </div>
              </li>

              {(data?.timeline || []).map((t, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", TONE[t.toStatus] || "bg-ink3")} />
                    {i < (data.timeline.length - 1) && <span className="w-px flex-1 bg-line" />}
                  </div>
                  <div className={cn(i < data.timeline.length - 1 && "pb-4")}>
                    <p className="text-[13px] font-semibold text-ink">
                      {ORDER_STATUS_LABELS[t.fromStatus] || t.fromStatus}
                      {" → "}
                      {ORDER_STATUS_LABELS[t.toStatus] || t.toStatus}
                    </p>
                    <p className="text-[11px] text-ink3">
                      {formatTanggal(t.createdAt)}
                      {t.changedBy && ` · oleh ${t.changedBy}`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink2">
                      {t.berjalan ? "Berjalan " : "Bertahan "}
                      <strong>{t.hariDiStatus} hari</strong> di {ORDER_STATUS_LABELS[t.toStatus] || t.toStatus}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          </>
          )}

          {order.hasComplaint && (
            <div className="mt-5 rounded-xl bg-redbg px-3.5 py-3">
              <p className="text-xs font-bold text-red">Ada komplain</p>
              {order.complaintDetail && (
                <p className="mt-1 text-[11px] leading-relaxed text-ink">{order.complaintDetail}</p>
              )}
              {order.complaintDate && (
                <p className="mt-1 text-[11px] text-ink3">{formatTanggal(order.complaintDate)}</p>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
