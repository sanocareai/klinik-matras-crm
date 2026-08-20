import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronUp, Trash2, AlertTriangle, Lock, Copy, Check, PackageSearch,
  Weight, Bed, Ruler, MapPin, HeartPulse, CalendarClock, Link2, Tag, Banknote, MessageSquareText, Send, Truck,
} from "lucide-react";
import { api } from "../../api.js";
import OrderTimelineDrawer from "../../features/orders/OrderTimelineDrawer.jsx";
import {
  formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_BADGE, PAYMENT_STATUSES, KOTA_LIST,
  HEALTH_COMPLAINT_LABELS, HEALTH_COMPLAINT_OPTIONS,
  parseOrderNotes, buildOrderNotes, promoLabel,
} from "../../utils/format.js";
import { isAdminUser } from "../../lib/roles.js";

// D-025 (revisi 19 Agustus 2026): order yang sudah LUNAS dikunci dari
// SALES/role lain — cuma admin yang bisa mengedit lagi. Backend
// (guardOrderLocked() di routes/orders.js) yang benar-benar menegakkan ini;
// helper di sini cuma untuk UI supaya sales tidak klik lalu kaget oleh error.
// Pemicunya SEMPAT status DELIVERED, diubah setelah tes pilot: order yang
// sudah terkirim tapi BELUM lunas (COD belum ditagih, dst) ternyata tetap
// butuh diedit sales — uang yang sudah pindah tangan itu yang perlu dijaga.
function currentUserIsAdmin() {
  try { return isAdminUser(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; }
}

// Jenis Layanan/Merk Kasur/Ukuran Kasur BUKAN lagi hardcode di sini — diambil
// dari GET /api/master-data/order-options (satu sumber dipakai web & mobile,
// lihat backend/src/constants/orderOptions.js) supaya rename/tambah opsi
// (mis. nama layanan) cukup di satu tempat.
const EMPTY_ORDER_OPTIONS = { jenisLayanan: [], merkKasur: [], ukuranKasur: [] };

// Label & ikon untuk pilihan kategori order
const CATEGORY_OPTIONS = [
  { value: "LAYANAN", icon: "🔧", label: "Service / Upgrade", sub: "Upgrade fondasi, lapisan, ganti kain, dsb." },
  { value: "BARU",    icon: "🛏️", label: "Kasur Baru",        sub: "Pembelian kasur baru" },
  { value: "SEWA",    icon: "📅", label: "Kasur Sewa",        sub: "Sewa kasur" },
];

const CATEGORY_LABELS = { LAYANAN: "Service/Upgrade", BARU: "Kasur Baru", SEWA: "Kasur Sewa" };
const CATEGORY_BADGE  = {
  LAYANAN: { bg: "#ede9fe", color: "#5b21b6" },
  BARU:    { bg: "#dcfce7", color: "#166534" },
  SEWA:    { bg: "#dbeafe", color: "#1e40af" },
};

function newItem() {
  return { key: Date.now() + Math.random(), layananName: "", harga: "" };
}

function newWeightEntry() {
  return { key: Date.now() + Math.random(), label: "", beratKg: "" };
}

const ORDER_STATUS_BADGE = {
  PENDING:    { bg: "#fef3c7", color: "#92400e" },
  PICKUP:     { bg: "#dbeafe", color: "#1e40af" },
  PROCESSING: { bg: "#ede9fe", color: "#5b21b6" },
  READY:      { bg: "#ccfbf1", color: "#065f46" },
  DELIVERED:  { bg: "#dcfce7", color: "#166534" },
  CANCELLED:  { bg: "#fee2e2", color: "#991b1b" },
};

function formatTanggal(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

// D-029/D-030 (20 Agustus 2026) — label field polos ("BERAT BADAN", "KOTA",
// dst) diganti chip ikon berwarna per kelompok, supaya form order yang
// tadinya satu warna abu-abu rata semua bisa dipindai sekilas ("oh ini
// bagian alamat, ini bagian kesehatan") tanpa baca teks satu-satu dulu —
// pola yang sama dipakai OrderTimelineDrawer untuk kategori dokumentasi.
const FIELD_TONE = {
  weight:  { icon: Weight,        hex: "#2563eb" },
  bed:     { icon: Bed,           hex: "#7c3aed" },
  size:    { icon: Ruler,         hex: "#7c3aed" },
  address: { icon: MapPin,        hex: "#ea580c" },
  health:  { icon: HeartPulse,    hex: "#dc2626" },
  money:   { icon: Banknote,      hex: "#16a34a" },
  pickup:  { icon: CalendarClock, hex: "#0891b2" },
  delivery: { icon: Truck,        hex: "#16a34a" },
  link:    { icon: Link2,         hex: "#0891b2" },
  promo:   { icon: Tag,           hex: "#db2777" },
  note:    { icon: MessageSquareText, hex: "#4b5563" },
};
function FieldLabel({ tone, children, small }) {
  const t = FIELD_TONE[tone];
  const Icon = t.icon;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: small ? 3 : 4 }}>
      <span style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 17, height: 17, borderRadius: 99, flexShrink: 0,
        background: `${t.hex}1f`, color: t.hex,
      }}>
        <Icon size={10} />
      </span>
      <span style={{
        fontSize: small ? 10 : 11, fontWeight: 700, color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: "0.04em",
      }}>
        {children}
      </span>
    </div>
  );
}

// D-029 (20 Agustus 2026) — sales SELAMA INI ngetik ulang manual seluruh info
// order ini ke grup WA sales (format persis di bawah, diambil dari contoh
// pesan nyata). Tombol "Salin pesan WA" generate teks yang SAMA dari data
// order yang sudah ada di CRM, supaya tidak ada lagi field yang kelewat/typo
// saat diketik ulang. Angka SENGAJA tanpa prefix "Rp" — mengikuti format asli
// yang sales pakai di WA.
const BODY_AREA_LABELS = {
  KEPALA_PUSING:  "Kepala",
  SAKIT_LEHER:    "Leher",
  BAHU:           "Bahu",
  SAKIT_PUNGGUNG: "Punggung",
  SAKIT_PINGGANG: "Pinggang",
  SARAF_KEJEPIT:  "Saraf Kejepit",
  SKOLIOSIS:      "Skoliosis",
};
function formatAngka(n) {
  return (n || 0).toLocaleString("id-ID");
}
function buildWaMessage(order, customer) {
  const info   = parseOrderNotes(order.notes);
  const berat  = (order.weightEntries || []).map((w) => w.beratKg).join(", ") || "-";
  const cats   = order.complaintCategory || [];

  const areaSelected = cats.filter((c) => BODY_AREA_LABELS[c]).map((c) => BODY_AREA_LABELS[c]);
  const keluhanLines = [];
  if (areaSelected.length) keluhanLines.push(`- sakit Area ${areaSelected.join(", ")}`);
  if (cats.includes("PEGAL_PEGAL")) keluhanLines.push("- Pegal area seluruh badan");
  if (cats.includes("LAINNYA")) keluhanLines.push("- Lainnya");

  const layanan     = (order.items || []).map((i) => i.layananName).join(", ") || "-";
  const finalBiaya  = order.value || 0;
  // Biaya SEBELUM diskon — dihitung mundur dari final harga, HANYA untuk
  // tampilan pesan WA (bukan disimpan). Kalau promo tidak punya
  // discountPercent (mis. promo bonus item), tidak ada cara menghitung
  // mundur yang benar — tampilkan final biaya apa adanya, jangan menebak.
  const biayaAwal = order.promo?.discountPercent
    ? Math.round(finalBiaya / (1 - order.promo.discountPercent / 100))
    : finalBiaya;

  return [
    `Nama : ${customer.name || "-"}`,
    `Tlp : ${customer.phone || "-"}`,
    `Alamat : ${customer.name || "-"}. \n${order.deliveryAddress || "-"}${order.deliveryCity ? `. ${order.deliveryCity}` : ""}.`,
    `Berat badan pengguna : ${berat}`,
    `Keluhan fisik saat bangun tidur :`,
    keluhanLines.length ? keluhanLines.join("\n") : "-",
    `Keluhan kasur : ${info.keluhanCustomer || "-"}`,
    `Ukuran kasur : ${info.ukuranKasur || "-"}`,
    `Merk kasur : ${info.merkKasur || "-"}`,
    `Layanan yang di pilih : ${layanan}`,
    `Biaya : ${formatAngka(biayaAwal)}`,
    `Diskon : ${order.promo ? order.promo.code : "-"}`,
    `Final Biaya : ${formatAngka(finalBiaya)}`,
    `Ongkir : ${formatAngka(order.ongkir)}`,
    `Ongkir claim garansi : ${formatAngka(order.ongkirKlaimGaransi)}`,
    `Pick Up : ${order.pickupEstimate || "-"}`,
    `Est Pick Up : ${order.pickupConfirmedDate ? formatTanggal(order.pickupConfirmedDate) : "-"}`,
    `Kirim : ${order.deliveryEstimate || "-"}`,
    `Est Kirim : ${order.deliveryConfirmedDate ? formatTanggal(order.deliveryConfirmedDate) : "-"}`,
    `Cs : ${customer.assignedSales?.name || "-"}`,
    `Share loct : ${order.locationUrl || "-"}`,
  ].join("\n");
}

// ─── Detail order yang bisa di-expand ────────────────────────────────────────
function OrderDetail({ order, customer, customerId, onRefresh, onDelete, orderOptions, promos }) {
  const info = parseOrderNotes(order.notes);
  const isLayanan = !order.category || order.category === "LAYANAN";

  // D-025: field non-status (merk/ukuran/item/harga/berat/catatan/pembayaran)
  // terkunci untuk non-admin begitu order LUNAS. Status TIDAK ikut
  // dikunci — itu jalur D-006/override sendiri, tombol "Ubah Status" di
  // bawah tetap aktif seperti biasa untuk semua role.
  const locked = order.paymentStatus === "LUNAS" && !currentUserIsAdmin();

  const [editing, setEditing]             = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus || "BELUM_BAYAR");

  // Status Order (Integrasi Fase 1, D-006): TIDAK LAGI field bebas-tulis di
  // form edit biasa — dihitung otomatis dari status unit. "Override" adalah
  // aksi terpisah & eksplisit (mengunci + tercatat siapa/kapan/kenapa),
  // bukan efek samping menyimpan perubahan merk/catatan/dsb.
  const [overriding, setOverriding]           = useState(false);
  const [overrideStatus, setOverrideStatus]   = useState(order.status);
  const [overrideNote, setOverrideNote]       = useState("");
  const [overrideBusy, setOverrideBusy]       = useState(false);
  const [merkKasur, setMerkKasur]         = useState(info.merkKasur);
  const [ukuran, setUkuran]               = useState(info.ukuranKasur);
  const [keluhan, setKeluhan]             = useState(info.keluhanCustomer);
  const [promoId, setPromoId]             = useState(order.promoId || "");
  // D-027: kota + alamat pengiriman order ini — TERPISAH dari Customer.city
  // (1 customer bisa order untuk alamat berbeda-beda).
  const [deliveryCity, setDeliveryCity]       = useState(order.deliveryCity || "");
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress || "");
  // D-028: Sakit/Tidak Sakit + kategori keluhan per order (multi-pilih —
  // keluhan biasanya lebih dari satu area sekaligus, lihat komentar enum).
  const [healthStatus, setHealthStatus]           = useState(order.healthStatus || "");
  const [complaintCategory, setComplaintCategory] = useState(order.complaintCategory || []);
  // D-029: field tambahan supaya form order menangkap semua yang selama ini
  // diketik ulang manual ke grup WA sales (ongkir, estimasi pickup, lokasi).
  const [ongkir, setOngkir]                       = useState(order.ongkir ?? "");
  const [ongkirKlaimGaransi, setOngkirKlaimGaransi] = useState(order.ongkirKlaimGaransi ?? "");
  const [pickupEstimate, setPickupEstimate]       = useState(order.pickupEstimate || "");
  const [pickupConfirmedDate, setPickupConfirmedDate] = useState(
    order.pickupConfirmedDate ? order.pickupConfirmedDate.slice(0, 10) : ""
  );
  // D-033: pasangan pengiriman dari pickupEstimate/pickupConfirmedDate.
  const [deliveryEstimate, setDeliveryEstimate]       = useState(order.deliveryEstimate || "");
  const [deliveryConfirmedDate, setDeliveryConfirmedDate] = useState(
    order.deliveryConfirmedDate ? order.deliveryConfirmedDate.slice(0, 10) : ""
  );
  const [locationUrl, setLocationUrl]             = useState(order.locationUrl || "");
  const [items, setItems]                 = useState(
    (order.items || []).map((it) => ({ ...it, key: it.id, harga: String(it.harga) }))
  );
  // Berat badan multi-orang
  const [weightEntries, setWeightEntries] = useState(
    (order.weightEntries && order.weightEntries.length > 0)
      ? order.weightEntries.map((e) => ({ ...e, key: e.id, beratKg: String(e.beratKg) }))
      : [newWeightEntry()]
  );
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [copied, setCopied]       = useState(false);
  const [sendingWa, setSendingWa] = useState(false);

  async function handleCopyWaMessage() {
    try {
      await navigator.clipboard.writeText(buildWaMessage(order, customer || {}));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert("Gagal menyalin: " + err.message);
    }
  }

  // D-032: kirim LANGSUNG ke grup WA yang sudah ditandai admin (bukan
  // copy-paste manual lagi) — tombol eksplisit, sales tetap yang memutuskan
  // kapan data sudah lengkap untuk dikirim.
  async function handleSendWaGroup() {
    if (sendingWa) return;
    setSendingWa(true);
    try {
      const res = await api.sendOrderWaSummary(order.id);
      alert(`Terkirim ke grup "${res.group?.groupName || "WA"}".`);
    } catch (err) {
      alert("Gagal kirim ke grup WA: " + err.message);
    } finally {
      setSendingWa(false);
    }
  }

  // State untuk fitur komplain
  const [showComplaintForm, setShowComplaintForm] = useState(false);
  const [complaintDetail, setComplaintDetail]     = useState("");
  const [savingComplaint, setSavingComplaint]     = useState(false);

  const totalItems = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);

  // ── helpers items ──
  function addItem() { setItems((p) => [...p, newItem()]); }
  function removeItem(key) { setItems((p) => p.filter((it) => it.key !== key)); }
  function setItemField(key, field, val) {
    setItems((p) => p.map((it) => it.key === key ? { ...it, [field]: val } : it));
  }

  // ── helpers weight entries ──
  function addWeight()         { setWeightEntries((p) => [...p, newWeightEntry()]); }
  function removeWeight(key)   { setWeightEntries((p) => p.filter((e) => e.key !== key)); }
  function setWeightField(key, field, val) {
    setWeightEntries((p) => p.map((e) => e.key === key ? { ...e, [field]: val } : e));
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Merk otomatis "Sano" untuk BARU/SEWA
      const finalMerk = isLayanan ? merkKasur : "Sano";

      await api.updateOrder(order.id, {
        paymentStatus,
        notes: buildOrderNotes({ merkKasur: finalMerk, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
        promoId: promoId || null,
        deliveryCity: deliveryCity || null,
        deliveryAddress: deliveryAddress || null,
        healthStatus: healthStatus || null,
        complaintCategory: healthStatus === "SAKIT" ? complaintCategory : [],
        ongkir: ongkir === "" ? null : ongkir,
        ongkirKlaimGaransi: ongkirKlaimGaransi === "" ? null : ongkirKlaimGaransi,
        pickupEstimate: pickupEstimate || null,
        pickupConfirmedDate: pickupConfirmedDate || null,
        deliveryEstimate: deliveryEstimate || null,
        deliveryConfirmedDate: deliveryConfirmedDate || null,
        locationUrl: locationUrl || null,
      });

      // Proses weight entries
      const existingIds = (order.weightEntries || []).map((e) => e.id);
      const currentIds  = weightEntries.filter((e) => e.id).map((e) => e.id);
      // Hapus yang dihilangkan
      for (const id of existingIds) {
        if (!currentIds.includes(id)) await api.deleteWeightEntry(id);
      }
      // Update yang sudah ada
      for (const e of weightEntries.filter((e) => e.id)) {
        if (e.label?.trim() && e.beratKg)
          await api.updateWeightEntry(e.id, { label: e.label.trim(), beratKg: Number(e.beratKg) });
      }
      // Tambah yang baru
      for (let i = 0; i < weightEntries.length; i++) {
        const e = weightEntries[i];
        if (!e.id && e.label?.trim() && e.beratKg)
          await api.addWeightEntry(order.id, { label: e.label.trim(), beratKg: Number(e.beratKg), sortOrder: i });
      }

      // Proses items (hanya LAYANAN)
      if (isLayanan) {
        const existingItemIds = (order.items || []).map((it) => it.id);
        const currentItemIds  = items.filter((it) => it.id).map((it) => it.id);
        for (const id of existingItemIds) {
          if (!currentItemIds.includes(id)) await api.deleteOrderItem(id);
        }
        for (const it of items.filter((it) => it.id)) {
          if (it.layananName?.trim())
            await api.updateOrderItem(it.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
        }
        for (const it of items.filter((it) => !it.id)) {
          if (it.layananName?.trim())
            await api.addOrderItem(order.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
        }
      }

      setEditing(false);
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function applyOverride() {
    setOverrideBusy(true);
    try {
      await api.updateOrder(order.id, { status: overrideStatus, statusOverrideNote: overrideNote.trim() || undefined });
      setOverriding(false);
      onRefresh();
    } catch (err) { alert(err.message); } finally { setOverrideBusy(false); }
  }

  async function releaseOverride() {
    setOverrideBusy(true);
    try {
      await api.updateOrder(order.id, { releaseStatusOverride: true });
      onRefresh();
    } catch (err) { alert(err.message); } finally { setOverrideBusy(false); }
  }

  function handleCancel() {
    const inf = parseOrderNotes(order.notes);
    setPaymentStatus(order.paymentStatus || "BELUM_BAYAR");
    setMerkKasur(inf.merkKasur);
    setUkuran(inf.ukuranKasur);
    setKeluhan(inf.keluhanCustomer);
    setDeliveryCity(order.deliveryCity || "");
    setDeliveryAddress(order.deliveryAddress || "");
    setHealthStatus(order.healthStatus || "");
    setComplaintCategory(order.complaintCategory || []);
    setOngkir(order.ongkir ?? "");
    setOngkirKlaimGaransi(order.ongkirKlaimGaransi ?? "");
    setPickupEstimate(order.pickupEstimate || "");
    setPickupConfirmedDate(order.pickupConfirmedDate ? order.pickupConfirmedDate.slice(0, 10) : "");
    setDeliveryEstimate(order.deliveryEstimate || "");
    setDeliveryConfirmedDate(order.deliveryConfirmedDate ? order.deliveryConfirmedDate.slice(0, 10) : "");
    setLocationUrl(order.locationUrl || "");
    setItems((order.items || []).map((it) => ({ ...it, key: it.id, harga: String(it.harga) })));
    setWeightEntries(
      (order.weightEntries && order.weightEntries.length > 0)
        ? order.weightEntries.map((e) => ({ ...e, key: e.id, beratKg: String(e.beratKg) }))
        : [newWeightEntry()]
    );
    setEditing(false);
  }

  // Order yang sudah punya unit/job/pembayaran TIDAK BISA dihapus permanen
  // (RESTRICT di backend, lihat routes/orders.js) — riwayat produksi/uang
  // tidak boleh hilang diam-diam. Kalau delete ditolak (409) karena itu,
  // tawarkan "Batalkan" sebagai alternatif: order & unit-nya (kalau belum
  // disentuh bengkel) ditandai CANCELLED, bukan dihapus — aman untuk kasus
  // salah input, tapi backend TETAP menolak kalau unitnya sudah mulai
  // dikerjakan/sudah ada pembayaran (itu bukan lagi salah input murni).
  async function handleDelete() {
    if (!confirm("Hapus order ini secara permanen? Semua item & data terkait juga akan dihapus.")) return;
    setDeleting(true);
    try {
      await api.deleteOrder(order.id);
      onDelete(order.id);
    } catch (err) {
      if (err.status === 409) {
        const lanjut = confirm(
          `${err.message}\n\nMau ditandai "Dibatalkan" saja (bukan dihapus permanen — nilainya tidak dihitung lagi tapi riwayatnya tetap tersimpan)?`
        );
        if (lanjut) {
          const alasan = prompt("Alasan pembatalan (opsional):", "Salah input") || "";
          try {
            await api.cancelOrder(order.id, alasan);
            onRefresh();
          } catch (err2) {
            alert(err2.message);
          }
        }
      } else {
        alert(err.message);
      }
      setDeleting(false);
    }
  }

  async function handleSaveComplaint() {
    if (!complaintDetail.trim()) return alert("Isi detail komplain terlebih dahulu");
    setSavingComplaint(true);
    try {
      await api.markOrderComplaint(order.id, { complaintDetail: complaintDetail.trim() });
      setShowComplaintForm(false);
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingComplaint(false);
    }
  }

  // Tampilan berat badan di view mode
  const weightDisplay = (order.weightEntries && order.weightEntries.length > 0)
    ? order.weightEntries.map((e) => `${e.label}: ${e.beratKg} kg`).join(" · ")
    : null;

  return (
    <div style={{ padding: "12px 14px", background: "#fafafa", borderTop: "1px solid var(--border)" }}>
      {/* Tombol aksi */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginBottom: 10 }}>
        {!editing ? (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleCopyWaMessage}
              title="Salin ringkasan order ini dalam format pesan WA — tempel langsung ke grup WA sales"
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              {copied ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
              {copied ? "Tersalin" : "Salin pesan WA"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleSendWaGroup}
              disabled={sendingWa}
              title="Kirim ringkasan order ini langsung ke grup WA order (harus diatur admin dulu)"
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              <Send size={12} />
              {sendingWa ? "Mengirim..." : "Kirim ke Grup WA"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(true)}
              disabled={locked}
              title={locked ? "Order sudah LUNAS — cuma admin yang bisa mengedit" : undefined}
            >
              {locked && <Lock size={11} style={{ marginRight: 4 }} />}Edit
            </button>
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: "#fee2e2", color: "#991b1b", border: "none", cursor: "pointer", borderRadius: 6, padding: "4px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
            >
              <Trash2 size={12} /> {deleting ? "..." : "Hapus"}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "..." : "Simpan"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>Batal</button>
          </>
        )}
      </div>

      {/* D-025: penjelasan kunci — kenapa tombol Edit nonaktif, dan apa yang
          harus dilakukan sales kalau pelanggan minta revisi. */}
      {locked && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "#f3f4f6", borderRadius: 8, border: "1px solid #d1d5db" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Lock size={12} color="#4b5563" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Order terkunci</span>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "#4b5563", lineHeight: 1.5 }}>
            Sudah LUNAS — cuma admin yang bisa mengedit lagi.{" "}
            {order.status === "DELIVERED"
              ? 'Kalau pelanggan minta revisi, tandai lewat tombol "Ajukan Revisi" di bawah supaya admin tahu dan bisa menindaklanjuti.'
              : "Kalau ada koreksi yang perlu dilakukan, hubungi admin langsung."}
          </p>
        </div>
      )}

      {/* Badge komplain (jika sudah ada) */}
      {order.hasComplaint && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fee2e2", borderRadius: 8, border: "1px solid #fca5a5" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <AlertTriangle size={13} color="#dc2626" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#991b1b" }}>Ada Komplain</span>
            <span style={{ fontSize: 11, color: "#b91c1c", marginLeft: "auto" }}>{formatTanggal(order.complaintDate)}</span>
          </div>
          {order.complaintDetail && (
            <p style={{ margin: 0, fontSize: 12, color: "#7f1d1d" }}>{order.complaintDetail}</p>
          )}
        </div>
      )}

      {/* Status Pengerjaan + Status Pembayaran.
          Status Pengerjaan DIHITUNG OTOMATIS dari status unit di Bengkel
          (Integrasi Fase 1, D-006) — ikut unit yang PALING TERTINGGAL, jadi
          tidak pernah bilang "selesai" padahal ada kasur yang belum sampai.
          "Override" adalah aksi terpisah & eksplisit, bukan dropdown bebas
          seperti sebelumnya — supaya orang tidak diam-diam mengunci status
          cuma karena tidak sadar itu mengunci hitungan otomatis. */}
      <div style={{ marginBottom: 8 }}>
        <span style={metaLabel}>Status</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 6, ...ORDER_STATUS_BADGE[order.status] }}>
            {ORDER_STATUS_LABELS[order.status] || order.status}
          </span>
          {editing ? (
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} style={selStyle}>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s] || s}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 6, ...PAYMENT_STATUS_BADGE[order.paymentStatus || "BELUM_BAYAR"] }}>
              {PAYMENT_STATUS_LABELS[order.paymentStatus || "BELUM_BAYAR"]}
            </span>
          )}
          {order.statusLocked ? (
            <>
              <span style={{ fontSize: 10.5, color: "#92400e", background: "#fef3c7", padding: "2px 7px", borderRadius: 6 }}>
                🔒 Diubah manual{order.statusOverrideBy?.name ? ` oleh ${order.statusOverrideBy.name}` : ""}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={overrideBusy} onClick={releaseOverride}>
                Kembalikan ke Otomatis
              </button>
            </>
          ) : (
            // Label SEBELUMNYA "Override Status" — istilah teknis yang bikin
            // tombol ini terlihat seperti fitur khusus admin, padahal ini
            // SATU-SATUNYA cara mengubah status order (D-006: status normal
            // dihitung otomatis dari unit Bengkel, bukan dropdown bebas).
            // Sales di Inbox mengira status "tidak bisa diedit" karena tidak
            // mengenali kata "Override" sebagai tombol ubah status.
            <button className="btn btn-ghost btn-sm" onClick={() => { setOverrideStatus(order.status); setOverrideNote(""); setOverriding((v) => !v); }}>
              Ubah Status
            </button>
          )}
        </div>

        {order.statusLocked && order.statusOverrideNote && (
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--text-muted)" }}>"{order.statusOverrideNote}"</p>
        )}

        {overriding && (
          <div style={{ marginTop: 6, padding: 8, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--text-muted)" }}>
              Status normal dihitung otomatis dari unit di Bengkel. Mengubahnya di sini akan
              MENGUNCI status ke pilihan ini sampai dilepas lagi ("Kembalikan ke Otomatis") —
              dipakai untuk kasus di luar pola normal (order dibatalkan, dsb).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
              <select value={overrideStatus} onChange={(e) => setOverrideStatus(e.target.value)} style={selStyleFull}>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
                ))}
              </select>
              <input
                value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="Alasan override (opsional)"
                style={{ fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)" }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={overrideBusy} onClick={applyOverride}>
                  {overrideBusy ? "..." : "Terapkan"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setOverriding(false)}>Batal</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ID Order — selalu read-only (auto-generated) */}
      <div style={{ marginBottom: 8 }}>
        <span style={metaLabel}>ID Order</span>
        <span style={{
          display: "inline-block", fontFamily: "monospace", fontSize: 12, fontWeight: 700,
          padding: "2px 8px", borderRadius: 6,
          ...(CATEGORY_BADGE[order.category] || CATEGORY_BADGE.LAYANAN),
        }}>
          {order.orderNumber || "—"}
        </span>
        {order.category && order.category !== "LAYANAN" && (
          <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
            · {CATEGORY_LABELS[order.category]}
          </span>
        )}
      </div>

      {/* Berat Badan — multi-orang */}
      <div style={{ marginBottom: 8 }}>
        <FieldLabel tone="weight" small>Berat Badan</FieldLabel>
        {editing ? (
          <div>
            {weightEntries.map((e) => (
              <div key={e.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
                <input
                  value={e.label}
                  onChange={(ev) => setWeightField(e.key, "label", ev.target.value)}
                  placeholder="cth: Suami / Istri / Sendiri"
                  style={{ flex: 2, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)" }}
                />
                <input
                  type="number" value={e.beratKg}
                  onChange={(ev) => setWeightField(e.key, "beratKg", ev.target.value)}
                  placeholder="kg" min="1" max="300"
                  style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)", minWidth: 70 }}
                />
                {weightEntries.length > 1 && (
                  <button onClick={() => removeWeight(e.key)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 18, padding: "0 2px" }}>×</button>
                )}
              </div>
            ))}
            <button onClick={addWeight}
              style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
              + Tambah Orang
            </button>
          </div>
        ) : weightDisplay ? (
          <span style={{ fontSize: 13 }}>{weightDisplay}</span>
        ) : (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>—</span>
        )}
      </div>

      {/* Merk + Ukuran */}
      {editing ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
          <div>
            <FieldLabel tone="bed" small>Merk Kasur</FieldLabel>
            {isLayanan ? (
              <select value={merkKasur} onChange={(e) => setMerkKasur(e.target.value)} style={selStyleFull}>
                <option value="">—</option>
                {orderOptions.merkKasur.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 700, padding: "5px 0", color: "#166534" }}>Sano ✓</div>
            )}
          </div>
          <div>
            <FieldLabel tone="size" small>Ukuran</FieldLabel>
            <select value={ukuran} onChange={(e) => setUkuran(e.target.value)} style={selStyleFull}>
              <option value="">—</option>
              {orderOptions.ukuranKasur.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      ) : (info.merkKasur || info.ukuranKasur || !isLayanan) ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={chipStyle}>{isLayanan ? (info.merkKasur || "—") : "Sano"}</span>
          {(info.ukuranKasur || ukuran) && <span style={chipStyle}>{info.ukuranKasur || ukuran}</span>}
        </div>
      ) : null}

      {/* Kota + Alamat pengiriman (D-027) — TERPISAH dari Customer.city, 1
          customer bisa order untuk alamat berbeda-beda. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 6, marginBottom: 8 }}>
        <div>
          <FieldLabel tone="address" small>Kota</FieldLabel>
          {editing ? (
            <select value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} style={selStyleFull} disabled={locked}>
              <option value="">— Pilih Kota —</option>
              {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 13 }}>{order.deliveryCity || <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
        <div>
          <FieldLabel tone="address" small>Alamat</FieldLabel>
          {editing ? (
            <textarea
              value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Alamat lengkap pengiriman..." rows={1} disabled={locked}
              style={{ ...selStyleFull, resize: "vertical" }}
            />
          ) : (
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{order.deliveryAddress || <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
      </div>

      {/* Kondisi Kesehatan + kategori keluhan (D-028) — per order, dipakai
          mengklasifikasi jenis keluhan sakit customer klinik matras. */}
      <div style={{ marginBottom: 8 }}>
        <FieldLabel tone="health" small>Kondisi Kesehatan</FieldLabel>
        {editing ? (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: healthStatus === "SAKIT" ? 6 : 0 }}>
              {[
                { value: "SAKIT", label: "Sakit", hex: "#dc2626" },
                { value: "TIDAK_SAKIT", label: "Tidak Sakit", hex: "#16a34a" },
              ].map(({ value, label, hex }) => {
                const active = healthStatus === value;
                return (
                  <button
                    key={value} type="button" disabled={locked}
                    onClick={() => setHealthStatus(active ? "" : value)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                      cursor: locked ? "not-allowed" : "pointer", transition: "all 0.15s",
                      border: `1.5px solid ${active ? hex : "var(--border)"}`,
                      background: active ? `${hex}1a` : "transparent",
                      color: active ? hex : "var(--text-secondary)",
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
            {healthStatus === "SAKIT" && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {HEALTH_COMPLAINT_OPTIONS.map((k) => {
                  const active = complaintCategory.includes(k);
                  return (
                    <button
                      key={k} type="button" disabled={locked}
                      onClick={() => setComplaintCategory((prev) =>
                        prev.includes(k) ? prev.filter((v) => v !== k) : [...prev, k]
                      )}
                      style={{
                        fontSize: 11.5, fontWeight: 600, padding: "3px 10px", borderRadius: 99,
                        cursor: locked ? "not-allowed" : "pointer", transition: "all 0.15s",
                        border: `1.5px solid ${active ? "#dc2626" : "var(--border)"}`,
                        background: active ? "#dc26261a" : "transparent",
                        color: active ? "#dc2626" : "var(--text-secondary)",
                      }}>
                      {HEALTH_COMPLAINT_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : order.healthStatus ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 99,
              ...(order.healthStatus === "SAKIT"
                ? { background: "#dc26261a", color: "#dc2626" }
                : { background: "#16a34a1a", color: "#16a34a" }),
            }}>
              {order.healthStatus === "SAKIT" ? "Sakit" : "Tidak Sakit"}
            </span>
            {(order.complaintCategory || []).map((k) => (
              <span key={k} style={chipStyle}>{HEALTH_COMPLAINT_LABELS[k] || k}</span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>—</span>
        )}
      </div>

      {/* D-029: Ongkir + estimasi pickup + link lokasi — supaya semua data
          yang sebelumnya diketik ulang manual ke grup WA sales sekarang
          tercatat di order-nya langsung (lihat tombol "Salin pesan WA"
          di bawah). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        <div>
          <FieldLabel tone="money" small>Ongkir</FieldLabel>
          {editing ? (
            <input type="number" value={ongkir} onChange={(e) => setOngkir(e.target.value)}
              placeholder="0" disabled={locked} style={selStyleFull} />
          ) : (
            <div style={{ fontSize: 13 }}>{order.ongkir != null ? formatRupiah(order.ongkir) : <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
        <div>
          <FieldLabel tone="money" small>Ongkir Klaim Garansi</FieldLabel>
          {editing ? (
            <input type="number" value={ongkirKlaimGaransi} onChange={(e) => setOngkirKlaimGaransi(e.target.value)}
              placeholder="0" disabled={locked} style={selStyleFull} />
          ) : (
            <div style={{ fontSize: 13 }}>{order.ongkirKlaimGaransi != null ? formatRupiah(order.ongkirKlaimGaransi) : <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        <div>
          <FieldLabel tone="pickup" small>Estimasi Pick Up</FieldLabel>
          {editing ? (
            <input value={pickupEstimate} onChange={(e) => setPickupEstimate(e.target.value)}
              placeholder="cth: est 24/25 Agustus 2026" disabled={locked} style={selStyleFull} />
          ) : (
            <div style={{ fontSize: 13 }}>{order.pickupEstimate || <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
        <div>
          <FieldLabel tone="pickup" small>Tanggal Pick Up Pasti</FieldLabel>
          {editing ? (
            <input type="date" value={pickupConfirmedDate} onChange={(e) => setPickupConfirmedDate(e.target.value)}
              disabled={locked} style={selStyleFull} />
          ) : (
            <div style={{ fontSize: 13 }}>{order.pickupConfirmedDate ? formatTanggal(order.pickupConfirmedDate) : <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
      </div>

      {/* D-033: pasangan pengiriman dari Estimasi/Tanggal Pick Up di atas —
          diisi sales begitu produksi hampir/sudah selesai. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
        <div>
          <FieldLabel tone="delivery" small>Estimasi Kirim</FieldLabel>
          {editing ? (
            <input value={deliveryEstimate} onChange={(e) => setDeliveryEstimate(e.target.value)}
              placeholder="cth: estimasi 25/26 Agustus 2026" disabled={locked} style={selStyleFull} />
          ) : (
            <div style={{ fontSize: 13 }}>{order.deliveryEstimate || <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
        <div>
          <FieldLabel tone="delivery" small>Tanggal Kirim Pasti</FieldLabel>
          {editing ? (
            <input type="date" value={deliveryConfirmedDate} onChange={(e) => setDeliveryConfirmedDate(e.target.value)}
              disabled={locked} style={selStyleFull} />
          ) : (
            <div style={{ fontSize: 13 }}>{order.deliveryConfirmedDate ? formatTanggal(order.deliveryConfirmedDate) : <span style={{ color: "var(--text-muted)" }}>—</span>}</div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <FieldLabel tone="link" small>Link Lokasi</FieldLabel>
        {editing ? (
          <input value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/..." disabled={locked} style={selStyleFull} />
        ) : order.locationUrl ? (
          <div style={{ fontSize: 13 }}>
            <a href={order.locationUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>Buka lokasi ↗</a>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>—</div>
        )}
      </div>

      {/* Promo (D-026) — cuma PENANDA untuk laporan, tidak menghitung ulang
          harga apa pun (harga tetap manual di item layanan di bawah). */}
      <div style={{ marginBottom: 8 }}>
        <FieldLabel tone="promo" small>Promo</FieldLabel>
        {editing ? (
          <select value={promoId} onChange={(e) => setPromoId(e.target.value)} style={selStyleFull} disabled={locked}>
            <option value="">Tanpa promo</option>
            {order.promo && !promos.some((p) => p.id === order.promo.id) && (
              // Promo yang dipakai order ini sudah tidak aktif lagi — tetap
              // tampilkan sebagai pilihan supaya tidak diam-diam tergeser
              // begitu dropdown dibuka, tapi tandai jelas.
              <option value={order.promo.id}>{promoLabel(order.promo)} (sudah berakhir)</option>
            )}
            {promos.map((p) => <option key={p.id} value={p.id}>{promoLabel(p)}</option>)}
          </select>
        ) : order.promo ? (
          <div><span style={chipStyle}>{promoLabel(order.promo)}</span></div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>—</div>
        )}
      </div>

      {/* Items layanan — hanya untuk LAYANAN */}
      {isLayanan && (
        editing ? (
          <div style={{ marginBottom: 8 }}>
            <span style={metaLabel}>Layanan (add-ons)</span>
            {items.map((it) => (
              <div key={it.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
                <input
                  list="layanan-suggestions"
                  value={it.layananName}
                  onChange={(e) => setItemField(it.key, "layananName", e.target.value)}
                  placeholder="Nama layanan..."
                  style={{ flex: 2, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)" }}
                />
                <input
                  type="number" value={it.harga}
                  onChange={(e) => setItemField(it.key, "harga", e.target.value)}
                  placeholder="Harga" min="0"
                  style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)", minWidth: 80 }}
                />
                {items.length > 1 && (
                  <button onClick={() => removeItem(it.key)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 18, padding: "0 2px" }}>×</button>
                )}
              </div>
            ))}
            <datalist id="layanan-suggestions">
              {orderOptions.jenisLayanan.map((j) => <option key={j} value={j} />)}
            </datalist>
            <button onClick={addItem}
              style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
              + Tambah layanan lain
            </button>
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>Total: {formatRupiah(totalItems)}</div>
          </div>
        ) : (order.items && order.items.length > 0) ? (
          <div style={{ marginBottom: 8 }}>
            <span style={metaLabel}>Layanan</span>
            {order.items.map((it) => (
              <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "var(--text-secondary)" }}>
                <span>{it.layananName}</span>
                <span style={{ fontWeight: 600 }}>{formatRupiah(it.harga)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
              <span>Total</span>
              <span>{formatRupiah(order.value)}</span>
            </div>
          </div>
        ) : null
      )}

      {/* Nilai total untuk BARU/SEWA (non-LAYANAN) */}
      {!isLayanan && order.value > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span style={metaLabel}>Nilai</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>{formatRupiah(order.value)}</span>
        </div>
      )}

      {/* Keluhan/Catatan */}
      {editing ? (
        <div style={{ marginBottom: 8 }}>
          <FieldLabel tone="note" small>{isLayanan ? "Keluhan Customer" : "Catatan"}</FieldLabel>
          <textarea value={keluhan} onChange={(e) => setKeluhan(e.target.value)}
            placeholder={isLayanan ? "Keluhan kasur customer..." : "Catatan order..."}
            rows={2} style={{ ...selStyleFull, resize: "vertical" }} />
        </div>
      ) : info.keluhanCustomer ? (
        <div style={{ marginBottom: 8 }}>
          <span style={metaLabel}>{isLayanan ? "Keluhan" : "Catatan"}</span>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{info.keluhanCustomer}</p>
        </div>
      ) : null}

      {/* Tombol tandai komplain/ajukan revisi (hanya untuk order DELIVERED
          yang belum punya komplain). D-025: ini jalur RESMI sales melaporkan
          permintaan revisi customer ke admin — TIDAK dikunci walau order
          sudah DELIVERED (justru syaratnya harus DELIVERED). */}
      {!editing && order.status === "DELIVERED" && !order.hasComplaint && (
        <div style={{ marginTop: 8 }}>
          {!showComplaintForm ? (
            <button
              onClick={() => setShowComplaintForm(true)}
              style={{ fontSize: 12, color: "#dc2626", background: "none", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer", padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}
            >
              <AlertTriangle size={12} /> + Ajukan Revisi / Komplain
            </button>
          ) : (
            <div style={{ padding: 10, background: "#fff7f7", border: "1px solid #fca5a5", borderRadius: 8 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "#991b1b" }}>Detail Revisi / Komplain</p>
              <textarea
                value={complaintDetail}
                onChange={(e) => setComplaintDetail(e.target.value)}
                placeholder="Jelaskan masalah/revisi yang diminta customer — admin akan meninjau dan menindaklanjuti..."
                rows={3}
                style={{ width: "100%", fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid #fca5a5", resize: "vertical", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  onClick={handleSaveComplaint}
                  disabled={savingComplaint}
                  style={{ flex: 1, fontSize: 12, padding: "5px 0", background: "#dc2626", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
                >
                  {savingComplaint ? "Menyimpan..." : "Kirim ke Admin"}
                </button>
                <button
                  onClick={() => { setShowComplaintForm(false); setComplaintDetail(""); }}
                  style={{ fontSize: 12, padding: "5px 10px", background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Form tambah order baru (step 0: kategori → step 1: info → step 2: layanan) ─
function AddOrderForm({ customerId, onDone, onCancel, orderOptions, promos }) {
  const [step, setStep]               = useState(0);
  const [category, setCategory]       = useState("");
  const [merkKasur, setMerk]          = useState("");
  const [ukuran, setUkuran]           = useState("");
  const [keluhan, setKeluhan]         = useState("");
  const [promoId, setPromoId]         = useState("");
  // D-027: kota + alamat pengiriman order ini.
  const [deliveryCity, setDeliveryCity]       = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  // D-028: Sakit/Tidak Sakit + kategori keluhan per order (multi-pilih).
  const [healthStatus, setHealthStatus]           = useState("");
  const [complaintCategory, setComplaintCategory] = useState([]);
  // D-029: ongkir/estimasi pickup/link lokasi.
  const [ongkir, setOngkir]                       = useState("");
  const [ongkirKlaimGaransi, setOngkirKlaimGaransi] = useState("");
  const [pickupEstimate, setPickupEstimate]       = useState("");
  const [pickupConfirmedDate, setPickupConfirmedDate] = useState("");
  const [deliveryEstimate, setDeliveryEstimate]       = useState("");
  const [deliveryConfirmedDate, setDeliveryConfirmedDate] = useState("");
  const [locationUrl, setLocationUrl]             = useState("");
  const [hargaTotal, setHargaTotal]   = useState("");
  const [items, setItems]             = useState([newItem()]);
  const [weightEntries, setWeightEntries] = useState([newWeightEntry()]);
  const [saving, setSaving]           = useState(false);

  const isLayanan = category === "LAYANAN";
  const total     = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);

  // ── helpers items ──
  function addItem() { setItems((p) => [...p, newItem()]); }
  function removeItem(key) { setItems((p) => p.filter((it) => it.key !== key)); }
  function setItemField(key, field, val) {
    setItems((p) => p.map((it) => it.key === key ? { ...it, [field]: val } : it));
  }

  // ── helpers weight entries ──
  function addWeight()         { setWeightEntries((p) => [...p, newWeightEntry()]); }
  function removeWeight(key)   { setWeightEntries((p) => p.filter((e) => e.key !== key)); }
  function setWeightField(key, field, val) {
    setWeightEntries((p) => p.map((e) => e.key === key ? { ...e, [field]: val } : e));
  }

  // Helper: simpan weight entries yang valid setelah order dibuat
  async function saveWeightEntries(orderId) {
    const valid = weightEntries.filter((e) => e.label?.trim() && e.beratKg);
    for (let i = 0; i < valid.length; i++) {
      await api.addWeightEntry(orderId, {
        label:    valid[i].label.trim(),
        beratKg:  Number(valid[i].beratKg),
        sortOrder: i,
      });
    }
  }

  // Submit untuk BARU/SEWA
  async function handleSubmitSimple(e) {
    e.preventDefault();
    const harga = Number(hargaTotal) || 0;
    setSaving(true);
    try {
      const order = await api.addOrder(customerId, {
        category,
        notes: buildOrderNotes({ merkKasur: "Sano", ukuranKasur: ukuran, keluhanCustomer: keluhan }),
        promoId: promoId || undefined,
        deliveryCity: deliveryCity || undefined,
        deliveryAddress: deliveryAddress || undefined,
        healthStatus: healthStatus || undefined,
        complaintCategory: healthStatus === "SAKIT" ? complaintCategory : undefined,
        ongkir: ongkir || undefined,
        ongkirKlaimGaransi: ongkirKlaimGaransi || undefined,
        pickupEstimate: pickupEstimate || undefined,
        pickupConfirmedDate: pickupConfirmedDate || undefined,
        deliveryEstimate: deliveryEstimate || undefined,
        deliveryConfirmedDate: deliveryConfirmedDate || undefined,
        locationUrl: locationUrl || undefined,
      });
      if (harga > 0) {
        const namaLayanan = category === "BARU" ? "Kasur Baru" : "Kasur Sewa";
        await api.addOrderItem(order.id, { layananName: namaLayanan, harga });
      }
      await saveWeightEntries(order.id);
      onDone();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Submit untuk LAYANAN (add-ons)
  async function handleSubmitLayanan(e) {
    e.preventDefault();
    const validItems = items.filter((it) => it.layananName?.trim());
    if (validItems.length === 0) return alert("Tambahkan minimal satu layanan");
    setSaving(true);
    try {
      const order = await api.addOrder(customerId, {
        category: "LAYANAN",
        notes: buildOrderNotes({ merkKasur, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
        promoId: promoId || undefined,
        deliveryCity: deliveryCity || undefined,
        deliveryAddress: deliveryAddress || undefined,
        healthStatus: healthStatus || undefined,
        complaintCategory: healthStatus === "SAKIT" ? complaintCategory : undefined,
        ongkir: ongkir || undefined,
        ongkirKlaimGaransi: ongkirKlaimGaransi || undefined,
        pickupEstimate: pickupEstimate || undefined,
        pickupConfirmedDate: pickupConfirmedDate || undefined,
        deliveryEstimate: deliveryEstimate || undefined,
        deliveryConfirmedDate: deliveryConfirmedDate || undefined,
        locationUrl: locationUrl || undefined,
      });
      for (const it of validItems) {
        await api.addOrderItem(order.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
      }
      await saveWeightEntries(order.id);
      onDone();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Step 0: Pilih kategori ──
  if (step === 0) {
    return (
      <div style={formBox}>
        <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 13 }}>Order Baru — Pilih Jenis</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCategory(opt.value)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                border: category === opt.value ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: category === opt.value ? "#eff6ff" : "var(--bg-card)",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 22 }}>{opt.icon}</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{opt.sub}</div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary" style={{ flex: 1 }}
            disabled={!category}
            onClick={() => setStep(1)}
          >
            Lanjut →
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
        </div>
      </div>
    );
  }

  // ── Step 1: Info kasur (sama untuk semua kategori) ──
  if (step === 1) {
    const opt = CATEGORY_OPTIONS.find((o) => o.value === category);
    return (
      <div style={formBox}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
          {opt?.icon} {opt?.label} — Info Kasur
        </p>
        <button type="button" onClick={() => setStep(0)}
          style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 0 10px" }}>
          ← Ganti jenis
        </button>

        {/* Berat Badan — multi-orang */}
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="weight">Berat Badan</FieldLabel>
          {weightEntries.map((e) => (
            <div key={e.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
              <input
                value={e.label}
                onChange={(ev) => setWeightField(e.key, "label", ev.target.value)}
                placeholder="cth: Suami / Istri / Sendiri"
                style={{ flex: 2, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <input
                type="number" value={e.beratKg}
                onChange={(ev) => setWeightField(e.key, "beratKg", ev.target.value)}
                placeholder="kg" min="1" max="300"
                style={{ flex: 1, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 70 }}
              />
              {weightEntries.length > 1 && (
                <button type="button" onClick={() => removeWeight(e.key)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addWeight}
            style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
            + Tambah Orang
          </button>
        </div>

        {/* Merk Kasur */}
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="bed">Merk Kasur</FieldLabel>
          {isLayanan ? (
            <select value={merkKasur} onChange={(e) => setMerk(e.target.value)} style={formSelect}>
              <option value="">— Pilih Merk —</option>
              {orderOptions.merkKasur.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, padding: "7px 0", color: "#166534" }}>Sano ✓</div>
          )}
        </div>

        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="size">Ukuran Kasur</FieldLabel>
          <select value={ukuran} onChange={(e) => setUkuran(e.target.value)} style={formSelect}>
            <option value="">— Pilih Ukuran —</option>
            {orderOptions.ukuranKasur.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {/* Kota + Alamat pengiriman (D-027) — TERPISAH dari Customer.city,
            1 customer bisa order untuk alamat berbeda-beda. */}
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="address">Kota</FieldLabel>
          <select value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} style={formSelect}>
            <option value="">— Pilih Kota —</option>
            {KOTA_LIST.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <FieldLabel tone="address">Alamat</FieldLabel>
          <textarea value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
            placeholder="Alamat lengkap pengiriman..."
            rows={2} style={{ ...formSelect, resize: "vertical" }} />
        </div>

        {/* Kondisi Kesehatan + kategori keluhan (D-028) — per order, dipakai
            mengklasifikasi jenis keluhan sakit customer klinik matras. */}
        <div style={{ marginBottom: 14 }}>
          <FieldLabel tone="health">Kondisi Kesehatan</FieldLabel>
          <div style={{ display: "flex", gap: 6, marginBottom: healthStatus === "SAKIT" ? 6 : 0 }}>
            {[
              { value: "SAKIT", label: "Sakit", hex: "#dc2626" },
              { value: "TIDAK_SAKIT", label: "Tidak Sakit", hex: "#16a34a" },
            ].map(({ value, label, hex }) => {
              const active = healthStatus === value;
              return (
                <button
                  key={value} type="button"
                  onClick={() => setHealthStatus(active ? "" : value)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 99,
                    cursor: "pointer", transition: "all 0.15s",
                    border: `1.5px solid ${active ? hex : "var(--border)"}`,
                    background: active ? `${hex}1a` : "transparent",
                    color: active ? hex : "var(--text-secondary)",
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
          {healthStatus === "SAKIT" && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {HEALTH_COMPLAINT_OPTIONS.map((k) => {
                const active = complaintCategory.includes(k);
                return (
                  <button
                    key={k} type="button"
                    onClick={() => setComplaintCategory((prev) =>
                      prev.includes(k) ? prev.filter((v) => v !== k) : [...prev, k]
                    )}
                    style={{
                      fontSize: 11.5, fontWeight: 600, padding: "5px 12px", borderRadius: 99,
                      cursor: "pointer", transition: "all 0.15s",
                      border: `1.5px solid ${active ? "#dc2626" : "var(--border)"}`,
                      background: active ? "#dc26261a" : "transparent",
                      color: active ? "#dc2626" : "var(--text-secondary)",
                    }}>
                    {HEALTH_COMPLAINT_LABELS[k]}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <FieldLabel tone="note">{isLayanan ? "Keluhan Customer" : "Catatan"}</FieldLabel>
          <textarea value={keluhan} onChange={(e) => setKeluhan(e.target.value)}
            placeholder={isLayanan ? "Jelaskan keluhan kasur..." : "Catatan order..."}
            rows={3} style={{ ...formSelect, resize: "vertical" }} />
        </div>

        {/* D-029: Ongkir + estimasi pickup + link lokasi. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <FieldLabel tone="money">Ongkir</FieldLabel>
            <input type="number" value={ongkir} onChange={(e) => setOngkir(e.target.value)}
              placeholder="0" style={formSelect} />
          </div>
          <div>
            <FieldLabel tone="money">Ongkir Klaim Garansi</FieldLabel>
            <input type="number" value={ongkirKlaimGaransi} onChange={(e) => setOngkirKlaimGaransi(e.target.value)}
              placeholder="0" style={formSelect} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <FieldLabel tone="pickup">Estimasi Pick Up</FieldLabel>
            <input value={pickupEstimate} onChange={(e) => setPickupEstimate(e.target.value)}
              placeholder="cth: est 24/25 Agustus 2026" style={formSelect} />
          </div>
          <div>
            <FieldLabel tone="pickup">Tanggal Pick Up Pasti</FieldLabel>
            <input type="date" value={pickupConfirmedDate} onChange={(e) => setPickupConfirmedDate(e.target.value)}
              style={formSelect} />
          </div>
        </div>
        {/* D-033: pasangan pengiriman — diisi begitu produksi hampir/sudah selesai. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <FieldLabel tone="delivery">Estimasi Kirim</FieldLabel>
            <input value={deliveryEstimate} onChange={(e) => setDeliveryEstimate(e.target.value)}
              placeholder="cth: estimasi 25/26 Agustus 2026" style={formSelect} />
          </div>
          <div>
            <FieldLabel tone="delivery">Tanggal Kirim Pasti</FieldLabel>
            <input type="date" value={deliveryConfirmedDate} onChange={(e) => setDeliveryConfirmedDate(e.target.value)}
              style={formSelect} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <FieldLabel tone="link">Link Lokasi</FieldLabel>
          <input value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/..." style={formSelect} />
        </div>

        {/* Promo (D-026) — opsional, cuma PENANDA utk laporan. Cuma muncul
            kalau ada kampanye AKTIF; order lama-tanpa-promo tetap wajar. */}
        {promos.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <FieldLabel tone="promo">Promo (opsional)</FieldLabel>
            <select value={promoId} onChange={(e) => setPromoId(e.target.value)} style={formSelect}>
              <option value="">Tanpa promo</option>
              {promos.map((p) => <option key={p.id} value={p.id}>{promoLabel(p)}</option>)}
            </select>
          </div>
        )}

        {/* BARU/SEWA: harga total langsung di step ini */}
        {!isLayanan && (
          <div style={{ marginBottom: 14 }}>
            <FieldLabel tone="money">Harga Total (Rp)</FieldLabel>
            <input type="number" value={hargaTotal} onChange={(e) => setHargaTotal(e.target.value)}
              placeholder="cth: 5000000" min="0" style={formSelect} />
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          {isLayanan ? (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(2)}>
              Lanjut ke Layanan →
            </button>
          ) : (
            <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving}
              onClick={handleSubmitSimple}>
              {saving ? "Menyimpan..." : "Simpan Order"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
        </div>
      </div>
    );
  }

  // ── Step 2: Layanan (hanya untuk LAYANAN/Service/Upgrade) ──
  return (
    <form onSubmit={handleSubmitLayanan} style={formBox}>
      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>🔧 Service/Upgrade — Daftar Layanan</p>
      {(merkKasur || ukuran) && (
        <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--text-muted)" }}>
          {[merkKasur, ukuran].filter(Boolean).join(" · ")}
          <button type="button" onClick={() => setStep(1)}
            style={{ marginLeft: 8, fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Ubah
          </button>
        </p>
      )}
      <label style={formLabel}>Layanan (add-ons)</label>
      {items.map((it) => (
        <div key={it.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input
            list="new-layanan-suggestions" value={it.layananName}
            onChange={(e) => setItemField(it.key, "layananName", e.target.value)}
            placeholder="Nama layanan..."
            style={{ flex: 2, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
          <input
            type="number" value={it.harga}
            onChange={(e) => setItemField(it.key, "harga", e.target.value)}
            placeholder="Harga (Rp)" min="0"
            style={{ flex: 1, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 90 }}
          />
          {items.length > 1 && (
            <button type="button" onClick={() => removeItem(it.key)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
          )}
        </div>
      ))}
      <datalist id="new-layanan-suggestions">
        {orderOptions.jenisLayanan.map((j) => <option key={j} value={j} />)}
      </datalist>
      <button type="button" onClick={addItem}
        style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: 10 }}>
        + Tambah layanan lain
      </button>
      <div style={{ padding: "8px 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>{formatRupiah(total)}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Order"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>← Kembali</button>
      </div>
    </form>
  );
}

// ─── Container utama ──────────────────────────────────────────────────────────
export default function OrderSection({ customer, onUpdate }) {
  const navigate = useNavigate();
  const [showForm, setShowForm]     = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  // D-030 (20 Agustus 2026) — rincian pesanan lengkap (riwayat status, foto
  // dokumentasi penjemputan/produksi/pengiriman + tanda tangan penerima,
  // pembayaran) dibuka lewat OrderTimelineDrawer yang SAMA dengan halaman
  // Order (features/orders/OrderTimelineDrawer.jsx) — bukan komponen baru,
  // supaya kedua tempat selalu menampilkan data yang identik.
  const [timelineOrder, setTimelineOrder] = useState(null);
  const [orderOptions, setOrderOptions] = useState(EMPTY_ORDER_OPTIONS);
  // D-026 — promo AKTIF saja di sini (order baru cuma boleh pakai kampanye
  // yang sedang berjalan). Order LAMA yang pakai promo yang sudah berakhir
  // tetap menampilkan namanya lewat order.promo (sudah di-include backend),
  // tidak butuh daftar ini untuk itu.
  const [promos, setPromos] = useState([]);

  useEffect(() => {
    api.getOrderOptions().then(setOrderOptions).catch(() => {});
    api.getPromos({ active: true }).then(setPromos).catch(() => {});
  }, []);

  async function refresh() {
    try {
      const fresh = await api.getCustomer(customer.id);
      onUpdate(fresh);
    } catch {}
  }

  function handleDelete(orderId) {
    onUpdate({ ...customer, orders: customer.orders.filter((o) => o.id !== orderId) });
  }

  function toggleExpand(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function bukaChat(order) {
    if (order.conversationId) navigate(`/inbox?conv=${order.conversationId}`);
  }
  // D-030: customer.orders (dari GET /customers/:id) TIDAK punya
  // daysInStatus/daysInStatusPerkiraan — itu dihitung server HANYA di
  // endpoint list GET /orders (dipakai halaman Order). OrderTimelineDrawer
  // dibangun mengasumsikan field itu ada (dipakai kartu "Lama di Status").
  // Supaya tidak muncul "undefined hari", ambil ulang bentuk order yang
  // SAMA dari GET /orders (dicari lewat orderNumber, unique) sebelum buka
  // drawer — fallback ke data lokal kalau gagal (tetap lebih baik daripada
  // drawer tidak terbuka sama sekali).
  async function bukaTimeline(o) {
    const base = {
      ...o,
      customerName: customer.name,
      customerPhone: customer.phone,
      conversationId: customer.conversations?.[0]?.id || null,
    };
    setTimelineOrder(base);
    if (!o.orderNumber) return;
    try {
      const { items } = await api.getOrders({ search: o.orderNumber });
      const fresh = items?.find((it) => it.id === o.id);
      if (fresh) setTimelineOrder({ ...fresh, customerName: customer.name, customerPhone: customer.phone });
    } catch {
      // biarkan `base` yang sudah ditampilkan — kartu "Lama di Status" saja
      // yang tidak akurat, sisanya (dokumentasi/pembayaran) tetap jalan.
    }
  }

  const totalValue = customer.orders.reduce((s, o) => s + o.value, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          {customer.orders.length} order · Total {formatRupiah(totalValue)}
        </p>
        {!showForm && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Order</button>
        )}
      </div>

      {showForm && (
        <AddOrderForm
          customerId={customer.id}
          onDone={() => { setShowForm(false); refresh(); }}
          onCancel={() => setShowForm(false)}
          orderOptions={orderOptions}
          promos={promos}
        />
      )}

      {/* Tabel ringkasan semua order */}
      {customer.orders.length > 0 && (
        // overflow-x auto (bukan hidden) — kolom tidak akan pernah dipotong
        // diam-diam kalau drawer/panel dibuka di layar sempit.
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 360, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                <th style={thStyle}>ID Order</th>
                <th style={thStyle}>Nilai</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, width: 36 }}></th>
                <th style={{ ...thStyle, width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {customer.orders.map((o) => {
                const badge    = ORDER_STATUS_BADGE[o.status] || {};
                const catBadge = CATEGORY_BADGE[o.category] || CATEGORY_BADGE.LAYANAN;
                const isOpen   = expandedId === o.id;
                return (
                  <React.Fragment key={o.id}>
                    <tr
                      onClick={() => toggleExpand(o.id)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: isOpen ? "#f8fafc" : "white", transition: "background 0.1s" }}
                    >
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, padding: "1px 6px", borderRadius: 5, ...catBadge }}>
                            {o.orderNumber || "—"}
                          </span>
                          {o.hasComplaint && (
                            <AlertTriangle size={13} color="#dc2626" title="Ada komplain" />
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{formatRupiah(o.value)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, ...badge }}>
                          {ORDER_STATUS_LABELS[o.status] || o.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button" onClick={() => bukaTimeline(o)}
                          title="Rincian pesanan — riwayat, dokumentasi & pembayaran"
                          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 4, borderRadius: 6, border: "none", background: "var(--accentbg, #eff6ff)", color: "var(--primary)", cursor: "pointer" }}
                        >
                          <PackageSearch size={14} />
                        </button>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ padding: 0 }}>
                          <OrderDetail
                            order={o}
                            customer={customer}
                            customerId={customer.id}
                            onRefresh={refresh}
                            onDelete={handleDelete}
                            orderOptions={orderOptions}
                            promos={promos}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {customer.orders.length === 0 && !showForm && (
        <p className="text-small">Belum ada order. Klik "+ Order" untuk menambah.</p>
      )}

      <OrderTimelineDrawer
        order={timelineOrder}
        onClose={() => setTimelineOrder(null)}
        onOpenChat={bukaChat}
        onPaymentRecorded={refresh}
      />
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────
const thStyle = {
  padding: "8px 12px", textAlign: "left", fontSize: 11,
  fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const formLabel = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.04em", marginBottom: 4,
};

const formSelect = {
  fontSize: 13, padding: "7px 9px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg-primary)",
  color: "var(--text-primary)", width: "100%",
};

const formBox = {
  marginBottom: 16, padding: 14, background: "var(--bg-secondary)",
  borderRadius: 8, border: "1px solid var(--border)",
};

const selStyle = {
  fontSize: 11, padding: "3px 6px", borderRadius: 4,
  border: "1px solid var(--border)", background: "var(--bg-secondary)",
  color: "var(--text-primary)", flexShrink: 0,
};

const selStyleFull = {
  ...selStyle, width: "100%", fontSize: 12, padding: "5px 7px",
};

const metaLabel = {
  display: "block", fontSize: 10, fontWeight: 600,
  color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.05em", marginBottom: 3,
};

const chipStyle = {
  fontSize: 11, padding: "2px 8px", borderRadius: 99,
  background: "#f3f4f6", color: "#374151", fontWeight: 500,
};
