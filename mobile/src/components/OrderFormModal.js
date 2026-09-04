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
import { useQuery } from "@tanstack/react-query";
import { Package, X, Trash2, Layers, Tag, Plus } from "lucide-react-native";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTokens } from "../constants/theme";
import {
  formatRupiah, ORDER_STATUS_LABELS, orderStatusesForCategory, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES,
  PRODUCT_LINE_LABELS, PRODUCT_TYPE_LABELS, PRICE_ITEM_KIND_LABELS,
  jenisProdukOptions, resolveVariantKey,
} from "../utils/format";
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

// Label dilepas dari "Kasur" (29 Agustus 2026, paritas dgn web) — kategori
// ini sekarang lintas Lini Produk, bukan cuma kasur lagi.
const CATEGORY_OPTIONS = [
  { value: "LAYANAN", label: "Service/Upgrade" },
  { value: "BARU", label: "Baru" },
  { value: "SEWA", label: "Sewa" },
];

// Lini Produk (29 Agustus 2026, paritas dgn web) — semua kombinasi Kategori
// x Lini Produk valid (dikonfirmasi owner), tidak ada matriks pembatas.
const PRODUCT_LINE_OPTIONS = [
  { value: "KASUR", label: "Kasur" },
  { value: "SOFA", label: "Sofa" },
  { value: "DIVAN", label: "Divan" },
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

// priceItemId/variantKey/normalPrice/standardPrice/kind (29 Agustus 2026,
// paritas dgn web) — terisi kalau item dipilih dari katalog harga, tetap
// null kalau diketik bebas. Keduanya sama-sama sah.
function newItem(extra = {}) {
  return {
    key: String(Date.now()) + Math.random(), layananName: "", harga: "",
    priceItemId: null, variantKey: null, normalPrice: null, standardPrice: null, kind: null,
    ...extra,
  };
}

// Status harga final terhadap batas standard — dihitung saat render, TIDAK
// disimpan. SAMA PERSIS logikanya dgn hargaStatus() di web OrderSection.jsx.
// Penanda visual saja, BUKAN mengunci input — sales tetap bebas menembus
// batas, asal kelihatan di laporan (keputusan owner 29 Agustus 2026).
function hargaStatus(it, tokens) {
  const final = Number(it.harga);
  if (!it.harga || Number.isNaN(final) || final <= 0) return null;
  if (it.standardPrice == null) return null;
  if (final < it.standardPrice) {
    return { tone: "under", text: `Rp${(it.standardPrice - final).toLocaleString("id-ID")} di bawah standard`, color: tokens.color.danger };
  }
  if (it.normalPrice != null && final >= it.normalPrice) {
    return { tone: "full", text: "Harga normal penuh", color: tokens.color.success };
  }
  return { tone: "ok", text: "Dalam batas nego", color: tokens.color.accent };
}
function newWeightEntry() {
  return { key: String(Date.now()) + Math.random(), label: "", beratKg: "" };
}

// Kepala seksi — pemisah visual antar kelompok field (29 Agustus 2026,
// permintaan owner "UI-nya boring & flat sekali"). Form ini sebelumnya cuma
// tumpukan label+input tanpa hierarki sama sekali, jadi 20+ field terbaca
// seperti satu daftar panjang tanpa awal/akhir. Garis + ikon + judul kecil
// memberi jeda yang bikin mata tahu "bagian ini sudah beda urusan".
function SectionHead({ icon: Icon, title, tokens, styles }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadIcon}>
        <Icon size={13} color={tokens.color.accent} strokeWidth={2.4} />
      </View>
      <Text style={styles.sectionHeadText}>{title}</Text>
      <View style={styles.sectionHeadLine} />
    </View>
  );
}
function buildNotes({ merkKasur, ukuranKasur, keluhanCustomer, jenisKasurLainnya }) {
  return JSON.stringify({
    merkKasur: merkKasur || "", ukuranKasur: ukuranKasur || "", keluhanCustomer: keluhanCustomer || "",
    jenisKasurLainnya: jenisKasurLainnya || "",
  });
}
function parseNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "", jenisKasurLainnya: "" };
  try {
    const p = JSON.parse(notes);
    return {
      merkKasur: p.merkKasur || "", ukuranKasur: p.ukuranKasur || "", keluhanCustomer: p.keluhanCustomer || "",
      jenisKasurLainnya: p.jenisKasurLainnya || "",
    };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes, jenisKasurLainnya: "" };
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
  // Opsi form & promo aktif (29 Agustus 2026, migrasi ke react-query —
  // review performa sebelum EAS build) — SEBELUMNYA fetch manual di
  // useEffect setiap kali modal ini dibuka (dependency [visible, order]),
  // jadi setiap "+ Order" ditekan, request ini jalan ULANG dari nol walau
  // datanya nyaris tidak pernah berubah dalam 1 sesi kerja sales.
  // `enabled: visible` menjaga query tidak jalan sama sekali saat modal
  // tertutup; react-query sendiri yang memutuskan cache masih segar (skip
  // network) atau sudah basi (refetch diam-diam di background) — bukan
  // "selalu fetch" (lama) atau "cache selamanya" (salah arah lain), staleTime
  // yang menentukan proporsinya.
  // (Katalog produk/`api.getProducts` dulu di-fetch di sini juga, untuk
  // galeri "Produk cepat" — galeri itu dihapus 30 Agustus 2026, fiturnya
  // sebenarnya untuk berbagi foto produk di chat Inbox, bukan input order.)

  // orderOptions: opsional — kalau parent (CustomerProfileContent.js) sudah
  // fetch sekali & pakai ulang buat OrderCard.js juga, cukup dioper lewat
  // prop di sini supaya tidak dobel GET /master-data/order-options tiap
  // modal ini dibuka. Caller lama (belum dikasih prop ini) tetap jalan —
  // fallback fetch sendiri lewat react-query, `enabled` dimatikan kalau
  // prop sudah ada supaya tidak dobel-fetch data yang sama.
  const { data: orderOptionsFetched } = useQuery({
    queryKey: ["order-options"],
    queryFn: api.getOrderOptions,
    enabled: visible && !orderOptionsProp,
    staleTime: 5 * 60 * 1000,
  });
  const orderOptions = orderOptionsProp || orderOptionsFetched || { jenisLayanan: [], merkKasur: [], ukuranKasur: [] };

  const { data: promos = [] } = useQuery({
    queryKey: ["promos", "active"],
    queryFn: () => api.getPromos({ active: true }),
    enabled: visible,
    staleTime: 60 * 1000, // promo bisa mulai/berakhir lebih sering drpd katalog produk
  });
  const [category, setCategory] = useState("LAYANAN");
  // Lini Produk & Jenis Produk (29 Agustus 2026, paritas dgn web) — TIDAK
  // BISA diubah setelah order dibuat, sama seperti Kategori di atas (lihat
  // catatan disable di render).
  const [productLine, setProductLine] = useState("");
  const [productType, setProductType] = useState("");
  const [jenisKasurLainnya, setJenisKasurLainnya] = useState("");
  const [showJenisPicker, setShowJenisPicker] = useState(false);
  const isKasur = productLine === "KASUR";
  // usesUkuranDropdown (29 Agustus 2026, bug ditemukan & diperbaiki saat
  // review sebelum EAS build) — TERPISAH dari isKasur. Katalog harga Divan
  // (Service Divan/Sandaran, Divan, Sandaran) kunci variannya SAMA PERSIS
  // dgn Kasur (lebar 90-200), BUKAN free-text. Kalau Ukuran ikut digerbang
  // isKasur (seperti sebelumnya), resolveVariantKey() tidak akan pernah
  // cocok utk Divan, dan katalog harga Divan tidak akan pernah muncul —
  // fitur baru jadi mati utk satu lini produk penuh. Sofa TETAP free-text
  // (variant-nya dari Jenis Produk, bukan lebar).
  const usesUkuranDropdown = productLine === "KASUR" || productLine === "DIVAN";
  // Katalog harga (29 Agustus 2026) — dimuat begitu Lini Produk + varian
  // (ukuran utk Kasur/Divan, jenis produk utk Sofa) sudah diketahui.
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
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
  // Field "Jumlah" (Order.quantity) DIHAPUS dari form ini (29 Agustus 2026,
  // permintaan owner) — sudah tidak relevan sejak ada daftar "Layanan yang
  // diambil": banyaknya pekerjaan sekarang dinyatakan lewat baris layanan,
  // bukan satu angka global yang artinya kabur. Kolom quantity di database
  // TIDAK dihapus dan TIDAK ikut dikirim lagi dari sini: order baru memakai
  // default backend (1), order lama tetap memegang angkanya sendiri karena
  // PATCH hanya menyentuh field yang dikirim.
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
  const [items, setItems] = useState([newItem()]);
  const [weightEntries, setWeightEntries] = useState([newWeightEntry()]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // D-026 — promo cuma PENANDA (lihat catatan panjang di schema.prisma
  // model Promo), sama seperti web (OrderSection.jsx). `promos` (di-fetch
  // via react-query di atas) HANYA yang aktif (?active=true) — order lama
  // yang pakai kampanye yang sudah berakhir tetap menampilkan namanya dari
  // `order.promo` (di-include backend), tidak butuh daftar ini untuk itu,
  // lihat promoLabel di bawah.
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
    // orderOptions/promos TIDAK di-fetch di sini lagi — sudah ditangani
    // react-query di atas (`enabled: visible`), yang otomatis pakai cache
    // kalau masih segar, refetch diam-diam kalau sudah basi.

    if (order) {
      const info = parseNotes(order.notes);
      setCategory(order.category || "LAYANAN");
      // Fallback KASUR (29 Agustus 2026) — order lama sebelum kolom ini ada
      // memang selalu kasur (fakta historis, bukan tebakan), sama dgn
      // default skema Order.productLine di backend.
      setProductLine(order.productLine || "KASUR");
      setProductType(order.productType || "");
      setJenisKasurLainnya(info.jenisKasurLainnya || "");
      setStatus(order.status || "PENDING");
      setPaymentStatus(order.paymentStatus || "BELUM_BAYAR");
      setPipelineStage(order.pipelineStage ?? null);
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
      setProductLine("");
      setProductType("");
      setJenisKasurLainnya("");
      setCatalog([]);
      setStatus("PENDING");
      setPaymentStatus("BELUM_BAYAR");
      setPipelineStage(null);
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
      setItems([newItem()]);
      setWeightEntries([newWeightEntry()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, order]);

  const variantKey = resolveVariantKey({ productLine, productType, ukuran });
  // Dipakai di label/placeholder yang menyebut nama lini produk. Field yang
  // memakainya HANYA dirender setelah productLine dipilih (lihat gerbang
  // !productLine di render), jadi di sana nilainya tidak akan pernah kosong.
  const lineLabel = PRODUCT_LINE_LABELS[productLine] || "";

  // Muat katalog begitu Lini Produk + varian diketahui (29 Agustus 2026,
  // paritas dgn web). Kalau varian belum bisa ditentukan (mis. "Ukuran
  // Custom"), katalog SENGAJA tidak dimuat — isian manual yang benar.
  // `category` (30 Agustus 2026) memfilter kind yang relevan & dikirim ke
  // endpoint — SEBELUMNYA gerbang `isLayanan` di sini membuat katalog TIDAK
  // PERNAH dimuat sama sekali utk BARU/SEWA, padahal database sudah punya
  // baris PRODUCT (Matras Custom, Topper, Divan, Sandaran) & RENTAL (Kasur
  // Sewa) yang seharusnya bisa dipilih sama seperti Service/Upgrade.
  useEffect(() => {
    if (!visible || !productLine || !variantKey) { setCatalog([]); return; }
    let batal = false;
    setCatalogLoading(true);
    api.getPriceList(productLine, variantKey, category)
      .then((res) => { if (!batal) setCatalog(res.items || []); })
      .catch(() => { if (!batal) setCatalog([]); })
      .finally(() => { if (!batal) setCatalogLoading(false); });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, category, productLine, variantKey]);

  // Tambah layanan dari katalog. Harga final di-prefill HARGA NORMAL (harga
  // papan) — bukan standard (batas bawah nego) — sama alasan dgn web: kalau
  // standard yang jadi nilai awal, sales tidak pernah mulai menawar dari
  // harga penuh.
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
  const dipakaiDariKatalog = new Set(items.map((it) => it.priceItemId).filter(Boolean));

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
    if (validItems.length === 0) {
      Alert.alert(`Tambahkan minimal satu ${isLayanan ? "layanan" : "item"}`);
      return;
    }
    if (!productLine) {
      Alert.alert("Pilih Lini Produk dulu (Kasur/Sofa/Divan)");
      return;
    }
    const created = await api.addOrder(customerId, {
      category,
      productLine,
      productType: productType || undefined,
      notes: buildNotes({
        merkKasur: isLayanan ? merkKasur : "Sano", ukuranKasur: ukuran, keluhanCustomer: keluhan,
        jenisKasurLainnya: productType === "KASUR_LAINNYA" ? jenisKasurLainnya : "",
      }),
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

    // Item order (30 Agustus 2026) — items[] dipakai utk SEMUA kategori
    // sekarang, bukan cuma LAYANAN. BARU/SEWA dulu cuma kirim 1 OrderItem
    // tersembunyi dari "Harga Total" manual; sekarang bisa juga dipilih dari
    // katalog PRODUCT/RENTAL (lihat fetch katalog di atas), snapshot-nya
    // sama persis (priceItemId/variantKey/normalPrice/standardPrice/kind).
    const createdItems = [];
    let finalOrderValue = 0;
    for (const it of validItems) {
      const { item, orderValue } = await api.addOrderItem(created.id, {
        layananName: it.layananName.trim(),
        harga: Number(it.harga) || 0,
        priceItemId: it.priceItemId || undefined,
        variantKey: it.variantKey || undefined,
        normalPrice: it.normalPrice ?? undefined,
        standardPrice: it.standardPrice ?? undefined,
        kind: it.kind || undefined,
      });
      createdItems.push(item);
      finalOrderValue = orderValue;
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
      notes: buildNotes({ merkKasur: finalMerk, ukuranKasur: ukuran, keluhanCustomer: keluhan, jenisKasurLainnya }),
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

    // Diff items[] terhadap koleksi ASLI order — dipakai utk SEMUA kategori
    // sekarang (30 Agustus 2026), bukan cuma LAYANAN. Order BARU/SEWA lama
    // yang cuma punya 1 OrderItem tersembunyi dari "Harga Total" manual
    // tetap kebaca (prefill di atas memuat order.items apa adanya), cuma
    // sekarang bisa diedit/ditambah lewat katalog seperti LAYANAN.
    const existingItemIds = (order.items || []).map((it) => it.id);
    const currentItemIds = items.filter((it) => it.id).map((it) => it.id);
    for (const id of existingItemIds) {
      if (!currentItemIds.includes(id)) await api.deleteOrderItem(id);
    }
    for (const it of items.filter((it) => it.id)) {
      if (it.layananName?.trim()) await api.updateOrderItem(it.id, { layananName: it.layananName.trim(), harga: Number(it.harga) || 0 });
    }
    for (const it of items.filter((it) => !it.id)) {
      if (it.layananName?.trim()) {
        await api.addOrderItem(order.id, {
          layananName: it.layananName.trim(),
          harga: Number(it.harga) || 0,
          priceItemId: it.priceItemId || undefined,
          variantKey: it.variantKey || undefined,
          normalPrice: it.normalPrice ?? undefined,
          standardPrice: it.standardPrice ?? undefined,
          kind: it.kind || undefined,
        });
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
                  {/* Opsi dibatasi per kategori (4 Sep 2026) — BARU 3 tahap +
                      Dibatalkan, SEWA cuma Pengiriman/Pengambilan + Dibatalkan. */}
                  {orderStatusesForCategory(category).map((s) => {
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

            {/* Lini Produk (29 Agustus 2026, paritas dgn web) — TIDAK BISA
                diubah setelah order dibuat, sama alasan dgn Kategori di
                atas. Berlaku utk SEMUA kategori (termasuk Service/Upgrade —
                servis Sofa/Divan sekarang layanan baru juga, jangan
                diasumsikan kasur terus). */}
            <Text style={styles.label}>Lini Produk</Text>
            <View style={styles.categoryRow}>
              {PRODUCT_LINE_OPTIONS.map((opt) => {
                const active = productLine === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.categoryChip, active && styles.categoryChipActive, isEdit && styles.categoryChipDisabled]}
                    onPress={() => {
                      if (isEdit) return;
                      setProductLine(opt.value);
                      setProductType(opt.value === "DIVAN" ? "DIVAN_SANDARAN" : "");
                    }}
                    disabled={isEdit}
                  >
                    <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Jenis Produk — cuma utk Kasur/Sofa (Divan cuma 1 varian,
                auto-set di atas tanpa picker, lihat komentar PRODUCT_TYPES_BY_LINE
                di utils/format.js). */}
            {(productLine === "KASUR" || productLine === "SOFA") && (
              <>
                <Text style={styles.label}>Jenis Produk</Text>
                <TouchableOpacity
                  style={[styles.selectBox, isEdit && styles.categoryChipDisabled]}
                  onPress={() => !isEdit && setShowJenisPicker(true)}
                  disabled={isEdit}
                >
                  <Text style={styles.selectBoxText}>{PRODUCT_TYPE_LABELS[productType] || "— Pilih Jenis —"}</Text>
                </TouchableOpacity>
                {/* Jenis Kasur "Lainnya" (kategori BARU, 4 Sep 2026) —
                    free-text pelengkap, disimpan di Order.notes
                    (jenisKasurLainnya), paritas dgn web. */}
                {productType === "KASUR_LAINNYA" && (
                  <TextInput
                    style={styles.input}
                    value={jenisKasurLainnya}
                    onChangeText={setJenisKasurLainnya}
                    placeholder="Sebutkan jenis kasurnya (mis. Kasur Lipat)"
                    editable={!isEdit}
                  />
                )}
              </>
            )}

            {/* ── DETAIL PRODUK & LAYANAN ─────────────────────────────────
                Blok ini DINAIKKAN ke sini (29 Agustus 2026, permintaan
                owner) — tepat di bawah Lini/Jenis Produk, karena inilah inti
                ordernya. Ukuran IKUT naik & WAJIB di atas daftar harga: dia
                yang menentukan variantKey katalog, jadi mustahil menaruh
                daftar harga sebelum ukuran diketahui.

                Digerbang `productLine` (BUG DIPERBAIKI 29 Agustus 2026):
                sebelumnya, selama Lini Produk belum dipilih, form sudah
                terlanjur menampilkan varian Sofa/Divan (input bebas) dan
                labelnya jadi "Merk/Model " + placeholder berspasi ganda
                ("cth: merk  yang sudah...") karena PRODUCT_LINE_LABELS[""]
                undefined. Sekarang field yang bergantung lini produk baru
                muncul setelah lininya dipilih. */}
            {!productLine ? (
              <View style={styles.hintCard}>
                <Layers size={15} color={tokens.color.accent} strokeWidth={2.2} />
                <Text style={styles.hintCardText}>
                  Pilih Lini Produk dulu — detail produk, daftar harga, dan layanan
                  menyesuaikan pilihan itu.
                </Text>
              </View>
            ) : (
              <>
                <SectionHead icon={Package} title="Detail Produk" tokens={tokens} styles={styles} />

                {/* Merk — utk BARU/SEWA SELALU "Sano ✓" (produk kami sendiri,
                    apa pun lini produknya). Utk Service/Upgrade: dropdown
                    kurasi Settings KHUSUS Kasur; Sofa/Divan belum punya
                    daftar merk terkurasi, jadi input bebas menanyakan merk
                    EXISTING milik customer — paritas dgn web. */}
                <Text style={styles.label}>{isKasur ? "Merk Kasur" : `Merk/Model ${lineLabel}`}</Text>
                {!isLayanan ? (
                  <Text style={styles.forcedSano}>Sano ✓</Text>
                ) : isKasur ? (
                  <TouchableOpacity style={styles.selectBox} onPress={() => setShowMerkPicker(true)}>
                    <Text style={styles.selectBoxText}>{merkKasur || "— Pilih Merk —"}</Text>
                  </TouchableOpacity>
                ) : (
                  <TextInput
                    style={styles.input}
                    placeholder={`cth: merk ${lineLabel.toLowerCase()} yang sudah dimiliki customer`}
                    placeholderTextColor={tokens.color.textMuted}
                    value={merkKasur}
                    onChangeText={setMerkKasur}
                  />
                )}

                {/* Ukuran — dropdown lebar (90-200) utk Kasur DAN Divan
                    (variantKey katalog harga dua-duanya sama-sama lebar);
                    Sofa input bebas (variant-nya dari Jenis Produk). */}
                <Text style={styles.label}>
                  {usesUkuranDropdown
                    ? (isKasur ? "Ukuran Kasur" : `Ukuran ${lineLabel}`)
                    : `Ukuran/Konfigurasi ${lineLabel}`}
                </Text>
                {usesUkuranDropdown ? (
                  <TouchableOpacity style={styles.selectBox} onPress={() => setShowUkuranPicker(true)}>
                    <Text style={styles.selectBoxText}>{ukuran || "— Pilih Ukuran —"}</Text>
                  </TouchableOpacity>
                ) : (
                  <TextInput
                    style={styles.input}
                    placeholder="cth: 3 seater, abu-abu"
                    placeholderTextColor={tokens.color.textMuted}
                    value={ukuran}
                    onChangeText={setUkuran}
                  />
                )}

                {/* ── Katalog harga ───────────────────────────────────────
                    Muncul begitu Lini Produk + varian diketahui. Kalau
                    katalog kosong/gagal/varian belum bisa ditentukan
                    ("Ukuran Custom"), bagian ini disembunyikan dan form
                    kembali ke isian bebas — bukan error. Sejak 30 Agustus
                    2026 dipakai utk SEMUA kategori (dulu cuma LAYANAN) —
                    backend memfilter kind yang relevan lewat `category`. */}
                <SectionHead
                  icon={Tag}
                  title={isLayanan ? "Layanan & Harga" : category === "SEWA" ? "Sewa & Harga" : "Produk & Harga"}
                  tokens={tokens} styles={styles}
                />

                {catalogLoading && (
                      <View style={styles.catalogLoadingRow}>
                        <ActivityIndicator size="small" color={tokens.color.accent} />
                        <Text style={styles.catalogMuted}>Memuat daftar harga…</Text>
                      </View>
                    )}

                    {!catalogLoading && catalog.length > 0 && (
                      <>
                        <Text style={styles.subLabel}>
                          Dari daftar harga ({lineLabel}
                          {productLine === "SOFA"
                            ? ` · ${PRODUCT_TYPE_LABELS[productType] || "—"}`
                            : ` · ukuran ${variantKey}`})
                        </Text>
                        <ScrollView
                          style={styles.catalogBox}
                          nestedScrollEnabled
                          keyboardShouldPersistTaps="handled"
                        >
                          {catalog.map((p) => {
                            const sudah = dipakaiDariKatalog.has(p.id);
                            return (
                              <TouchableOpacity
                                key={p.id}
                                style={[styles.catalogRow, sudah && styles.catalogRowDisabled]}
                                onPress={() => !sudah && addFromCatalog(p)}
                                disabled={sudah}
                              >
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={styles.catalogName} numberOfLines={2}>{p.name}</Text>
                                  <Text style={styles.catalogKind}>
                                    {PRICE_ITEM_KIND_LABELS[p.kind] || p.kind}
                                    {sudah ? " · sudah ditambahkan" : ""}
                                  </Text>
                                </View>
                                <View style={{ alignItems: "flex-end" }}>
                                  {p.belumBerharga ? (
                                    <Text style={styles.catalogMuted}>harga belum diset</Text>
                                  ) : (
                                    <>
                                      {p.normalPrice != null && (
                                        <Text style={styles.catalogNormal}>{formatRupiah(p.normalPrice)}</Text>
                                      )}
                                      {p.standardPrice != null && (
                                        <Text style={styles.catalogStandard}>{formatRupiah(p.standardPrice)}</Text>
                                      )}
                                    </>
                                  )}
                                </View>
                                {!sudah && (
                                  <View style={styles.catalogAddBtn}>
                                    <Plus size={14} color={tokens.color.accent} strokeWidth={2.6} />
                                  </View>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </>
                    )}

                {/* ── Layanan yang diambil ────────────────────────────────
                    Tiap layanan jadi KARTU sendiri (bukan baris datar
                    seperti sebelumnya): nama + kategori di atas, lalu DUA
                    kotak referensi harga bersebelahan (Normal & Standard —
                    dua-duanya ditampilkan, muat di layar HP karena
                    angkanya dipendekkan & label-nya kecil), lalu input
                    Harga Final yang paling menonjol, lalu penanda posisi
                    nego. Ini jawaban "skema terbaik" utk pertanyaan owner:
                    normal & standard SAMA-SAMA tampil sebagai referensi
                    diam, harga final yang jadi bintangnya karena itu satu-
                    satunya yang diisi manusia. */}
                <Text style={styles.subLabel}>{isLayanan ? "Layanan yang diambil" : "Item yang diambil"}</Text>
                {items.map((it) => {
                      const st = hargaStatus(it, tokens);
                      const dariKatalog = !!it.priceItemId;
                      const adaReferensi = it.normalPrice != null || it.standardPrice != null;
                      return (
                        <View key={it.key} style={styles.svcCard}>
                          <View style={styles.svcHead}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              {dariKatalog ? (
                                <>
                                  <Text style={styles.svcName} numberOfLines={2}>{it.layananName}</Text>
                                  <Text style={styles.svcMeta}>
                                    {PRICE_ITEM_KIND_LABELS[it.kind] || "Layanan"} · dari daftar harga
                                  </Text>
                                </>
                              ) : (
                                <TextInput
                                  style={styles.svcNameInput}
                                  placeholder="Nama layanan…"
                                  placeholderTextColor={tokens.color.textMuted}
                                  value={it.layananName}
                                  onChangeText={(v) => setItemField(it.key, "layananName", v)}
                                />
                              )}
                            </View>
                            {!dariKatalog && (
                              <TouchableOpacity style={styles.pickBtn} onPress={() => setLayananPickerTarget(it.key)}>
                                <Text style={styles.pickBtnText}>Pilih</Text>
                              </TouchableOpacity>
                            )}
                            {items.length > 1 && (
                              <TouchableOpacity onPress={() => removeItem(it.key)} style={styles.removeBtn}>
                                <X size={16} color={tokens.color.danger} strokeWidth={2.2} />
                              </TouchableOpacity>
                            )}
                          </View>

                          {adaReferensi && (
                            <View style={styles.priceRefRow}>
                              <View style={styles.priceChip}>
                                <Text style={styles.priceChipLabel}>NORMAL</Text>
                                <Text style={styles.priceChipValue}>
                                  {it.normalPrice != null ? formatRupiah(it.normalPrice) : "—"}
                                </Text>
                              </View>
                              <View style={[styles.priceChip, styles.priceChipStd]}>
                                <Text style={[styles.priceChipLabel, styles.priceChipLabelStd]}>STANDARD</Text>
                                <Text style={[styles.priceChipValue, styles.priceChipValueStd]}>
                                  {it.standardPrice != null ? formatRupiah(it.standardPrice) : "—"}
                                </Text>
                              </View>
                            </View>
                          )}

                          <Text style={styles.svcFinalLabel}>Harga final</Text>
                          <TextInput
                            style={[
                              styles.svcFinalInput,
                              st?.tone === "under" && { borderColor: tokens.color.danger },
                            ]}
                            placeholder="0"
                            placeholderTextColor={tokens.color.textMuted}
                            value={it.harga}
                            onChangeText={(v) => setItemField(it.key, "harga", v)}
                            keyboardType="numeric"
                          />
                          {st && (
                            <View style={[styles.svcStatus, { backgroundColor: `${st.color}1f` }]}>
                              <Text style={[styles.svcStatusText, { color: st.color }]}>{st.text}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                <TouchableOpacity onPress={addItem}>
                  <Text style={styles.linkText}>+ Tambah {isLayanan ? "layanan" : "item"} di luar daftar harga</Text>
                </TouchableOpacity>
                <View style={styles.totalBar}>
                  <Text style={styles.totalBarLabel}>Total</Text>
                  <Text style={styles.totalBarValue}>{formatRupiah(totalItems)}</Text>
                </View>
              </>
            )}

            {/* Berat Badan — multi-orang. KHUSUS Kasur (fitting kekerasan
                by berat badan) — tidak relevan utk Sofa/Divan, paritas dgn
                web. */}
            {isKasur && (
              <>
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
              </>
            )}

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

            {/* "Harga Total" manual (BARU/SEWA) DIHAPUS 30 Agustus 2026 —
                digantikan katalog + items[] di atas (SectionHead "Produk &
                Harga"/"Sewa & Harga"), sama seperti LAYANAN. Order lama yang
                masih pakai 1 OrderItem tersembunyi dari field ini tetap
                kebaca & bisa diedit lewat "Item yang diambil" di atas. */}

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
        visible={showJenisPicker}
        title="Pilih Jenis Produk"
        options={jenisProdukOptions(productLine, category)}
        getKey={(v) => v}
        getLabel={(v) => PRODUCT_TYPE_LABELS[v] || v}
        onSelect={setProductType}
        onClose={() => setShowJenisPicker(false)}
      />
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
      {/* BUG DIPERBAIKI (4 Sep 2026, laporan owner — screenshot "Baru" tapi
          opsi yang tampil Upgrade/Full Service/Ganti Kain): options
          SEBELUMNYA selalu orderOptions.jenisLayanan (daftar statis
          LAYANAN-only dari GET /master-data/order-options, TIDAK terfilter
          kategori). `catalog` di sini SUDAH benar terfilter category lewat
          api.getPriceList() (lihat useEffect di atas). */}
      <PickerSheet
        visible={!!layananPickerTarget}
        title="Pilih Jenis Layanan"
        options={catalog.map((c) => c.name)}
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
  // ── Kepala seksi (pemisah visual antar kelompok field) ──
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22, marginBottom: 2 },
  sectionHeadIcon: {
    width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accentSoft,
  },
  sectionHeadText: {
    fontSize: 11.5, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase",
    color: tokens.color.textSecondary,
  },
  sectionHeadLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: tokens.color.border },
  subLabel: {
    fontSize: 11.5, fontWeight: "600", color: tokens.color.textMuted,
    marginTop: 14, marginBottom: 6,
  },
  // Kartu petunjuk saat Lini Produk belum dipilih
  hintCard: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16,
    padding: 14, borderRadius: 12, backgroundColor: tokens.color.accentSoft,
  },
  hintCardText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: tokens.color.textSecondary },
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
  // Katalog harga (29 Agustus 2026, paritas dgn web)
  catalogBox: {
    borderWidth: 1, borderColor: tokens.color.border, borderRadius: 12,
    maxHeight: 260, backgroundColor: tokens.color.card,
  },
  catalogRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  catalogRowDisabled: { opacity: 0.45 },
  catalogName: { fontSize: 13, fontWeight: "600", color: tokens.color.textPrimary },
  catalogKind: { fontSize: 10.5, color: tokens.color.textMuted, marginTop: 2 },
  catalogMuted: { fontSize: 10.5, color: tokens.color.textMuted },
  catalogNormal: { fontSize: 10.5, color: tokens.color.textMuted, textDecorationLine: "line-through" },
  catalogStandard: { fontSize: 12, fontWeight: "800", color: "#e07b1f", marginTop: 1 },
  catalogLoadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  catalogAddBtn: {
    width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accentSoft, marginLeft: 8,
  },

  // ── Kartu layanan yang diambil ──
  // Tiap layanan punya kartunya sendiri supaya 3 angka harga (normal /
  // standard / final) punya ruang yang terbaca di layar HP — versi datar
  // sebelumnya menempelkan semuanya jadi satu baris kecil yang sulit dipindai.
  svcCard: {
    backgroundColor: tokens.color.card, borderRadius: 14, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: tokens.color.border,
  },
  svcHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  svcName: { fontSize: 13.5, fontWeight: "700", color: tokens.color.textPrimary, lineHeight: 18 },
  svcMeta: { fontSize: 10.5, color: tokens.color.textMuted, marginTop: 2 },
  svcNameInput: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13.5, color: tokens.color.textPrimary,
  },
  priceRefRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  priceChip: { flex: 1, backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  priceChipStd: { backgroundColor: "#e07b1f1f" },
  priceChipLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6, color: tokens.color.textMuted },
  priceChipLabelStd: { color: "#e07b1f" },
  priceChipValue: { fontSize: 12.5, fontWeight: "700", color: tokens.color.textSecondary, marginTop: 2 },
  priceChipValueStd: { color: "#e07b1f" },
  svcFinalLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, color: tokens.color.textMuted, marginTop: 12, marginBottom: 5 },
  svcFinalInput: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary,
    borderWidth: 1.5, borderColor: "transparent",
  },
  svcStatus: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  svcStatusText: { fontSize: 10.5, fontWeight: "800" },
  totalBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: tokens.color.accentSoft, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 12,
  },
  totalBarLabel: { fontSize: 12.5, fontWeight: "700", color: tokens.color.textSecondary },
  totalBarValue: { fontSize: 16, fontWeight: "800", color: tokens.color.accent },
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
