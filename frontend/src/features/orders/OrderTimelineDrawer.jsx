import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Clock, MessageSquare, Timer, Camera, ImageOff, Send, Loader2, CheckCircle2,
  Wallet, PackageCheck, Wrench, Truck, PenTool, Hash,
  Bed, HeartPulse, Tag, FileText, Ban, ShieldCheck,
} from "lucide-react";
import InvoicePanel from "./InvoicePanel.jsx";
import WarrantyPanel from "./WarrantyPanel.jsx";
import ReadinessPanel from "./ReadinessPanel.jsx";
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

// D-030 (revisi 20 Agustus 2026, redesain 3 Sep 2026) — "rincian pesanan"
// sebelumnya cuma ringkasan status/pembayaran/nilai, tanpa alamat
// pengiriman & detail produk (persis yang tampak di reference tracking
// marketplace: alamat, merk/ukuran kasur, keluhan, ongkir, estimasi
// pickup, dst). Semua field ini SUDAH ada di `order` (D-027/D-028/D-029)
// — tinggal ditampilkan. Redesain 3 Sep 2026 mengelompokkannya jadi kartu
// bertema (lihat KartuTema/BarisMini di bawah) alih-alih 1 daftar baris
// panjang tak berkelompok.

// Header kartu bertema (3 Sep 2026, redesain "Rincian Order") — ikon dalam
// badge bulat berwarna + strip aksen tipis di tepi atas kartu, supaya tiap
// kelompok info (Produk, Pengiriman, Kondisi) kebaca beda sekilas mata
// tanpa harus baca teksnya dulu — sebelumnya SEMUA baris ditumpuk rata
// dalam 1 kartu panjang berdivider tipis, jadi monoton (feedback owner:
// "ga boring, estetik").
function KartuTema({ icon: Icon, hex, title, right, children }) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-card">
      <div className="h-[3px]" style={{ background: hex }} />
      <div className="p-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
              style={{ background: `${hex}1f`, color: hex }}
            >
              <Icon size={14} />
            </span>
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-ink2">{title}</p>
          </div>
          {right}
        </div>
        {children}
      </div>
    </div>
  );
}

// Baris ringkas TANPA ikon sendiri (dipakai DI DALAM KartuTema — ikon
// kelompoknya sudah ada di header, mengulang ikon per baris di dalamnya
// cuma bikin ramai tanpa nambah informasi).
function BarisMini({ label, children }) {
  return (
    <div className="border-b border-line py-2 last:border-0 last:pb-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function DetailPesananSection({ order }) {
  const info = parseOrderNotes(order.notes);
  const berat = (order.weightEntries || []).map((w) => `${w.label}: ${w.beratKg} kg`).join(" · ");
  const items = order.items || [];
  // Label baris dinamis (29 Agustus 2026) — dulu selalu "Kasur" krn cuma
  // ada satu lini produk. lineLabel fallback "Kasur" utk order lama
  // (sebelum kolom productLine ada, migrasi backfill semuanya ke KASUR).
  const lineLabel = PRODUCT_LINE_LABELS[order.productLine] || "Kasur";
  const spesifikasi = [PRODUCT_TYPE_LABELS[order.productType], info.merkKasur, info.ukuranKasur].filter(Boolean);

  const adaPengiriman = order.deliveryAddress || order.deliveryCity || order.locationUrl
    || order.pickupEstimate || order.pickupConfirmedDate
    || order.deliveryEstimate || order.deliveryConfirmedDate
    || order.ongkir || order.ongkirKlaimGaransi;
  const adaKondisi = info.keluhanCustomer || berat || order.healthStatus || order.promo;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Produk & Layanan — sekarang RINCIAN PER ITEM + HARGA (sebelumnya
          cuma nama layanan digabung koma tanpa harga sama sekali, sales
          harus buka tab lain buat tahu breakdown-nya). Chip spesifikasi
          (merk/ukuran/jenis) dipisah dari daftar item supaya jelas mana
          "atribut kasur" vs "apa yang ditagihkan". */}
      <KartuTema icon={Bed} hex="#7c3aed" title={`${lineLabel} & Layanan`}>
        {spesifikasi.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {spesifikasi.map((s) => (
              <span key={s} className="rounded-chip bg-inset px-2.5 py-1 text-[11.5px] font-semibold text-ink2">
                {s}
              </span>
            ))}
          </div>
        )}
        {items.length > 0 ? (
          <div>
            {items.map((it, i) => (
              <div key={it.id || i} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0">
                <span className="text-[12.5px] text-ink">{it.layananName}</span>
                <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink">{formatRupiah(it.harga)}</span>
              </div>
            ))}
            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink3">Total</span>
              <span className="text-[14px] font-bold tabular-nums text-accent">{formatRupiah(order.value || 0)}</span>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink3">Belum ada item layanan tercatat.</p>
        )}
      </KartuTema>

      {/* Pengiriman — alamat/lokasi/jadwal/ongkir dikelompokkan jadi 1
          kartu (dulu tersebar sebagai baris-baris terpisah bercampur
          dengan info produk & kondisi, padahal semuanya soal "kapan &
          ke mana barang ini pergi"). */}
      {adaPengiriman && (
        <KartuTema icon={Truck} hex="#ea580c" title="Pengiriman">
          {(order.deliveryAddress || order.deliveryCity) && (
            <BarisMini label="Alamat">
              {order.deliveryAddress || ""}
              {order.deliveryCity && <span className="font-semibold"> · {order.deliveryCity}</span>}
            </BarisMini>
          )}
          {order.locationUrl && (
            <BarisMini label="Link Lokasi">
              <a href={order.locationUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
                Buka lokasi ↗
              </a>
            </BarisMini>
          )}
          {(order.pickupEstimate || order.pickupConfirmedDate) && (
            <BarisMini label="Jadwal Pick Up">
              {order.pickupEstimate && <p>{order.pickupEstimate}</p>}
              {order.pickupConfirmedDate && (
                <p className={cn(order.pickupEstimate && "mt-0.5 text-ink2")}>
                  Pasti: {formatTanggal(order.pickupConfirmedDate)}
                </p>
              )}
            </BarisMini>
          )}
          {(order.deliveryEstimate || order.deliveryConfirmedDate) && (
            <BarisMini label="Jadwal Kirim">
              {order.deliveryEstimate && <p>{order.deliveryEstimate}</p>}
              {order.deliveryConfirmedDate && (
                <p className={cn(order.deliveryEstimate && "mt-0.5 text-ink2")}>
                  Pasti: {formatTanggal(order.deliveryConfirmedDate)}
                </p>
              )}
            </BarisMini>
          )}
          {(order.ongkir || order.ongkirKlaimGaransi) && (
            <BarisMini label="Ongkir">
              {order.ongkir ? formatRupiah(order.ongkir) : "Rp0"}
              {order.ongkirKlaimGaransi ? ` · Klaim Garansi: ${formatRupiah(order.ongkirKlaimGaransi)}` : ""}
            </BarisMini>
          )}
        </KartuTema>
      )}

      {/* Kondisi & Catatan — keluhan, berat badan, kesehatan, promo. */}
      {adaKondisi && (
        <KartuTema icon={HeartPulse} hex="#475569" title="Kondisi & Catatan">
          {info.keluhanCustomer && (
            <BarisMini label="Keluhan / Catatan">{info.keluhanCustomer}</BarisMini>
          )}
          {berat && <BarisMini label="Berat Badan">{berat}</BarisMini>}
          {order.healthStatus && (
            <BarisMini label="Kondisi Kesehatan">
              <span className={order.healthStatus === "SAKIT" ? "font-semibold text-red" : "font-semibold text-green"}>
                {HEALTH_LABELS[order.healthStatus] || order.healthStatus}
              </span>
              {(order.complaintCategory || []).length > 0 && (
                <span className="text-ink2"> — {order.complaintCategory.map((c) => HEALTH_COMPLAINT_LABELS[c] || c).join(", ")}</span>
              )}
            </BarisMini>
          )}
          {order.promo && (
            <BarisMini label="Promo">
              <span className="inline-flex items-center gap-1 rounded-chip bg-accentbg px-2 py-0.5 font-semibold text-accent">
                <Tag size={11} /> {promoLabel(order.promo)}
              </span>
            </BarisMini>
          )}
        </KartuTema>
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
function PaymentTab({ order, onRecorded, canEditLunas }) {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("TRANSFER");
  const [photo, setPhoto] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [editDpTarget, setEditDpTarget] = useState(false);
  const [dpTargetDraft, setDpTargetDraft] = useState("");
  const [savingDpTarget, setSavingDpTarget] = useState(false);
  const [dpTargetErr, setDpTargetErr] = useState("");

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

  async function handleSaveDpTarget() {
    const val = dpTargetDraft.trim();
    const parsed = val === "" ? null : parseInt(val, 10);
    if (val !== "" && (!parsed || parsed <= 0)) { setDpTargetErr("DP disepakati wajib angka lebih dari 0 (atau kosongkan)"); return; }
    setDpTargetErr("");
    setSavingDpTarget(true);
    try {
      await api.updateOrder(order.id, { dpTarget: parsed });
      setEditDpTarget(false);
      onRecorded?.();
    } catch (e2) {
      setDpTargetErr(e2.message);
    } finally {
      setSavingDpTarget(false);
    }
  }

  const [cancellingId, setCancellingId] = useState(null);
  async function handleCancel(paymentId) {
    if (!window.confirm("Batalkan entri pembayaran ini? Riwayatnya tetap tersimpan (ditandai batal), tidak dihapus.")) return;
    setCancellingId(paymentId);
    try {
      await api.cancelOrderPayment(order.id, paymentId, {});
      load();
      onRecorded?.();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setCancellingId(null);
    }
  }

  // Entri yang dibatalkan TETAP tampil (jejak audit), tapi TIDAK ikut
  // dihitung — konsisten dengan recomputeOrderPaymentStatus() di backend.
  const paid = (payments || []).filter((p) => !p.cancelledAt).reduce((n, p) => n + p.amount, 0);
  const outstanding = Math.max((order.value || 0) - paid, 0);
  const dpKurang = order.dpTarget ? Math.max(order.dpTarget - paid, 0) : 0;

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

      {/* DP disepakati (2 Sep 2026) — MURNI pembanding terhadap kesepakatan
          awal, terpisah dari Sisa Tagihan di atas (itu tetap terhadap harga
          PENUH order, bukan target DP). Editable di sini (bukan form
          terpisah) karena inilah tempat sales sudah mengurus pembayaran. */}
      <div className="rounded-xl bg-surface p-2.5 shadow-card">
        {!editDpTarget ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-ink3">DP Disepakati</p>
              <div className="flex items-center gap-1.5">
                <p className="text-[12px] font-semibold text-ink2">
                  {order.dpTarget > 0 ? formatRupiah(order.dpTarget) : "Belum diatur"}
                </p>
                {canEditLunas && (
                  <button
                    type="button"
                    onClick={() => { setDpTargetDraft(order.dpTarget ? String(order.dpTarget) : ""); setEditDpTarget(true); }}
                    className="rounded-lg p-1 text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
                    title="Atur DP yang disepakati"
                  >
                    <PenTool size={12} />
                  </button>
                )}
              </div>
            </div>
            {order.dpTarget > 0 && (
              dpKurang > 0 ? (
                <p className="mt-1 text-[11.5px] font-semibold text-orange">
                  Kurang {formatRupiah(dpKurang)} dari kesepakatan DP
                </p>
              ) : (
                <p className="mt-1 text-[11.5px] font-semibold text-green">DP terpenuhi</p>
              )
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              type="number" inputMode="numeric" placeholder="Nominal DP disepakati (Rp) — kosongkan untuk hapus"
              value={dpTargetDraft} onChange={(e) => setDpTargetDraft(e.target.value)} autoFocus
              className="h-9 rounded-lg border border-line px-3 text-[12.5px] outline-none focus:border-accent"
            />
            {dpTargetErr && <p className="text-[11px] text-red">{dpTargetErr}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEditDpTarget(false); setDpTargetErr(""); }}
                className="h-8 flex-1 rounded-lg text-[11.5px] font-semibold text-ink2">Batal</button>
              <button
                type="button" disabled={savingDpTarget} onClick={handleSaveDpTarget}
                className="h-8 flex-1 rounded-lg bg-accent text-[11.5px] font-semibold text-white disabled:opacity-40"
              >
                {savingDpTarget ? <Loader2 size={12} className="mx-auto animate-spin" /> : "Simpan"}
              </button>
            </div>
          </div>
        )}
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
        const batal = !!p.cancelledAt;
        return (
          <div key={p.id} className={cn("flex items-center justify-between gap-2 rounded-xl bg-surface p-2.5 shadow-card", batal && "opacity-50")}>
            <div className="min-w-0">
              <p className={cn("text-[13px] font-semibold text-ink", batal && "line-through")}>{formatRupiah(p.amount)}</p>
              <p className="text-[11px] text-ink3">
                {PAYMENT_METHOD_LABEL[p.method] || p.method} · {p.recordedBy?.name || "—"} · {formatTanggal(p.createdAt)}
                {p.job?.type && (p.job.type === "PICKUP" ? " · saat ambil" : " · saat kirim")}
              </p>
              {batal && (
                <p className="mt-0.5 text-[11px] font-medium text-red">
                  Dibatalkan{p.cancelledBy?.name ? ` oleh ${p.cancelledBy.name}` : ""}
                </p>
              )}
            </div>
            {batal ? (
              <Ban size={14} className="shrink-0 text-red" />
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                {verified && <CheckCircle2 size={14} className="text-green" />}
                {canEditLunas && (
                  <button
                    type="button"
                    disabled={cancellingId === p.id}
                    onClick={() => handleCancel(p.id)}
                    title="Batalkan entri ini (koreksi salah input)"
                    className="rounded-lg p-1 text-ink3 transition-colors hover:bg-redbg hover:text-red disabled:opacity-40"
                  >
                    {cancellingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Order LUNAS + bukan admin (1 September 2026) — kunci proaktif di UI
          supaya sales tidak isi form lalu baru kaget 403 saat submit; alasan
          & pesan yang sama dengan guardOrderLocked() di backend, yang tetap
          jadi penegak sesungguhnya (ini cuma UX). */}
      {order.paymentStatus === "LUNAS" && !canEditLunas ? (
        <p className="flex items-center gap-1.5 rounded-xl bg-inset px-3.5 py-3 text-center text-[12px] text-ink3">
          <Wallet size={14} className="shrink-0" />
          Order ini sudah LUNAS dan terkunci — cuma admin yang bisa mencatat pembayaran baru.
        </p>
      ) : !form ? (
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

export default function OrderTimelineDrawer({ order, onClose, onOpenChat, onPaymentRecorded, canEditLunas = false }) {
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

  // Animasi slide-in/out (31 Agustus 2026) — sebelumnya drawer ini muncul
  // TANPA transisi sama sekali (langsung `return null` begitu `order` jadi
  // null, jadi AnimatePresence tidak sempat memutar animasi keluar). Isi
  // JSX di bawah dibuat memakai `o` (SNAPSHOT order terakhir yang tidak-null),
  // BUKAN `order` (prop asli) — supaya saat `order` sudah jadi null (drawer
  // sedang animasi menutup), konten yang masih tampil di layar tidak crash
  // membaca field dari null. "Adjust state during render" ini pola resmi
  // React utk derive state dari prop tanpa efek tambahan/flash 1 frame.
  const [frozen, setFrozen] = useState(order);
  if (order && order !== frozen) setFrozen(order);
  const o = order || frozen;

  return (
    <AnimatePresence>
      {order && o && (
      <>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.aside
        key="drawer"
        role="dialog" aria-modal="true" aria-label="Riwayat status order"
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-base shadow-popover"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">
              {o.customerName || o.customerPhone || "Tanpa nama"}
            </p>
            <span className="mt-1 inline-flex items-center gap-1 rounded-chip bg-greenbg px-2 py-0.5 font-mono text-[11px] font-bold text-green">
              <Hash size={10} />{o.orderNumber || "tanpa ID order"}
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
              { l: "Status", v: ORDER_STATUS_LABELS[o.status] || o.status },
              { l: "Pembayaran", v: PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus },
              { l: "Nilai", v: formatRupiah(o.value || 0) },
              { l: "Lama di status", v: `${o.daysInStatus} hari${o.daysInStatusPerkiraan ? "*" : ""}` },
            ].map((k) => (
              <div key={k.l} className="rounded-xl bg-surface p-2.5 shadow-card">
                <p className="text-[10px] font-medium uppercase tracking-wide text-ink3">{k.l}</p>
                <p className="mt-0.5 text-[13px] font-bold text-ink">{k.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <ReadinessPanel order={o} onOpenChat={(ord) => { onOpenChat(ord); onClose(); }} />
          </div>

          <div className="mt-3">
            <DetailPesananSection order={o} />
          </div>

          {o.conversationId && (
            <button
              type="button"
              onClick={() => { onOpenChat(o); onClose(); }}
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
              { key: "dokumentasi", label: "Dokumen", icon: Camera },
              { key: "pembayaran", label: "Bayar", icon: Wallet },
              { key: "invoice", label: "Invoice", icon: FileText },
              { key: "garansi", label: "Guarantee", icon: ShieldCheck },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-center text-[11px] font-semibold leading-tight transition-colors",
                  tab === t.key ? "bg-base text-ink shadow-card" : "text-ink3 hover:text-ink2"
                )}
              >
                <t.icon size={13} className="shrink-0" /> <span>{t.label}</span>
              </button>
            ))}
          </div>

          {tab === "dokumentasi" ? (
            <div className="mt-4">
              <DocumentationTab orderId={o.id} conversationId={o.conversationId} />
            </div>
          ) : tab === "pembayaran" ? (
            <div className="mt-4">
              <PaymentTab order={o} onRecorded={onPaymentRecorded} canEditLunas={canEditLunas} />
            </div>
          ) : tab === "invoice" ? (
            <div className="mt-4">
              {/* onChanged: pembayaran/status invoice bisa ikut mengubah
                  ringkasan order di atas — pakai callback yang SAMA dengan
                  tab Pembayaran supaya papan order di belakang ikut segar. */}
              <InvoicePanel orderId={o.id} onChanged={onPaymentRecorded} />
            </div>
          ) : tab === "garansi" ? (
            <div className="mt-4">
              <WarrantyPanel orderId={o.id} order={o} onChanged={onPaymentRecorded} />
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
                  <p className="text-[11px] text-ink3">{formatTanggal(data?.dibuatPada || o.createdAt)}</p>
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

          {o.hasComplaint && (
            <div className="mt-5 rounded-xl bg-redbg px-3.5 py-3">
              <p className="text-xs font-bold text-red">Ada komplain</p>
              {o.complaintDetail && (
                <p className="mt-1 text-[11px] leading-relaxed text-ink">{o.complaintDetail}</p>
              )}
              {o.complaintDate && (
                <p className="mt-1 text-[11px] text-ink3">{formatTanggal(o.complaintDate)}</p>
              )}
            </div>
          )}
        </div>
      </motion.aside>
      </>
      )}
    </AnimatePresence>
  );
}
