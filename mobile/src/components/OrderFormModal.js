// Form order dari HP — dipakai untuk BIKIN order baru MAUPUN EDIT order yang
// sudah ada (prop `order` diisi -> mode edit), struktur field SAMA dengan
// AddOrderForm/OrderDetail web (frontend/src/components/customer/
// OrderSection.jsx): Kategori, Berat Badan (multi-orang), Merk Kasur, Ukuran
// Kasur, Keluhan/Catatan, Harga Total (BARU/SEWA) atau daftar Layanan
// add-ons (LAYANAN), + Status (HANYA muncul di mode edit — dicek langsung ke
// AddOrderForm web, form CREATE juga TIDAK punya field status di sana, order
// baru selalu mulai dari default backend PENDING; status baru relevan
// setelah order ada, sama seperti OrderDetail edit mode). Field bertumpuk
// vertikal (bukan wizard multi-step ala web) — layar HP lebih sempit, semua
// muat lewat 1 ScrollView; dropdown pakai bottom-sheet picker (PickerSheet)
// konsisten dengan pola di CustomerProfileContent.js.
//
// Merk Kasur & Ukuran Kasur & Jenis Layanan (opsi) diambil dari
// GET /master-data/order-options — SATU sumber sama dengan web, bukan
// hardcode duplikat (lihat backend/src/constants/orderOptions.js).
//
// Endpoint dipakai (sama persis dengan web, lihat OrderSection.jsx):
//   CREATE: POST /customers/:id/orders, POST /orders/:orderId/items,
//           POST /orders/:orderId/weight-entries
//   EDIT:   PATCH /orders/:id (status+notes), lalu diff items/weightEntries
//           (POST baris baru, PATCH yang berubah, DELETE yang dihapus) —
//           pola diff SAMA dengan OrderCard.js#handleSave (sebelum ini form
//           edit terpisah ada di sana, sekarang disatukan ke sini supaya
//           cuma ADA SATU implementasi form order, bukan 2 yang bisa saling
//           drift — lihat CustomerProfileContent.js#editingOrder).
//   DELETE: DELETE /orders/:id — dipanggil dari tombol trash di header form
//           edit, ATAU dari OrderCard.js langsung tanpa buka form (dua-duanya
//           tetap didukung, task eksplisit izinkan salah satu).
// notes disimpan JSON {merkKasur, ukuranKasur, keluhanCustomer} — format
// SAMA persis dengan buildNotes()/parseNotes() di OrderSection.jsx web,
// supaya order dari mobile tampil benar juga di CRM web (dan sebaliknya).
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert, ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { Package, X, Trash2 } from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTokens } from "../constants/theme";
import { formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES } from "../utils/format";
import { useSheetMaxHeight } from "../lib/useSheetMaxHeight";
import DateField from "./DateField";
import { stageLabels, stageColors } from "../theme";

// FITUR (tambahan): Tahap Pipeline (New/Qualified/.../Paid) SEBELUMNYA cuma
// bisa diubah dari web CRM (Orders.jsx) atau dari tab Pelanggan mobile —
// tab Order (order-centric, lintas pelanggan) tidak punya jalur ubah pipeline
// sama sekali, jadi order yang sudah bayar/selesai ("Paid") harus ditandai
// lewat CRM web dulu, tidak bisa langsung dari HP. STAGE_ORDER SAMA PERSIS
// dengan urutan di stageLabels/stageColors (theme.js) — satu sumber warna &
// label, bukan didefinisikan ulang di sini.
const STAGE_ORDER = Object.keys(stageLabels);

const CATEGORY_OPTIONS = [
  { value: "LAYANAN", label: "Service/Upgrade" },
  { value: "BARU", label: "Kasur Baru" },
  { value: "SEWA", label: "Kasur Sewa" },
];

// D-027/D-028/D-029 (20 Agustus 2026) — paritas dengan web
// (frontend/src/components/customer/OrderSection.jsx & utils/format.js).
// Konstanta ini SAMA PERSIS dengan versi web — kalau daftar kota/kategori
// keluhan berubah di sana, ubah juga di sini (belum ada API master-data
// untuk ini, sama seperti web yang juga masih hardcode).
const KOTA_LIST = [
  "Jakarta Selatan", "Jakarta Barat", "Jakarta Utara", "Jakarta Pusat", "Jakarta Timur",
  "Bekasi", "Tangerang", "Bogor", "Depok", "Bandung", "Sukabumi", "Karawang",
];
const HEALTH_COMPLAINT_LABELS = {
  KEPALA_PUSING:  "Kepala Pusing",
  SAKIT_PINGGANG: "Sakit Pinggang",
  SAKIT_PUNGGUNG: "Sakit Punggung",
  SAKIT_LEHER:    "Sakit Leher",
  BAHU:           "Bahu",
  PEGAL_PEGAL:    "Pegal-pegal",
  SARAF_KEJEPIT:  "Saraf Kejepit",
  SKOLIOSIS:      "Skoliosis",
  LAINNYA:        "Lainnya",
};
const HEALTH_COMPLAINT_OPTIONS = Object.keys(HEALTH_COMPLAINT_LABELS);

function newItem() {
  return { key: String(Date.now()) + Math.random(), layananName: "", harga: "" };
}
function newWeightEntry() {
  return { key: String(Date.now()) + Math.random(), label: "", beratKg: "" };
}
function buildNotes({ merkKasur, ukuranKasur, keluhanCustomer }) {
  return JSON.stringify({ merkKasur: merkKasur || "", ukuranKasur: ukuranKasur || "", keluhanCustomer: keluhanCustomer || "" });
}
function parseNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "" };
  try {
    const p = JSON.parse(notes);
    return { merkKasur: p.merkKasur || "", ukuranKasur: p.ukuranKasur || "", keluhanCustomer: p.keluhanCustomer || "" };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes };
  }
}

// D-026 fix (20 Agustus 2026) — satu campaign (mis. "MDSP-Aug") sering
// punya BEBERAPA kode voucher berbeda (MERDEKA10, MERDEKA8, dst) sebagai
// promo TERPISAH dengan `name` yang sama persis. Menampilkan cuma `name`
// bikin sales lihat "MDSP-Aug" dobel tanpa tahu mana yang mana. Kode
// SELALU ditaruh duluan (paling menonjol) karena itu satu-satunya pembeda.
function promoLabel(p) {
  return `${p.code} — ${p.name}`;
}

// Bottom-sheet pilih 1 opsi — dipakai Merk Kasur, Ukuran Kasur, pilihan
// cepat Jenis Layanan per baris item, dan (D-026) Promo.
//
// `options` awalnya SELALU array string biasa (dipilih apa adanya sebagai
// value). Promo BUKAN string — perlu tampilkan `name` tapi kembalikan `id`
// — jadi `getKey`/`getLabel` ditambahkan sebagai prop OPSIONAL (default ke
// identity function) supaya 3 pemanggil lama tetap jalan tanpa diubah sama
// sekali, cuma pemanggil Promo yang mengisinya.
function PickerSheet({ visible, title, options, onSelect, onClose, getKey = (o) => o, getLabel = (o) => o }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={getKey}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerItem} onPress={() => { onSelect(item); onClose(); }}>
                <Text style={styles.pickerItemText}>{getLabel(item)}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function OrderFormModal({
  visible, order, customerId, onClose, onCreated, onUpdated, onDeleted, orderOptions: orderOptionsProp,
}) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // overlayStyle MENDORONG sheet naik ke atas keyboard (paddingBottom pada
  // overlay flex-end); maxHeight membatasi tingginya. Keduanya WAJIB bersama
  // — lihat lib/useSheetMaxHeight.js untuk kenapa mengecilkan tinggi saja
  // (pola lama file ini, sebelum fix ini) tidak menyelesaikan apa pun: sheet
  // tetap menempel di DASAR layar (overlay justifyContent:"flex-end"), jadi
  // tetap di belakang keyboard walau tingginya sudah dikecilkan.
  const { maxHeight: sheetMaxHeight, overlayStyle } = useSheetMaxHeight(0.88);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState(null);

  // orderOptions: opsional — kalau parent (CustomerProfileContent.js) sudah
  // fetch sekali & pakai ulang buat OrderCard.js juga, cukup dioper lewat
  // prop di sini supaya tidak dobel GET /master-data/order-options tiap
  // modal ini dibuka. Caller lama (belum dikasih prop ini) tetap jalan —
  // fallback fetch sendiri seperti sebelumnya.
  const [orderOptionsState, setOrderOptionsState] = useState({ jenisLayanan: [], merkKasur: [], ukuranKasur: [] });
  const orderOptions = orderOptionsProp || orderOptionsState;
  const [category, setCategory] = useState("LAYANAN");
  const [status, setStatus] = useState("PENDING");
  const [paymentStatus, setPaymentStatus] = useState("BELUM_BAYAR");
  // pipelineStage: null = tidak ditampilkan sama sekali (order dari konteks
  // CustomerProfileContent.js, yang sudah py editor pipeline sendiri di atas
  // profil — jangan dobel). Order dari OrdersScreen.js (tab Order lintas
  // pelanggan) SELALU bawa field ini (denormalized dari customer, lihat
  // backend/src/routes/orders.js GET / — `pipelineStage: customer?.pipelineStage`),
  // walau nilainya sendiri bisa null (customer belum punya stage).
  const [pipelineStage, setPipelineStage] = useState(null);
  const [savingStage, setSavingStage] = useState(false);
  // FITUR (tambahan): Order.quantity SUDAH ada di backend (default 1, dipakai
  // POST /customers/:id/orders & PATCH /orders/:id) tapi belum pernah
  // di-expose di form manapun (web maupun mobile) — selalu diam-diam ke-set
  // default 1. Ditambahkan di sini per permintaan, form web belum menyusul
  // (di luar scope task ini).
  const [quantity, setQuantity] = useState("1");
  const [merkKasur, setMerkKasur] = useState("");
  const [ukuran, setUkuran] = useState("");
  // D-027: kota + alamat pengiriman order ini — TERPISAH dari Customer.city
  // (1 customer bisa order untuk alamat berbeda-beda), sama seperti web.
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [showKotaPicker, setShowKotaPicker] = useState(false);
  // D-028: Sakit/Tidak Sakit + kategori keluhan (multi-pilih, lihat komentar
  // enum HealthComplaintCategory di backend — keluhan biasanya lebih dari
  // satu area sekaligus).
  const [healthStatus, setHealthStatus] = useState("");
  const [complaintCategory, setComplaintCategory] = useState([]);
  // D-029: field tambahan supaya form order menangkap semua yang selama ini
  // diketik ulang manual sales ke grup WA (ongkir, estimasi pickup, lokasi).
  const [ongkir, setOngkir] = useState("");
  const [ongkirKlaimGaransi, setOngkirKlaimGaransi] = useState("");
  const [pickupEstimate, setPickupEstimate] = useState("");
  const [pickupConfirmedDate, setPickupConfirmedDate] = useState("");
  const [deliveryEstimate, setDeliveryEstimate] = useState("");
  const [deliveryConfirmedDate, setDeliveryConfirmedDate] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [keluhan, setKeluhan] = useState("");
  const [hargaTotal, setHargaTotal] = useState("");
  const [items, setItems] = useState([newItem()]);
  const [weightEntries, setWeightEntries] = useState([newWeightEntry()]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // D-026 — promo cuma PENANDA (lihat catatan panjang di schema.prisma
  // model Promo), sama seperti web (OrderSection.jsx). `promos` HANYA yang
  // aktif (?active=true) — order lama yang pakai kampanye yang sudah
  // berakhir tetap menampilkan namanya dari `order.promo` (di-include
  // backend), tidak butuh daftar ini untuk itu, lihat promoLabel di bawah.
  const [promos, setPromos] = useState([]);
  const [promoId, setPromoId] = useState("");
  const [showPromoPicker, setShowPromoPicker] = useState(false);

  const [showMerkPicker, setShowMerkPicker] = useState(false);
  const [showUkuranPicker, setShowUkuranPicker] = useState(false);
  const [layananPickerTarget, setLayananPickerTarget] = useState(null); // item key sedang dipilih

  const isEdit = !!order;
  const isLayanan = category === "LAYANAN";

  // BUG YANG DIPERBAIKI (26 Agustus 2026): backend MENOLAK PATCH/item-edit
  // untuk order LUNAS kalau bukan admin/sales (D-025, lihat routes/orders.js
  // guardOrderLocked) — tapi form ini sebelumnya TIDAK TAHU itu sama sekali,
  // jadi user bebas isi SELURUH form (Ongkir, Estimasi, Layanan, dst),
  // baru ditolak lewat Alert generik pas tekan "Simpan Order" di paling
  // akhir. Web (OrderSection.jsx) sudah lama kasih tahu di depan — mobile
  // sekarang menyusul: banner + tombol submit dinonaktifkan SEBELUM user
  // buang waktu isi form yang sudah pasti ditolak.
  //
  // REVISI (sama hari, permintaan owner): SALES ikut diizinkan mengedit,
  // tidak lagi admin-only — cermin persis guardOrderLocked() di backend.
  const { user } = useAuth();
  const userRoles = Array.isArray(user?.roles) && user.roles.length > 0 ? user.roles : [user?.role];
  const canEditLunas = userRoles.includes("ADMIN") || userRoles.includes("SALES");
  const locked = isEdit && order?.paymentStatus === "LUNAS" && !canEditLunas;
  // order.pipelineStage cuma ada kalau caller-nya OrdersScreen.js (lihat
  // catatan panjang di deklarasi state pipelineStage di atas).
  const showPipelineEditor = isEdit && Object.prototype.hasOwnProperty.call(order, "pipelineStage");

  // Reset (create) ATAU prefill (edit) tiap kali modal dibuka — bukan cuma
  // sekali di mount, karena instance modal ini dipakai ULANG bergantian utk
  // order yang beda-beda (lihat CustomerProfileContent.js#editingOrder).
  useEffect(() => {
    if (!visible) return;
    setLoadingProducts(true);
    setSearch("");
    setSelectedProductId(null);
    api.getProducts().then(setProducts).catch(() => {}).finally(() => setLoadingProducts(false));
    if (!orderOptionsProp) api.getOrderOptions().then(setOrderOptionsState).catch(() => {});
    api.getPromos({ active: true }).then(setPromos).catch(() => {});

    if (order) {
      const info = parseNotes(order.notes);
      setCategory(order.category || "LAYANAN");
      setStatus(order.status || "PENDING");
      setPaymentStatus(order.paymentStatus || "BELUM_BAYAR");
      setPipelineStage(order.pipelineStage ?? null);
      setQuantity(order.quantity ? String(order.quantity) : "1");
      setMerkKasur(info.merkKasur);
      setUkuran(info.ukuranKasur);
      setDeliveryCity(order.deliveryCity || "");
      setDeliveryAddress(order.deliveryAddress || "");
      setHealthStatus(order.healthStatus || "");
      setComplaintCategory(order.complaintCategory || []);
      setOngkir(order.ongkir != null ? String(order.ongkir) : "");
      setOngkirKlaimGaransi(order.ongkirKlaimGaransi != null ? String(order.ongkirKlaimGaransi) : "");
      setPickupEstimate(order.pickupEstimate || "");
      setPickupConfirmedDate(order.pickupConfirmedDate ? order.pickupConfirmedDate.slice(0, 10) : "");
      setDeliveryEstimate(order.deliveryEstimate || "");
      setDeliveryConfirmedDate(order.deliveryConfirmedDate ? order.deliveryConfirmedDate.slice(0, 10) : "");
      setLocationUrl(order.locationUrl || "");
      setKeluhan(info.keluhanCustomer);
      setPromoId(order.promoId || "");
      setHargaTotal(order.value ? String(order.value) : "");
      setItems(
        (order.items && order.items.length > 0)
          ? order.items.map((it) => ({ ...it, key: it.id, harga: String(it.harga) }))
          : [newItem()]
      );
      setWeightEntries(
        (order.weightEntries && order.weightEntries.length > 0)
          ? order.weightEntries.map((e) => ({ ...e, key: e.id, beratKg: String(e.beratKg) }))
          : [newWeightEntry()]
      );
    } else {
      setCategory("LAYANAN");
      setStatus("PENDING");
      setPaymentStatus("BELUM_BAYAR");
      setPipelineStage(null);
      setQuantity("1");
      setMerkKasur("");
      setUkuran("");
      setDeliveryCity("");
      setDeliveryAddress("");
      setHealthStatus("");
      setComplaintCategory([]);
      setOngkir("");
      setOngkirKlaimGaransi("");
      setPickupEstimate("");
      setPickupConfirmedDate("");
      setLocationUrl("");
      setKeluhan("");
      setPromoId("");
      setHargaTotal("");
      setItems([newItem()]);
      setWeightEntries([newWeightEntry()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, order]);

  const q = search.trim().toLowerCase();
  const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;

  function pickProduct(p) {
    setSelectedProductId(p.id);
    setItems((prev) => {
      const [first, ...rest] = prev.length > 0 ? prev : [newItem()];
      return [{ ...first, layananName: p.name, harga: p.price ? String(p.price) : "" }, ...rest];
    });
  }

  function addItem() { setItems((p) => [...p, newItem()]); }
  function removeItem(key) { setItems((p) => (p.length > 1 ? p.filter((it) => it.key !== key) : p)); }
  function setItemField(key, field, val) {
    setItems((p) => p.map((it) => (it.key === key ? { ...it, [field]: val } : it)));
  }

  function addWeight() { setWeightEntries((p) => [...p, newWeightEntry()]); }
  function removeWeight(key) { setWeightEntries((p) => (p.length > 1 ? p.filter((e) => e.key !== key) : p)); }
  function setWeightField(key, field, val) {
    setWeightEntries((p) => p.map((e) => (e.key === key ? { ...e, [field]: val } : e)));
  }

  const totalItems = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);

  async function handleCreate() {
    const validItems = items.filter((it) => it.layananName?.trim());
    if (isLayanan && validItems.length === 0) {
      Alert.alert("Tambahkan minimal satu layanan");
      return;
    }
    const created = await api.addOrder(customerId, {
      category,
      quantity: Number(quantity) || 1,
      notes: buildNotes({ merkKasur: isLayanan ? merkKasur : "Sano", ukuranKasur: ukuran, keluhanCustomer: keluhan }),
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

    const createdItems = [];
    let finalOrderValue = 0;
    if (isLayanan) {
      for (const it of validItems) {
        const { item, orderValue } = await api.addOrderItem(created.id, { layananName: it.layananName.trim(), harga: Number(it.harga) || 0 });
        createdItems.push(item);
        finalOrderValue = orderValue;
      }
    } else {
      const harga = Number(hargaTotal) || 0;
      if (harga > 0) {
        const namaLayanan = category === "BARU" ? "Kasur Baru" : "Kasur Sewa";
        const { item, orderValue } = await api.addOrderItem(created.id, { layananName: namaLayanan, harga });
        createdItems.push(item);
        finalOrderValue = orderValue;
      }
    }

    const createdWeights = [];
    const validWeights = weightEntries.filter((e) => e.label?.trim() && e.beratKg);
    for (let i = 0; i < validWeights.length; i++) {
      const e = validWeights[i];
      const entry = await api.addWeightEntry(created.id, { label: e.label.trim(), beratKg: Number(e.beratKg), sortOrder: i });
      createdWeights.push(entry);
    }

    onCreated?.({ ...created, value: finalOrderValue, items: createdItems, weightEntries: createdWeights });
  }

  // Edit — PATCH status+notes, lalu diff items/weightEntries terhadap
  // koleksi ASLI order (bukan terhadap apa yang ada di state saat ini),
  // pola SAMA persis dengan OrderCard.js#handleSave (yang lama) supaya baris
  // yang dihapus di form beneran ke-DELETE di server, bukan cuma hilang dari
  // tampilan lokal.
  async function handleEditSave() {
    const finalMerk = isLayanan ? merkKasur : "Sano";
    await api.updateOrder(order.id, {
      status,
      paymentStatus,
      quantity: Number(quantity) || 1,
      notes: buildNotes({ merkKasur: finalMerk, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
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

    const existingWeightIds = (order.weightEntries || []).map((e) => e.id);
    const currentWeightIds = weightEntries.filter((e) => e.id).map((e) => e.id);
    for (const id of existingWeightIds) {
      if (!currentWeightIds.includes(id)) await api.deleteWeightEntry(id);
    }
    for (const e of weightEntries.filter((e) => e.id)) {
      if (e.label?.trim() && e.beratKg) await api.updateWeightEntry(e.id, { label: e.label.trim(), beratKg: Number(e.beratKg) });
    }
    for (let i = 0; i < weightEntries.length; i++) {
      const e = weightEntries[i];
      if (!e.id && e.label?.trim() && e.beratKg) await api.addWeightEntry(order.id, { label: e.label.trim(), beratKg: Number(e.beratKg), sortOrder: i });
    }

    if (isLayanan) {
      const existingItemIds = (order.items || []).map((it) => it.id);
      const currentItemIds = items.filter((it) => it.id).map((it) => it.id);
      for (const id of existingItemIds) {
        if (!currentItemIds.includes(id)) await api.deleteOrderItem(id);
      }
      for (const it of items.filter((it) => it.id)) {
        if (it.layananName?.trim()) await api.updateOrderItem(it.id, { layananName: it.layananName.trim(), harga: Number(it.harga) || 0 });
      }
      for (const it of items.filter((it) => !it.id)) {
        if (it.layananName?.trim()) await api.addOrderItem(order.id, { layananName: it.layananName.trim(), harga: Number(it.harga) || 0 });
      }
    } else {
      // BARU/SEWA: "harga" order = 1 OrderItem tunggal tersembunyi (lihat
      // handleCreate) — bukan array items yang di-render, jadi diff-nya beda
      // sendiri: update item yang sudah ada, atau bikin baru kalau order ini
      // sebelumnya dibuat tanpa harga sama sekali (hargaTotal 0 saat create).
      const harga = Number(hargaTotal) || 0;
      const existingItem = (order.items || [])[0];
      if (existingItem) {
        await api.updateOrderItem(existingItem.id, { layananName: existingItem.layananName, harga });
      } else if (harga > 0) {
        const namaLayanan = category === "BARU" ? "Kasur Baru" : "Kasur Sewa";
        await api.addOrderItem(order.id, { layananName: namaLayanan, harga });
      }
    }

    onUpdated?.();
  }

  // Tahap Pipeline milik Customer, BUKAN Order (sama seperti web
  // Orders.jsx#handleStageChange) — disimpan LANGSUNG saat dipilih (optimistic
  // + rollback kalau gagal), TIDAK ikut menunggu tombol "Simpan Order" di
  // bawah, karena field ini secara semantik terpisah dari data order itu
  // sendiri.
  async function handleStageChange(newStage) {
    if (newStage === pipelineStage || !customerId || savingStage) return;
    const prev = pipelineStage;
    setPipelineStage(newStage);
    setSavingStage(true);
    try {
      await api.updateCustomer(customerId, { pipelineStage: newStage });
      onUpdated?.();
    } catch (err) {
      setPipelineStage(prev);
      Alert.alert("Gagal ubah tahap pipeline", err.message);
    } finally {
      setSavingStage(false);
    }
  }

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    try {
      if (isEdit) {
        await handleEditSave();
      } else {
        await handleCreate();
      }
      onClose();
    } catch (err) {
      Alert.alert(isEdit ? "Gagal simpan order" : "Gagal buat order", err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!order) return;
    Alert.alert("Hapus order ini?", "Semua item & data terkait juga akan dihapus.", [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus", style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deleteOrder(order.id);
            onDeleted?.(order.id);
            onClose();
          } catch (err) {
            Alert.alert("Gagal hapus order", err.message);
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      {/* BUG (fix 21 Agt 2026): form ini banyak TextInput (Berat Badan,
          Keluhan, Ongkir, Alamat Kirim, Harga Total, Layanan) di dalam RN
          <Modal> — Modal Android SELALU bikin native Dialog/Window terpisah
          dari Activity, TIDAK PERNAH ikut windowSoftInputMode=adjustResize
          Activity-nya sama sekali (limitasi RN, bukan hal baru).
          Versi SEBELUM fix ini cuma mengecilkan `maxHeight` modal (tinggi
          layar dikurangi tinggi keyboard) TANPA memindahkan posisinya —
          TERNYATA TIDAK CUKUP: overlay di bawah pakai `justifyContent:
          "flex-end"`, jadi sheet tetap MENEMPEL DI DASAR LAYAR walau
          tingginya sudah dikecilkan, alias tetap di belakang keyboard
          persis seperti sebelum "diperbaiki". Field baru yang ditambahkan
          belakangan (D-027/D-028/D-029/D-033) ikut kena karena menambah
          field ke form yang sudah salah pola ini.
          Fix yang BENAR (sudah terbukti di ChatBaruModal.js/ForwardModal.js/
          dst — lihat lib/useSheetMaxHeight.js): `overlayStyle` di bawah
          MENDORONG sheet naik lewat paddingBottom pada overlay flex-end,
          BUKAN cuma mengecilkan tinggi. Keduanya (posisi + tinggi) wajib
          jalan bersama. */}
      <View style={[styles.overlay, overlayStyle]}>
        <View style={[styles.modal, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{isEdit ? "Edit Order" : "Order Baru"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              {isEdit && (
                <TouchableOpacity onPress={handleDelete} disabled={saving || deleting}>
                  <Trash2 size={19} color={tokens.color.danger} strokeWidth={2.2} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} disabled={saving || deleting}>
                <X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
          </View>

          {locked && (
            <View style={styles.lockedBanner}>
              <Text style={styles.lockedBannerText}>
                Order ini sudah LUNAS — cuma admin/sales yang bisa mengedit. Kalau pelanggan
                minta revisi, tandai lewat "Ajukan Revisi" di profilnya.
              </Text>
            </View>
          )}

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: "100%" }}>
            {/* Status — HANYA di mode edit (cek AddOrderForm web: form create
                juga tidak punya field status, order baru selalu PENDING dari
                backend; status baru relevan setelah order ada, sama seperti
                OrderDetail edit mode web). */}
            {isEdit && (
              <>
                <Text style={styles.label}>Status</Text>
                <View style={styles.statusRow}>
                  {ORDER_STATUSES.map((s) => {
                    const active = status === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.statusChip, active && styles.categoryChipActive]}
                        onPress={() => setStatus(s)}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]} numberOfLines={1}>
                          {ORDER_STATUS_LABELS[s] || s}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* FITUR (tambahan): Status Pembayaran — sebelumnya cuma bisa
                    diubah dari CRM web (OrderSection.jsx), mobile hanya bisa
                    MELIHAT badge-nya, tidak bisa mengedit sama sekali. */}
                <Text style={styles.label}>Status Pembayaran</Text>
                <View style={styles.statusRow}>
                  {PAYMENT_STATUSES.map((s) => {
                    const active = paymentStatus === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.statusChip, active && styles.categoryChipActive]}
                        onPress={() => setPaymentStatus(s)}
                      >
                        <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]} numberOfLines={1}>
                          {PAYMENT_STATUS_LABELS[s] || s}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* FITUR (tambahan): Tahap Pipeline — sebelumnya tab Order
                    (lintas pelanggan) tidak punya jalur ubah pipeline sama
                    sekali, order yang statusnya "Paid" harus ditandai lewat
                    CRM web dulu. Cuma muncul kalau order ini datang dari
                    OrdersScreen.js (bawa field pipelineStage denormalized) —
                    lihat showPipelineEditor di atas. Disimpan LANGSUNG saat
                    dipilih (lihat handleStageChange), bukan menunggu tombol
                    Simpan di bawah. */}
                {showPipelineEditor && (
                  <>
                    <Text style={styles.label}>Tahap Pipeline</Text>
                    <View style={styles.statusRow}>
                      {STAGE_ORDER.map((s) => {
                        const active = (pipelineStage || "NEW") === s;
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[
                              styles.statusChip,
                              active && { backgroundColor: stageColors[s] + "22", borderColor: stageColors[s] },
                            ]}
                            onPress={() => handleStageChange(s)}
                            disabled={savingStage}
                          >
                            <Text
                              style={[styles.categoryChipText, active && { color: stageColors[s], fontWeight: "700" }]}
                              numberOfLines={1}
                            >
                              {stageLabels[s] || s}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
              </>
            )}

            {/* Kategori — TIDAK BISA diubah setelah order dibuat (sama
                seperti web: AddOrderForm cuma tanya kategori di step 0,
                OrderDetail edit mode tidak punya kontrol ubah kategori sama
                sekali), jadi di-disable saat edit, cuma ditampilkan sebagai
                info. */}
            <Text style={styles.label}>Kategori</Text>
            <View style={styles.categoryRow}>
              {CATEGORY_OPTIONS.map((opt) => {
                const active = category === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.categoryChip, active && styles.categoryChipActive, isEdit && styles.categoryChipDisabled]}
                    onPress={() => !isEdit && setCategory(opt.value)}
                    disabled={isEdit}
                  >
                    <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Jumlah (quantity) — field baru, sebelumnya cuma tersimpan
                diam-diam sebagai default 1 di backend, tidak pernah bisa
                diubah dari form manapun. */}
            <Text style={styles.label}>Jumlah</Text>
            <View style={styles.quantityRow}>
              <TouchableOpacity
                style={styles.quantityBtn}
                onPress={() => setQuantity((q) => String(Math.max(1, (Number(q) || 1) - 1)))}
              >
                <Text style={styles.quantityBtnText}>−</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.quantityInput}
                value={quantity}
                onChangeText={(v) => setQuantity(v.replace(/[^0-9]/g, ""))}
                onBlur={() => setQuantity((q) => (Number(q) > 0 ? String(Number(q)) : "1"))}
                keyboardType="numeric"
                textAlign="center"
              />
              <TouchableOpacity
                style={styles.quantityBtn}
                onPress={() => setQuantity((q) => String((Number(q) || 1) + 1))}
              >
                <Text style={styles.quantityBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Produk cepat — hanya relevan utk Service/Upgrade */}
            {isLayanan && (
              <FlatList
                data={filtered}
                keyExtractor={(p) => p.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ maxHeight: 96, marginTop: 10 }}
                contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                ListHeaderComponent={
                  <TextInput
                    style={styles.productSearch}
                    placeholder="Cari produk…"
                    placeholderTextColor={tokens.color.textMuted}
                    value={search}
                    onChangeText={setSearch}
                  />
                }
                ListEmptyComponent={loadingProducts ? <ActivityIndicator color={tokens.color.accent} /> : null}
                renderItem={({ item: p }) => {
                  const active = selectedProductId === p.id;
                  const thumb = p.images?.[0]?.url;
                  return (
                    <TouchableOpacity
                      style={[styles.productCard, active && styles.productCardActive]}
                      onPress={() => pickProduct(p)}
                    >
                      {thumb ? (
                        <Image source={{ uri: mediaUrl(thumb) }} style={styles.productThumb} contentFit="cover" cachePolicy="memory-disk" />
                      ) : (
                        <View style={[styles.productThumb, styles.productThumbPlaceholder]}>
                          <Package size={16} color={tokens.color.textMuted} strokeWidth={1.8} />
                        </View>
                      )}
                      <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            )}

            {/* Berat Badan — multi-orang */}
            <Text style={styles.label}>Berat Badan</Text>
            {weightEntries.map((e) => (
              <View key={e.key} style={styles.weightRow}>
                <TextInput
                  style={[styles.input, { flex: 2 }]}
                  placeholder="cth: Suami / Istri / Sendiri"
                  placeholderTextColor={tokens.color.textMuted}
                  value={e.label}
                  onChangeText={(v) => setWeightField(e.key, "label", v)}
                />
                <TextInput
                  style={[styles.input, { flex: 1, marginLeft: 8 }]}
                  placeholder="kg"
                  placeholderTextColor={tokens.color.textMuted}
                  value={e.beratKg}
                  onChangeText={(v) => setWeightField(e.key, "beratKg", v)}
                  keyboardType="numeric"
                />
                {weightEntries.length > 1 && (
                  <TouchableOpacity onPress={() => removeWeight(e.key)} style={styles.removeBtn}>
                    <X size={16} color={tokens.color.danger} strokeWidth={2.2} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity onPress={addWeight}><Text style={styles.linkText}>+ Tambah Orang</Text></TouchableOpacity>

            {/* Merk Kasur */}
            <Text style={styles.label}>Merk Kasur</Text>
            {isLayanan ? (
              <TouchableOpacity style={styles.selectBox} onPress={() => setShowMerkPicker(true)}>
                <Text style={styles.selectBoxText}>{merkKasur || "— Pilih Merk —"}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.forcedSano}>Sano ✓</Text>
            )}

            {/* Ukuran Kasur */}
            <Text style={styles.label}>Ukuran Kasur</Text>
            <TouchableOpacity style={styles.selectBox} onPress={() => setShowUkuranPicker(true)}>
              <Text style={styles.selectBoxText}>{ukuran || "— Pilih Ukuran —"}</Text>
            </TouchableOpacity>

            {/* Kota + Alamat pengiriman (D-027) — TERPISAH dari Customer.city,
                1 customer bisa order untuk alamat berbeda-beda. */}
            <Text style={styles.label}>Kota</Text>
            <TouchableOpacity style={styles.selectBox} onPress={() => setShowKotaPicker(true)}>
              <Text style={styles.selectBoxText}>{deliveryCity || "— Pilih Kota —"}</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Alamat</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Alamat lengkap pengiriman…"
              placeholderTextColor={tokens.color.textMuted}
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
              multiline
            />

            {/* Kondisi Kesehatan + kategori keluhan (D-028) — multi-pilih,
                dipakai mengklasifikasi jenis keluhan sakit customer klinik
                matras. Kategori cuma muncul kalau Sakit dipilih. */}
            <Text style={styles.label}>Kondisi Kesehatan</Text>
            <View style={styles.categoryRow}>
              {[
                { value: "SAKIT", label: "Sakit", color: tokens.color.danger },
                { value: "TIDAK_SAKIT", label: "Tidak Sakit", color: tokens.color.success },
              ].map(({ value, label, color }) => {
                const active = healthStatus === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.categoryChip,
                      active && { backgroundColor: color + "22", borderColor: color },
                    ]}
                    onPress={() => setHealthStatus((prev) => (prev === value ? "" : value))}
                  >
                    <Text style={[styles.categoryChipText, active && { color, fontWeight: "700" }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {healthStatus === "SAKIT" && (
              <View style={[styles.statusRow, { marginTop: 8 }]}>
                {HEALTH_COMPLAINT_OPTIONS.map((k) => {
                  const active = complaintCategory.includes(k);
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[
                        styles.statusChip,
                        active && { backgroundColor: tokens.color.danger + "22", borderColor: tokens.color.danger },
                      ]}
                      onPress={() => setComplaintCategory((prev) =>
                        prev.includes(k) ? prev.filter((v) => v !== k) : [...prev, k]
                      )}
                    >
                      <Text style={[styles.categoryChipText, active && { color: tokens.color.danger, fontWeight: "700" }]}>
                        {HEALTH_COMPLAINT_LABELS[k]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Promo (D-026) — opsional, cuma PENANDA untuk laporan, tidak
                menghitung ulang harga apa pun (harga tetap manual di bawah). */}
            <Text style={styles.label}>Promo (opsional)</Text>
            <TouchableOpacity style={styles.selectBox} onPress={() => setShowPromoPicker(true)}>
              <Text style={styles.selectBoxText}>
                {promoId
                  ? (() => {
                      const found = promos.find((p) => p.id === promoId);
                      if (found) return promoLabel(found);
                      if (order?.promo?.id === promoId) return `${promoLabel(order.promo)} (sudah berakhir)`;
                      return "Promo dipilih";
                    })()
                  : "Tanpa promo"}
              </Text>
            </TouchableOpacity>

            {/* Keluhan / Catatan */}
            <Text style={styles.label}>{isLayanan ? "Keluhan Customer" : "Catatan"}</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder={isLayanan ? "Jelaskan keluhan kasur…" : "Catatan order (opsional)…"}
              placeholderTextColor={tokens.color.textMuted}
              value={keluhan}
              onChangeText={setKeluhan}
              multiline
            />

            {/* D-029: Ongkir + estimasi pickup + link lokasi — supaya semua
                data yang selama ini diketik ulang manual sales ke grup WA
                tercatat di order-nya langsung. */}
            <View style={styles.weightRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Ongkir</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={tokens.color.textMuted}
                  value={ongkir}
                  onChangeText={setOngkir}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.label}>Ongkir Klaim Garansi</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={tokens.color.textMuted}
                  value={ongkirKlaimGaransi}
                  onChangeText={setOngkirKlaimGaransi}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={styles.label}>Estimasi Pick Up</Text>
            <TextInput
              style={styles.input}
              placeholder="cth: est 24/25 Agustus 2026"
              placeholderTextColor={tokens.color.textMuted}
              value={pickupEstimate}
              onChangeText={setPickupEstimate}
            />

            <Text style={styles.label}>Tanggal Pick Up Pasti</Text>
            {/* Kolom DateTime asli di database (bukan teks bebas seperti
                Estimasi di atas) — dulu diketik manual "YYYY-MM-DD", rawan
                salah nyata (kebiasaan nulis DD-MM-YYYY jadi tersimpan
                sebagai tanggal lain tanpa ketahuan). Web sudah pakai
                <input type="date">, ini menyamakan mobile ke pola yang
                sama lewat date picker native — lihat DateField.js. */}
            <DateField
              value={pickupConfirmedDate}
              onChange={setPickupConfirmedDate}
              placeholder="Diisi setelah jadwal dikunci"
            />

            {/* D-033: pasangan pengiriman — diisi begitu produksi hampir/sudah selesai. */}
            <Text style={styles.label}>Estimasi Kirim</Text>
            <TextInput
              style={styles.input}
              placeholder="cth: estimasi 25/26 Agustus 2026"
              placeholderTextColor={tokens.color.textMuted}
              value={deliveryEstimate}
              onChangeText={setDeliveryEstimate}
            />

            <Text style={styles.label}>Tanggal Kirim Pasti</Text>
            <DateField
              value={deliveryConfirmedDate}
              onChange={setDeliveryConfirmedDate}
              placeholder="Diisi setelah jadwal dikunci"
            />

            <Text style={styles.label}>Link Lokasi</Text>
            <TextInput
              style={styles.input}
              placeholder="https://maps.app.goo.gl/…"
              placeholderTextColor={tokens.color.textMuted}
              value={locationUrl}
              onChangeText={setLocationUrl}
              autoCapitalize="none"
            />

            {/* Harga Total — hanya BARU/SEWA */}
            {!isLayanan && (
              <>
                <Text style={styles.label}>Harga Total (Rp)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={tokens.color.textMuted}
                  value={hargaTotal}
                  onChangeText={setHargaTotal}
                  keyboardType="numeric"
                />
                {!!hargaTotal && <Text style={styles.previewValue}>{formatRupiah(Number(hargaTotal) || 0)}</Text>}
              </>
            )}

            {/* Layanan (add-ons) — hanya LAYANAN */}
            {isLayanan && (
              <>
                <Text style={styles.label}>Layanan (add-ons)</Text>
                {items.map((it) => (
                  <View key={it.key} style={styles.itemBlock}>
                    <View style={styles.itemRow}>
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Nama layanan…"
                        placeholderTextColor={tokens.color.textMuted}
                        value={it.layananName}
                        onChangeText={(v) => setItemField(it.key, "layananName", v)}
                      />
                      <TouchableOpacity style={styles.pickBtn} onPress={() => setLayananPickerTarget(it.key)}>
                        <Text style={styles.pickBtnText}>Pilih</Text>
                      </TouchableOpacity>
                      {items.length > 1 && (
                        <TouchableOpacity onPress={() => removeItem(it.key)} style={styles.removeBtn}>
                          <X size={16} color={tokens.color.danger} strokeWidth={2.2} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="Harga (Rp)"
                      placeholderTextColor={tokens.color.textMuted}
                      value={it.harga}
                      onChangeText={(v) => setItemField(it.key, "harga", v)}
                      keyboardType="numeric"
                    />
                  </View>
                ))}
                <TouchableOpacity onPress={addItem}><Text style={styles.linkText}>+ Tambah layanan lain</Text></TouchableOpacity>
                <Text style={styles.previewValue}>Total: {formatRupiah(totalItems)}</Text>
              </>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, (saving || locked) && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={saving || deleting || locked}
            >
              <Text style={styles.submitText}>{saving ? "Menyimpan…" : "Simpan Order"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      <PickerSheet
        visible={showMerkPicker}
        title="Pilih Merk Kasur"
        options={orderOptions.merkKasur}
        onSelect={setMerkKasur}
        onClose={() => setShowMerkPicker(false)}
      />
      <PickerSheet
        visible={showUkuranPicker}
        title="Pilih Ukuran Kasur"
        options={orderOptions.ukuranKasur}
        onSelect={setUkuran}
        onClose={() => setShowUkuranPicker(false)}
      />
      <PickerSheet
        visible={showKotaPicker}
        title="Pilih Kota"
        options={KOTA_LIST}
        onSelect={setDeliveryCity}
        onClose={() => setShowKotaPicker(false)}
      />
      <PickerSheet
        visible={!!layananPickerTarget}
        title="Pilih Jenis Layanan"
        options={orderOptions.jenisLayanan}
        onSelect={(v) => layananPickerTarget && setItemField(layananPickerTarget, "layananName", v)}
        onClose={() => setLayananPickerTarget(null)}
      />
      <PickerSheet
        visible={showPromoPicker}
        title="Pilih Promo"
        options={[{ id: "", name: "Tanpa promo", code: "" }, ...promos]}
        getKey={(p) => p.id || "none"}
        getLabel={(p) => (p.code ? promoLabel(p) : p.name)}
        onSelect={(p) => setPromoId(p.id)}
        onClose={() => setShowPromoPicker(false)}
      />
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  // maxHeight SENGAJA tidak diset statis di sini — selalu di-override lewat
  // inline style di render (sheetMaxHeight dari useSheetMaxHeight() di atas)
  // supaya modal mengecil proporsional tiap keyboard muncul. overlayStyle
  // (paddingBottom, ikut di-spread ke `overlay` saat render) yang mendorong
  // posisinya naik — dua-duanya wajib jalan bersama, lihat catatan di render.
  modal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 24 },
  lockedBanner: {
    marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: 10,
    backgroundColor: `${tokens.color.warning}22`, borderWidth: 1, borderColor: `${tokens.color.warning}55`,
  },
  lockedBannerText: { fontSize: 12.5, lineHeight: 18, color: tokens.color.textPrimary, fontWeight: "500" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  headerTitle: { fontWeight: "700", fontSize: 15, color: tokens.color.textPrimary },
  categoryRow: { flexDirection: "row", gap: 8 },
  categoryChip: {
    flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: tokens.radius.control,
    borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card,
  },
  categoryChipActive: { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent },
  categoryChipDisabled: { opacity: 0.55 },
  categoryChipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  categoryChipTextActive: { color: tokens.color.accent },
  // Status punya 6 opsi (vs 3 kategori) — beda dari categoryRow (3 chip
  // flex:1 rata kolom), di sini wrap ke baris baru supaya tidak kepotong di
  // layar sempit.
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusChip: {
    alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderRadius: tokens.radius.control,
    borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card,
  },
  quantityRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  quantityBtn: {
    width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card,
  },
  quantityBtnText: { fontSize: 18, fontWeight: "700", color: tokens.color.textPrimary },
  quantityInput: {
    width: 56, backgroundColor: tokens.color.subtle, borderRadius: 10, paddingVertical: 9,
    fontSize: 15, fontWeight: "600", color: tokens.color.textPrimary,
  },
  productSearch: {
    backgroundColor: tokens.color.subtle, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, color: tokens.color.textPrimary, width: 140, marginRight: 4,
  },
  productCard: {
    width: 76, alignItems: "center", padding: 6, borderRadius: 12,
    borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card,
  },
  productCardActive: { borderColor: tokens.color.accent, backgroundColor: tokens.color.accentSoft },
  productThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: tokens.color.subtle },
  productThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  productName: { fontSize: 10, color: tokens.color.textSecondary, marginTop: 4, textAlign: "center" },
  label: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, color: tokens.color.textPrimary,
  },
  textarea: { minHeight: 60, textAlignVertical: "top" },
  selectBox: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  selectBoxText: { fontSize: 14, color: tokens.color.textPrimary },
  forcedSano: { fontSize: 14, fontWeight: "700", color: tokens.color.success, paddingVertical: 6 },
  weightRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  itemBlock: { marginBottom: 10 },
  itemRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  pickBtn: {
    backgroundColor: tokens.color.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9,
  },
  pickBtnText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent },
  removeBtn: { marginLeft: 8, padding: 4 },
  linkText: { fontSize: 12, color: tokens.color.accent, fontWeight: "600", marginTop: 4 },
  previewValue: { fontSize: 13, fontWeight: "700", color: tokens.color.success, marginTop: 8 },
  submitBtn: {
    backgroundColor: tokens.color.accent, borderRadius: 14, paddingVertical: 12,
    alignItems: "center", marginTop: 20, marginBottom: 4,
  },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70%" },
  pickerTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  pickerItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  pickerItemText: { fontSize: 14, color: tokens.color.textPrimary },
  });
}
