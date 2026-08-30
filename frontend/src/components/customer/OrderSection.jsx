import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown, ChevronUp, Trash2, AlertTriangle, Lock, Copy, Check, PackageSearch,
  Weight, Bed, Ruler, MapPin, HeartPulse, CalendarClock, Link2, Tag, Banknote, MessageSquareText, Send, Truck,
} from "lucide-react";
import { api } from "../../api.js";
import OrderTimelineDrawer from "../../features/orders/OrderTimelineDrawer.jsx";
import { BadgeDropdown } from "@/components/ui/badge-dropdown.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import {
  formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_BADGE, PAYMENT_STATUSES, KOTA_LIST,
  HEALTH_COMPLAINT_LABELS, HEALTH_COMPLAINT_OPTIONS,
  parseOrderNotes, buildOrderNotes, promoLabel,
  PRODUCT_LINE_LABELS, PRODUCT_LINE_ICONS, PRODUCT_TYPES_BY_LINE, PRODUCT_TYPE_LABELS, PRICE_ITEM_KIND_LABELS,
  resolveVariantKey,
} from "../../utils/format.js";
import { isAdminUser, rolesOf } from "../../lib/roles.js";
import { JOB_STATUS_REAL } from "../../features/armada/jobStatus.js";

// D-025 (revisi 19 Agustus 2026): order yang sudah LUNAS dikunci dari role
// lain. Backend (guardOrderLocked() di routes/orders.js) yang benar-benar
// menegakkan ini; helper di sini cuma untuk UI supaya user tidak klik lalu
// kaget oleh error. Pemicunya SEMPAT status DELIVERED, diubah setelah tes
// pilot: order yang sudah terkirim tapi BELUM lunas (COD belum ditagih,
// dst) ternyata tetap butuh diedit sales — uang yang sudah pindah tangan
// itu yang perlu dijaga.
// Revisi 26 Agustus 2026 (permintaan owner): SALES ikut diizinkan
// mengedit, tidak lagi admin-only — cermin persis guardOrderLocked().
function canEditLunasOrder() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return isAdminUser(user) || rolesOf(user).includes("SALES");
  } catch { return false; }
}
// Nama sales yang SEDANG login — dipakai baris "CS:" pesan WA (lihat
// buildWaMessage) supaya menampilkan siapa yang benar-benar menutup/mengisi
// order ini, bukan pemilik lead di CRM (Customer.assignedSales) yang bisa
// beda orang.
function currentUserName() {
  try { return JSON.parse(localStorage.getItem("user") || "null")?.name || null; } catch { return null; }
}

// Jenis Layanan/Merk Kasur/Ukuran Kasur BUKAN lagi hardcode di sini — diambil
// dari GET /api/master-data/order-options (satu sumber dipakai web & mobile,
// lihat backend/src/constants/orderOptions.js) supaya rename/tambah opsi
// (mis. nama layanan) cukup di satu tempat.
const EMPTY_ORDER_OPTIONS = { jenisLayanan: [], merkKasur: [], ukuranKasur: [] };

// Label & ikon untuk pilihan kategori order (29 Agustus 2026 — label
// dilepas dari "Kasur" krn kategori ini sekarang berlaku lintas Lini Produk
// (Kasur/Sofa/Divan, dipilih di step TERPISAH sesudah ini — lihat
// PRODUCT_LINE_OPTIONS). Sebelumnya tertulis literal "Kasur Baru"/"Kasur
// Sewa" krn kasur satu-satunya produk yang ada.
const CATEGORY_OPTIONS = [
  { value: "LAYANAN", icon: "🔧", label: "Service / Upgrade", sub: "Upgrade fondasi, ganti kain, reupholstery, dsb." },
  { value: "BARU",    icon: "✨", label: "Baru",              sub: "Pembelian produk baru" },
  { value: "SEWA",    icon: "📅", label: "Sewa",              sub: "Sewa produk" },
];

const CATEGORY_LABELS = { LAYANAN: "Service/Upgrade", BARU: "Baru", SEWA: "Sewa" };
const CATEGORY_BADGE  = {
  LAYANAN: { bg: "#ede9fe", color: "#5b21b6" },
  BARU:    { bg: "#dcfce7", color: "#166534" },
  SEWA:    { bg: "#dbeafe", color: "#1e40af" },
};

// Lini Produk (29 Agustus 2026) — step BARU antara "pilih kategori layanan"
// dan "isi info produk". Semua kombinasi Kategori x Lini Produk valid
// (dikonfirmasi owner) — tidak ada matriks pembatas di sini.
const PRODUCT_LINE_OPTIONS = [
  { value: "KASUR", icon: PRODUCT_LINE_ICONS.KASUR, label: PRODUCT_LINE_LABELS.KASUR, sub: "Spring, busa, multibed, 2in1" },
  { value: "SOFA",  icon: PRODUCT_LINE_ICONS.SOFA,  label: PRODUCT_LINE_LABELS.SOFA,  sub: "Sofabed, Sofa L, 1/2/3 seater" },
  { value: "DIVAN", icon: PRODUCT_LINE_ICONS.DIVAN, label: PRODUCT_LINE_LABELS.DIVAN, sub: "Divan - Sandaran" },
];

// priceItemId/variantKey/normalPrice/standardPrice (29 Agustus 2026) —
// terisi kalau item dipilih dari katalog harga, tetap null kalau diketik
// bebas. Keduanya sama-sama sah; backend menerima yang null apa adanya.
function newItem(extra = {}) {
  return {
    key: Date.now() + Math.random(),
    layananName: "", harga: "",
    priceItemId: null, variantKey: null, normalPrice: null, standardPrice: null, kind: null,
    ...extra,
  };
}

// Status harga final terhadap batas standard — dihitung saat render, TIDAK
// disimpan (lihat catatan di schema.prisma#OrderItem). Dipakai memberi
// penanda visual, BUKAN mengunci input: keputusan owner 29 Agustus 2026 —
// sales tetap bebas menembus batas, asal kelihatan di laporan.
function hargaStatus(it) {
  const final = Number(it.harga);
  if (!it.harga || Number.isNaN(final) || final <= 0) return null;
  if (it.standardPrice == null) return null;
  if (final < it.standardPrice) {
    return { tone: "under", text: `Rp${(it.standardPrice - final).toLocaleString("id-ID")} di bawah standard`, hex: "#dc2626" };
  }
  if (it.normalPrice != null && final >= it.normalPrice) {
    return { tone: "full", text: "Harga normal penuh", hex: "#16a34a" };
  }
  return { tone: "ok", text: "Dalam batas nego", hex: "#2563eb" };
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
// "Rp1.590.000" — dipakai KHUSUS di pesan WA (bukan formatRupiah() biasa,
// yang sudah dipakai di tempat lain di file ini untuk tampilan angka TANPA
// "Rp" pada beberapa badge — supaya tidak mengubah tampilan itu juga,
// helper pesan WA dipisah sendiri).
function formatRpWa(n) {
  return `Rp${formatAngka(n)}`;
}
// Dirapikan 21 Agustus 2026 — sebelumnya rata "Label : nilai" polos (format
// ketikan manual sales dari sebelum CRM ada). Sales melaporkan susah dibaca
// cepat di HP saat grup ramai. Dikelompokkan per bagian + bold WhatsApp
// (*teks*) supaya bisa di-scan sekilas; SEMUA field yang sebelumnya ada
// tetap ada, tidak ada yang dihapus — cuma disusun ulang.
// actorName: SIAPA yang menyalin/mengirim pesan ini SEKARANG (user yang
// sedang login) — BUKAN customer.assignedSales (pemilik lead, bisa beda
// orang dari yang sedang menutup order ini). Lihat catatan sama di
// backend/src/routes/orders.js#buildWaMessage — DUA definisi ini SENGAJA
// tidak dibagi lewat import (beda sisi client/server), jangan biarkan
// menyimpang, sinkronkan kalau salah satu diubah.
function buildWaMessage(order, customer, actorName) {
  const info   = parseOrderNotes(order.notes);
  const berat  = (order.weightEntries || []).map((w) => w.beratKg).join(", ") || "-";
  const cats   = order.complaintCategory || [];

  const areaSelected = cats.filter((c) => BODY_AREA_LABELS[c]).map((c) => BODY_AREA_LABELS[c]);
  const keluhanLines = [];
  if (areaSelected.length) keluhanLines.push(`  • sakit Area ${areaSelected.join(", ")}`);
  if (cats.includes("PEGAL_PEGAL")) keluhanLines.push("  • Pegal area seluruh badan");
  if (cats.includes("LAINNYA")) keluhanLines.push("  • Lainnya");

  const layanan     = (order.items || []).map((i) => i.layananName).join(", ") || "-";
  const finalBiaya  = order.value || 0;
  // Biaya SEBELUM diskon — dihitung mundur dari final harga, HANYA untuk
  // tampilan pesan WA (bukan disimpan). Kalau promo tidak punya
  // discountPercent (mis. promo bonus item), tidak ada cara menghitung
  // mundur yang benar — tampilkan final biaya apa adanya, jangan menebak.
  const biayaAwal = order.promo?.discountPercent
    ? Math.round(finalBiaya / (1 - order.promo.discountPercent / 100))
    : finalBiaya;
  const alamatLengkap = `${order.deliveryAddress || "-"}${order.deliveryCity ? `, ${order.deliveryCity}` : ""}`;

  return [
    `📦 *ORDER BARU* — ${order.orderNumber || "-"}`,
    ``,
    `👤 *Data Pelanggan*`,
    `Nama: ${customer.name || "-"}`,
    `No. HP: ${customer.phone || "-"}`,
    `Alamat: ${alamatLengkap}`,
    ``,
    `⚖️ *Kondisi Tubuh*`,
    `Berat Badan: ${berat} kg`,
    `Keluhan Fisik saat Bangun Tidur:`,
    keluhanLines.length ? keluhanLines.join("\n") : "  -",
    `Keluhan Kasur: ${info.keluhanCustomer || "-"}`,
    ``,
    `🛏️ *Spesifikasi Kasur*`,
    `Ukuran: ${info.ukuranKasur || "-"}`,
    `Merk: ${info.merkKasur || "-"}`,
    `Layanan: ${layanan}`,
    ``,
    `💰 *Biaya*`,
    `Harga Awal: ${formatRpWa(biayaAwal)}`,
    `Diskon: ${order.promo ? order.promo.code : "-"}`,
    `*Total: ${formatRpWa(finalBiaya)}*`,
    `Ongkir: ${formatRpWa(order.ongkir)}`,
    `Ongkir Klaim Garansi: ${formatRpWa(order.ongkirKlaimGaransi)}`,
    ``,
    `📅 *Jadwal*`,
    `Pick Up: ${order.pickupEstimate || "-"}${order.pickupConfirmedDate ? ` (Pasti: ${formatTanggal(order.pickupConfirmedDate)})` : ""}`,
    `Kirim: ${order.deliveryEstimate || "-"}${order.deliveryConfirmedDate ? ` (Pasti: ${formatTanggal(order.deliveryConfirmedDate)})` : ""}`,
    ``,
    `📍 Lokasi: ${order.locationUrl || "-"}`,
    `🧑‍💼 CS: ${actorName || customer.assignedSales?.name || "-"}`,
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
  const locked = order.paymentStatus === "LUNAS" && !canEditLunasOrder();

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
      await navigator.clipboard.writeText(buildWaMessage(order, customer || {}, currentUserName()));
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
    <div style={{ padding: "12px 14px", background: "var(--bg-secondary)", borderTop: "1px solid var(--border)" }}>
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
              title={locked ? "Order sudah LUNAS — cuma admin/sales yang bisa mengedit" : undefined}
            >
              {locked && <Lock size={11} style={{ marginRight: 4 }} />}Edit
            </button>
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: "var(--red-bg)", color: "var(--red)", border: "none", cursor: "pointer", borderRadius: 6, padding: "4px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
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
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Lock size={12} color="var(--text-secondary)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Order terkunci</span>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Sudah LUNAS — cuma admin/sales yang bisa mengedit lagi.{" "}
            {order.status === "DELIVERED"
              ? 'Kalau pelanggan minta revisi, tandai lewat tombol "Ajukan Revisi" di bawah supaya admin tahu dan bisa menindaklanjuti.'
              : "Kalau ada koreksi yang perlu dilakukan, hubungi admin/sales yang menangani."}
          </p>
        </div>
      )}

      {/* Badge komplain (jika sudah ada) */}
      {order.hasComplaint && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "var(--red-bg)", borderRadius: 8, border: "1px solid var(--red)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <AlertTriangle size={13} color="var(--red)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>Ada Komplain</span>
            <span style={{ fontSize: 11, color: "var(--red)", marginLeft: "auto" }}>{formatTanggal(order.complaintDate)}</span>
          </div>
          {order.complaintDetail && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-primary)" }}>{order.complaintDetail}</p>
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
            <BadgeDropdown
              value={paymentStatus}
              onChange={setPaymentStatus}
              options={PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] || s }))}
              getChipStyle={(v) => PAYMENT_STATUS_BADGE[v] || PAYMENT_STATUS_BADGE.BELUM_BAYAR}
              ariaLabel="Ubah status pembayaran"
            />
          ) : (
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 6, ...PAYMENT_STATUS_BADGE[order.paymentStatus || "BELUM_BAYAR"] }}>
              {PAYMENT_STATUS_LABELS[order.paymentStatus || "BELUM_BAYAR"]}
            </span>
          )}
          {order.statusLocked ? (
            <>
              <span style={{ fontSize: 10.5, color: "var(--orange)", background: "var(--orange-bg)", padding: "2px 7px", borderRadius: 6 }}>
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

        {/* Status Delivery — D-036 (30 Agustus 2026), sama dengan yang
            tampil di kartu Orders.jsx. Sales lihat progres pengambilan/
            pengiriman tanpa buka Delivery & Fulfillment. */}
        {[order.pickupJob && { ...order.pickupJob, label: "Pengambilan" }, order.deliveryJob && { ...order.deliveryJob, label: "Pengiriman" }]
          .filter(Boolean)
          .map((j, i) => (
            <p key={i} style={{ margin: "3px 0 0", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-secondary)" }}>
              <Truck size={11} style={{ flexShrink: 0 }} />
              {j.label}: {JOB_STATUS_REAL[j.status]?.label || j.status}
              {j.driverName ? ` · ${j.driverName}` : ""}
              {j.scheduledDate ? ` · ${new Date(j.scheduledDate).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}` : ""}
            </p>
          ))}

        {overriding && (
          <div style={{ marginTop: 6, padding: 8, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--text-muted)" }}>
              Status normal dihitung otomatis dari unit di Bengkel. Mengubahnya di sini akan
              MENGUNCI status ke pilihan ini sampai dilepas lagi ("Kembalikan ke Otomatis") —
              dipakai untuk kasus di luar pola normal (order dibatalkan, dsb).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
              <BadgeDropdown
                value={overrideStatus}
                onChange={setOverrideStatus}
                options={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] || s }))}
                getChipStyle={(v) => ORDER_STATUS_BADGE[v] || ORDER_STATUS_BADGE.PENDING}
                ariaLabel="Pilih status pengganti"
                triggerClassName="w-full"
              />
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
        {/* productLine (29 Agustus 2026) — SELALU ditampilkan (dulu cuma
            kategori BARU/SEWA yang dapat teks tambahan, krn semua order
            dulu pasti kasur jadi tidak perlu diulang; sekarang produknya
            bisa Sofa/Divan juga, jadi selalu relevan disebut). */}
        {(order.productLine || (order.category && order.category !== "LAYANAN")) && (
          <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
            · {PRODUCT_LINE_LABELS[order.productLine] || "Kasur"}
            {order.category && order.category !== "LAYANAN" ? ` ${CATEGORY_LABELS[order.category]}` : ""}
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
              <FilterDropdown
                value={merkKasur} onChange={setMerkKasur}
                options={orderOptions.merkKasur.map((m) => ({ value: m, label: m }))}
                placeholder="—" ariaLabel="Pilih merk kasur"
                triggerClassName="w-full max-w-none"
              />
            ) : (
              <div style={{ fontSize: 13, fontWeight: 700, padding: "5px 0", color: "#166534" }}>Sano ✓</div>
            )}
          </div>
          <div>
            <FieldLabel tone="size" small>Ukuran</FieldLabel>
            <FilterDropdown
              value={ukuran} onChange={setUkuran}
              options={orderOptions.ukuranKasur.map((u) => ({ value: u, label: u }))}
              placeholder="—" ariaLabel="Pilih ukuran kasur"
              triggerClassName="w-full max-w-none"
            />
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
            <FilterDropdown
              value={deliveryCity} onChange={setDeliveryCity}
              options={KOTA_LIST.map((k) => ({ value: k, label: k }))}
              placeholder="— Pilih Kota —" ariaLabel="Pilih kota pengiriman"
              disabled={locked}
              title={locked ? "Order sudah LUNAS — cuma admin/sales yang bisa mengedit" : undefined}
              triggerClassName="w-full max-w-none"
            />
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
          <FilterDropdown
            value={promoId} onChange={setPromoId}
            options={[
              // Promo yang dipakai order ini sudah tidak aktif lagi — tetap
              // tampilkan sebagai pilihan supaya tidak diam-diam tergeser
              // begitu dropdown dibuka, tapi tandai jelas.
              ...(order.promo && !promos.some((p) => p.id === order.promo.id)
                ? [{ value: order.promo.id, label: `${promoLabel(order.promo)} (sudah berakhir)` }]
                : []),
              ...promos.map((p) => ({ value: p.id, label: promoLabel(p) })),
            ]}
            placeholder="Tanpa promo" ariaLabel="Pilih promo"
            disabled={locked}
            title={locked ? "Order sudah LUNAS — cuma admin/sales yang bisa mengedit" : undefined}
            triggerClassName="w-full max-w-none"
          />
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
              style={{ fontSize: 12, color: "var(--red)", background: "none", border: "1px solid var(--red)", borderRadius: 6, cursor: "pointer", padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}
            >
              <AlertTriangle size={12} /> + Ajukan Revisi / Komplain
            </button>
          ) : (
            <div style={{ padding: 10, background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 8 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--red)" }}>Detail Revisi / Komplain</p>
              <textarea
                value={complaintDetail}
                onChange={(e) => setComplaintDetail(e.target.value)}
                placeholder="Jelaskan masalah/revisi yang diminta customer — admin akan meninjau dan menindaklanjuti..."
                rows={3}
                style={{ width: "100%", fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--red)", resize: "vertical", boxSizing: "border-box" }}
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

// ─── Form tambah order baru (29 Agustus 2026 — perluasan Lini Produk):
// step 0: kategori layanan → step 1: lini produk (Kasur/Sofa/Divan) →
// step 2: jenis produk (dilewati utk Divan, cuma 1 varian) → step 3: info
// produk → step 4: daftar layanan (hanya utk kategori Service/Upgrade) ──
function AddOrderForm({ customerId, onDone, onCancel, orderOptions, promos }) {
  const [step, setStep]               = useState(0);
  const [category, setCategory]       = useState("");
  // Lini Produk & Jenis Produk (29 Agustus 2026) — step BARU antara kategori
  // (step 0) dan info produk (step 3, dulu step 1 — lihat renumbering di
  // bawah). isKasur menentukan apakah field fitting berat-badan & dropdown
  // Merk Kasur (kurasi merk kasur, tidak relevan Sofa/Divan) ditampilkan.
  //
  // BUG DITEMUKAN & DIPERBAIKI (29 Agustus 2026, review sebelum EAS build):
  // field Ukuran SEMPAT ikut digerbang `isKasur` juga — akibatnya utk Divan,
  // Ukuran jadi input bebas, padahal katalog harga Divan (Service Divan/
  // Sandaran, Divan, Sandaran) KUNCI VARIANNYA SAMA PERSIS dgn Kasur (lebar
  // 90-200, lihat PRICE_ITEM_KIND/PriceRate.variantKey), BUKAN free-text.
  // Hasilnya: resolveVariantKey() tidak akan PERNAH cocok utk Divan, dan
  // katalog harga Divan tidak akan pernah muncul sama sekali di form —
  // fitur yang baru dibangun jadi mati utk satu lini produk penuh.
  // usesUkuranDropdown DIPISAH dari isKasur khusus utk ini: Kasur & Divan
  // sama-sama pakai dropdown ukuran (varian widthnya identik), Sofa TETAP
  // free-text (variant-nya dari Jenis Produk, bukan lebar).
  const [productLine, setProductLine] = useState("");
  const [productType, setProductType] = useState("");
  const isKasur = productLine === "KASUR";
  const usesUkuranDropdown = productLine === "KASUR" || productLine === "DIVAN";
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
  const [items, setItems]             = useState([newItem()]);
  const [weightEntries, setWeightEntries] = useState([newWeightEntry()]);
  const [saving, setSaving]           = useState(false);
  // Katalog harga (29 Agustus 2026) — dimuat saat masuk step 4, sesuai lini
  // produk + varian yang sudah dipilih di step 1-3.
  const [catalog, setCatalog]               = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError]     = useState(null);

  const isLayanan = category === "LAYANAN";
  const total     = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);
  const variantKey = resolveVariantKey({ productLine, productType, ukuran });

  // Muat katalog begitu sampai di step daftar layanan/produk. Kalau varian
  // belum bisa ditentukan (mis. "Ukuran Custom"), katalog SENGAJA tidak
  // dimuat — harga per ukuran tidak ada padanannya, jadi isian manual yang
  // benar. `category` (30 Agustus 2026) memfilter kind yang relevan —
  // SEBELUMNYA tidak dikirim sama sekali, jadi LAYANAN ikut menampilkan
  // PRODUCT yang nyasar (kelihatan di Divan: Service+Divan+Sandaran
  // tercampur di 1 daftar), dan step ini malah tidak pernah dicapai untuk
  // BARU/SEWA (lihat bug fix step 3 di bawah — dulu langsung submit lewat
  // handleSubmitSimple, katalog PRODUCT/RENTAL yang sudah ada di database
  // tidak pernah ditampilkan ke sales).
  useEffect(() => {
    if (step !== 4 || !productLine || !variantKey) return;
    let batal = false;
    setCatalogLoading(true);
    setCatalogError(null);
    api.getPriceList(productLine, variantKey, category)
      .then((res) => { if (!batal) setCatalog(res.items || []); })
      .catch((err) => { if (!batal) setCatalogError(err.message); })
      .finally(() => { if (!batal) setCatalogLoading(false); });
    return () => { batal = true; };
  }, [step, productLine, variantKey, category]);

  // Tambah layanan dari katalog. Harga final di-prefill HARGA NORMAL (harga
  // papan) — bukan standard: standard itu BATAS BAWAH nego, kalau dijadikan
  // nilai awal sales tidak pernah mulai menawar dari harga penuh. Untuk baris
  // yang di daftar harga cuma punya kolom standard, itulah yang dipakai.
  function addFromCatalog(p) {
    const prefill = p.normalPrice ?? p.standardPrice ?? "";
    const baru = newItem({
      layananName: p.name,
      harga: prefill === "" ? "" : String(prefill),
      priceItemId: p.id, variantKey: p.variantKey,
      normalPrice: p.normalPrice, standardPrice: p.standardPrice,
      kind: p.kind,
    });
    // Buang baris kosong bawaan supaya tidak menyisakan baris hampa di atas.
    setItems((prev) => [...prev.filter((it) => it.layananName?.trim() || it.harga), baru]);
  }

  const dipakai = new Set(items.map((it) => it.priceItemId).filter(Boolean));

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

  // Submit untuk SEMUA kategori (LAYANAN/BARU/SEWA) — 30 Agustus 2026,
  // disatukan dari 2 fungsi terpisah (handleSubmitSimple utk BARU/SEWA yang
  // cuma menerima 1 angka "Harga Total" manual + handleSubmitLayanan). Step
  // 4 sekarang jadi step katalog+items[] BERSAMA utk ketiga kategori (lihat
  // fetch katalog di atas & tombol "Lanjut" di step 3), jadi BARU/SEWA juga
  // bisa pilih dari katalog PRODUCT/RENTAL yang sebelumnya tidak pernah
  // ditampilkan sama sekali — bukan lagi wajib ketik manual.
  async function handleSubmitLayanan(e) {
    e.preventDefault();
    const validItems = items.filter((it) => it.layananName?.trim());
    if (validItems.length === 0) return alert("Tambahkan minimal satu " + (isLayanan ? "layanan" : "item"));
    setSaving(true);
    try {
      const order = await api.addOrder(customerId, {
        category,
        productLine: productLine || undefined,
        productType: productType || undefined,
        // Merk cuma relevan utk LAYANAN (upgrade kasur existing customer,
        // merknya bisa apa saja) — BARU/SEWA selalu produk Sano sendiri.
        notes: buildOrderNotes({ merkKasur: isLayanan ? merkKasur : "Sano", ukuranKasur: ukuran, keluhanCustomer: keluhan }),
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
        await api.addOrderItem(order.id, {
          layananName: it.layananName,
          harga: Number(it.harga) || 0,
          // Snapshot katalog — null semua kalau item diketik bebas.
          priceItemId: it.priceItemId || undefined,
          variantKey: it.variantKey || undefined,
          normalPrice: it.normalPrice ?? undefined,
          standardPrice: it.standardPrice ?? undefined,
          kind: it.kind || undefined,
        });
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

  // ── Step 1: Pilih Lini Produk (29 Agustus 2026 — BARU) ──
  // Berlaku utk SEMUA kategori (termasuk Service/Upgrade — dikonfirmasi
  // owner: servis Sofa/Divan sekarang layanan baru juga, jadi tidak boleh
  // diasumsikan kasur terus). Divan cuma 1 jenis produk (Sandaran) — auto-
  // set & lompat langsung ke step 3, tidak perlu step 2.
  if (step === 1) {
    const catOpt = CATEGORY_OPTIONS.find((o) => o.value === category);
    return (
      <div style={formBox}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
          {catOpt?.icon} {catOpt?.label} — Pilih Lini Produk
        </p>
        <button type="button" onClick={() => setStep(0)}
          style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 0 10px" }}>
          ← Ganti kategori
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {PRODUCT_LINE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setProductLine(opt.value);
                if (opt.value === "DIVAN") {
                  setProductType("DIVAN_SANDARAN");
                  setStep(3);
                } else {
                  setProductType("");
                  setStep(2);
                }
              }}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                border: productLine === opt.value ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: productLine === opt.value ? "#eff6ff" : "var(--bg-card)",
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
        <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    );
  }

  // ── Step 2: Pilih Jenis Produk (29 Agustus 2026 — BARU, hanya Kasur/Sofa) ──
  if (step === 2) {
    const lineOpt = PRODUCT_LINE_OPTIONS.find((o) => o.value === productLine);
    const jenisList = PRODUCT_TYPES_BY_LINE[productLine] || [];
    return (
      <div style={formBox}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
          {lineOpt?.icon} {lineOpt?.label} — Pilih Jenis
        </p>
        <button type="button" onClick={() => setStep(1)}
          style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 0 10px" }}>
          ← Ganti lini produk
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {jenisList.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => { setProductType(val); setStep(3); }}
              style={{
                textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                border: productType === val ? "2px solid var(--primary)" : "1px solid var(--border)",
                background: productType === val ? "#eff6ff" : "var(--bg-card)",
                fontSize: 13, fontWeight: 600, transition: "all 0.15s",
              }}
            >
              {PRODUCT_TYPE_LABELS[val]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    );
  }

  // ── Step 3: Info produk (dulu step 1 — geser krn step Lini/Jenis Produk
  // baru disisipkan di atas). Field fitting berat-badan & dropdown Merk
  // KHUSUS Kasur (fitting kekerasan by berat badan tidak berlaku sofa/divan;
  // dropdown merk kasur dari Settings juga tidak ada padanannya utk lini
  // baru ini, jadi Sofa/Divan pakai input bebas). ──
  if (step === 3) {
    const opt = CATEGORY_OPTIONS.find((o) => o.value === category);
    const lineLabel = PRODUCT_LINE_LABELS[productLine] || "Produk";
    return (
      <div style={formBox}>
        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
          {opt?.icon} {opt?.label} — Info {lineLabel}
        </p>
        <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--text-muted)" }}>
          {lineLabel}{productType ? ` · ${PRODUCT_TYPE_LABELS[productType]}` : ""}
        </p>
        <button type="button" onClick={() => setStep(isKasur || productLine === "SOFA" ? 2 : 1)}
          style={{ fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "0 0 10px" }}>
          ← Ganti jenis
        </button>

        {/* Berat Badan — multi-orang. KHUSUS Kasur (fitting kekerasan by
            berat badan) — tidak relevan utk Sofa/Divan. */}
        {isKasur && (
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
        )}

        {/* Merk — utk BARU/SEWA SELALU "Sano ✓" (produk kami sendiri, apa
            pun lini produknya). Utk Service/Upgrade: dropdown kurasi
            Settings KHUSUS Kasur (daftar merk kasur yang sudah ada);
            Sofa/Divan belum punya daftar merk terkurasi, jadi input bebas
            menanyakan merk EXISTING milik customer. */}
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="bed">{isKasur ? "Merk Kasur" : `Merk/Model ${lineLabel}`}</FieldLabel>
          {!isLayanan ? (
            <div style={{ fontSize: 13, fontWeight: 700, padding: "7px 0", color: "#166534" }}>Sano ✓</div>
          ) : isKasur ? (
            <FilterDropdown
              value={merkKasur} onChange={setMerk}
              options={orderOptions.merkKasur.map((m) => ({ value: m, label: m }))}
              placeholder="— Pilih Merk —" ariaLabel="Pilih merk kasur"
              triggerClassName="w-full max-w-none"
            />
          ) : (
            <input
              value={merkKasur} onChange={(e) => setMerk(e.target.value)}
              placeholder={`cth: merk ${lineLabel.toLowerCase()} yang sudah dimiliki customer`}
              style={formSelect}
            />
          )}
        </div>

        {/* Ukuran — dropdown lebar (90-200) utk Kasur DAN Divan (variantKey
            katalog harga dua-duanya sama-sama lebar, lihat catatan bug di
            atas); Sofa input bebas (variant-nya dari Jenis Produk, bukan
            lebar). */}
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="size">{usesUkuranDropdown ? (isKasur ? "Ukuran Kasur" : `Ukuran ${lineLabel}`) : `Ukuran/Konfigurasi ${lineLabel}`}</FieldLabel>
          {usesUkuranDropdown ? (
            <FilterDropdown
              value={ukuran} onChange={setUkuran}
              options={orderOptions.ukuranKasur.map((u) => ({ value: u, label: u }))}
              placeholder="— Pilih Ukuran —" ariaLabel="Pilih ukuran"
              triggerClassName="w-full max-w-none"
            />
          ) : (
            <input
              value={ukuran} onChange={(e) => setUkuran(e.target.value)}
              placeholder="cth: 3 seater, abu-abu"
              style={formSelect}
            />
          )}
        </div>
        {/* Kota + Alamat pengiriman (D-027) — TERPISAH dari Customer.city,
            1 customer bisa order untuk alamat berbeda-beda. */}
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tone="address">Kota</FieldLabel>
          <FilterDropdown
            value={deliveryCity} onChange={setDeliveryCity}
            options={KOTA_LIST.map((k) => ({ value: k, label: k }))}
            placeholder="— Pilih Kota —" ariaLabel="Pilih kota pengiriman"
            triggerClassName="w-full max-w-none"
          />
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
            <FilterDropdown
              value={promoId} onChange={setPromoId}
              options={promos.map((p) => ({ value: p.id, label: promoLabel(p) }))}
              placeholder="Tanpa promo" ariaLabel="Pilih promo"
              triggerClassName="w-full max-w-none"
            />
          </div>
        )}

        {/* BARU/SEWA (30 Agustus 2026) dulu berhenti di sini dgn 1 input
            "Harga Total" manual — sekarang SEMUA kategori lanjut ke step 4
            yang sama, memuat katalog PRODUCT (BARU) / RENTAL (SEWA) yang
            sebelumnya tidak pernah ditampilkan sama sekali. */}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(4)}>
            Lanjut ke {isLayanan ? "Layanan" : "Daftar Harga"} →
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
        </div>
      </div>
    );
  }

  // ── Step 4: Layanan/Produk (dulu step 2 — geser krn step Lini/Jenis
  // Produk baru disisipkan, lihat step 1 & 2). SEJAK 30 Agustus 2026 step
  // ini dipakai BERSAMA oleh ketiga kategori (LAYANAN/BARU/SEWA), bukan
  // cuma LAYANAN — lihat catatan di tombol "Lanjut" step 3 & fetch katalog
  // di atas. ──
  const lineLabelStep4 = PRODUCT_LINE_LABELS[productLine] || "";
  const step4Icon  = isLayanan ? "🔧" : category === "SEWA" ? "📦" : "🛒";
  const step4Title = isLayanan ? "Service/Upgrade" : category === "SEWA" ? "Sewa" : "Baru";
  return (
    <form onSubmit={handleSubmitLayanan} style={formBox}>
      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
        {step4Icon} {step4Title}{lineLabelStep4 ? ` — ${lineLabelStep4}` : ""} — Daftar {isLayanan ? "Layanan" : "Harga"}
      </p>
      {(merkKasur || ukuran || productType) && (
        <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--text-muted)" }}>
          {[PRODUCT_TYPE_LABELS[productType], merkKasur, ukuran].filter(Boolean).join(" · ")}
          <button type="button" onClick={() => setStep(3)}
            style={{ marginLeft: 8, fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Ubah
          </button>
        </p>
      )}
      {/* ── Katalog harga (29 Agustus 2026) ────────────────────────────────
          Muncul begitu lini produk + varian diketahui. Kalau katalog kosong
          / gagal dimuat / varian tidak bisa ditentukan ("Ukuran Custom"),
          bagian ini disembunyikan dan form kembali ke isian bebas seperti
          sebelumnya — bukan error, dan form tetap bisa dipakai. */}
      {catalogLoading && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>Memuat daftar harga…</p>
      )}
      {catalogError && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#dc2626" }}>
          Daftar harga gagal dimuat ({catalogError}). Isi {isLayanan ? "layanan" : "item"} &amp; harga manual di bawah.
        </p>
      )}
      {!catalogLoading && !catalogError && catalog.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label style={formLabel}>
            Pilih dari daftar harga
            <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 6 }}>
              ({PRODUCT_LINE_LABELS[productLine]} · {productLine === "SOFA" ? PRODUCT_TYPE_LABELS[productType] : `ukuran ${variantKey}`})
            </span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
            {catalog.map((p) => {
              const sudah = dipakai.has(p.id);
              return (
                <button
                  key={p.id} type="button" disabled={sudah}
                  onClick={() => addFromCatalog(p)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                    padding: "7px 9px", borderRadius: 6, textAlign: "left",
                    border: "1px solid " + (sudah ? "transparent" : "var(--border)"),
                    background: sudah ? "var(--bg-secondary)" : "var(--bg-card)",
                    cursor: sudah ? "default" : "pointer", opacity: sudah ? 0.55 : 1,
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, display: "block" }}>{p.name}</span>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                      {PRICE_ITEM_KIND_LABELS[p.kind] || p.kind}{sudah ? " · sudah ditambahkan" : ""}
                    </span>
                  </span>
                  <span style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 11 }}>
                    {p.belumBerharga ? (
                      <span style={{ color: "var(--text-muted)" }}>harga belum ditetapkan</span>
                    ) : (
                      <>
                        {p.normalPrice != null && (
                          <span style={{ display: "block", color: "var(--text-secondary)" }}>
                            Normal {formatRupiah(p.normalPrice)}
                          </span>
                        )}
                        {p.standardPrice != null && (
                          <span style={{ display: "block", color: "#c2570b", fontWeight: 600 }}>
                            Standard {formatRupiah(p.standardPrice)}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label style={formLabel}>{isLayanan ? "Layanan yang diambil" : "Item yang diambil"}</label>
      {items.map((it) => {
        const st = hargaStatus(it);
        return (
          <div key={it.key} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                list="new-layanan-suggestions" value={it.layananName}
                onChange={(e) => setItemField(it.key, "layananName", e.target.value)}
                placeholder="Nama layanan..."
                style={{ flex: 2, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <input
                type="number" value={it.harga}
                onChange={(e) => setItemField(it.key, "harga", e.target.value)}
                placeholder="Harga final (Rp)" min="0"
                style={{
                  flex: 1, fontSize: 12, padding: "7px 8px", borderRadius: 6, minWidth: 90,
                  border: "1px solid " + (st?.tone === "under" ? "#dc2626" : "var(--border)"),
                }}
              />
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(it.key)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
              )}
            </div>
            {/* Referensi harga + penanda posisi nego. Cuma muncul untuk item
                dari katalog — item ketik-bebas tidak punya pembanding. */}
            {(it.normalPrice != null || it.standardPrice != null) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 10.5, marginTop: 3, paddingLeft: 2 }}>
                {it.normalPrice != null && (
                  <span style={{ color: "var(--text-muted)" }}>Normal {formatRupiah(it.normalPrice)}</span>
                )}
                {it.standardPrice != null && (
                  <span style={{ color: "#c2570b" }}>Standard {formatRupiah(it.standardPrice)}</span>
                )}
                {st && (
                  <span style={{ color: st.hex, fontWeight: 700, background: `${st.hex}14`, padding: "1px 7px", borderRadius: 99 }}>
                    {st.text}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
      <datalist id="new-layanan-suggestions">
        {orderOptions.jenisLayanan.map((j) => <option key={j} value={j} />)}
      </datalist>
      <button type="button" onClick={addItem}
        style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: 10 }}>
        + Tambah {isLayanan ? "layanan" : "item"} di luar daftar harga
      </button>
      <div style={{ padding: "8px 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>{formatRupiah(total)}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Order"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(3)}>← Kembali</button>
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
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: isOpen ? "var(--bg-secondary)" : "var(--bg-card)", transition: "background 0.1s" }}
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
  background: "var(--bg-secondary)", color: "var(--text-secondary)", fontWeight: 500,
};
