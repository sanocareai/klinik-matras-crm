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
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Package, X, Trash2 } from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { useTokens } from "../constants/theme";
import { formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES } from "../utils/format";
import { useKeyboardHeight } from "../lib/useKeyboardHeight";

const CATEGORY_OPTIONS = [
  { value: "LAYANAN", label: "Service/Upgrade" },
  { value: "BARU", label: "Kasur Baru" },
  { value: "SEWA", label: "Kasur Sewa" },
];

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

// Bottom-sheet pilih 1 opsi dari daftar string — dipakai Merk Kasur, Ukuran
// Kasur, dan pilihan cepat Jenis Layanan per baris item.
function PickerSheet({ visible, title, options, onSelect, onClose }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(o) => o}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerItem} onPress={() => { onSelect(item); onClose(); }}>
                <Text style={styles.pickerItemText}>{item}</Text>
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
  const { height: screenHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
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
  const [merkKasur, setMerkKasur] = useState("");
  const [ukuran, setUkuran] = useState("");
  const [keluhan, setKeluhan] = useState("");
  const [hargaTotal, setHargaTotal] = useState("");
  const [items, setItems] = useState([newItem()]);
  const [weightEntries, setWeightEntries] = useState([newWeightEntry()]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showMerkPicker, setShowMerkPicker] = useState(false);
  const [showUkuranPicker, setShowUkuranPicker] = useState(false);
  const [layananPickerTarget, setLayananPickerTarget] = useState(null); // item key sedang dipilih

  const isEdit = !!order;
  const isLayanan = category === "LAYANAN";

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

    if (order) {
      const info = parseNotes(order.notes);
      setCategory(order.category || "LAYANAN");
      setStatus(order.status || "PENDING");
      setMerkKasur(info.merkKasur);
      setUkuran(info.ukuranKasur);
      setKeluhan(info.keluhanCustomer);
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
      setMerkKasur("");
      setUkuran("");
      setKeluhan("");
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
      notes: buildNotes({ merkKasur: isLayanan ? merkKasur : "Sano", ukuranKasur: ukuran, keluhanCustomer: keluhan }),
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
      notes: buildNotes({ merkKasur: finalMerk, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
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
      {/* BUG (fix): form ini banyak TextInput (Berat Badan, Keluhan, Harga
          Total, Layanan) di dalam RN <Modal> — Modal Android SELALU bikin
          native Dialog/Window terpisah dari Activity, TIDAK PERNAH ikut
          windowSoftInputMode=adjustResize Activity-nya sama sekali (limitasi
          RN, bukan hal baru). Percobaan sebelumnya (KeyboardAvoidingView
          behavior="height") masih tidak reliable dalam praktik — "height"
          tetap bergantung ke pengukuran layout yang bisa meleset di dalam
          Dialog window terpisah ini. Fix: hitung LANGSUNG maxHeight modal =
          88% tinggi layar DIKURANGI tinggi keyboard asli (dari
          useKeyboardHeight(), berbasis event Keyboard core RN yang tidak
          bergantung ke adjustResize sama sekali) — modal dipaksa mengecil
          proporsional deterministik tiap keyboard muncul, header (judul+X)
          selalu tetap kelihatan, ScrollView di dalamnya jadi lebih pendek
          jadi field yang lagi diisi (termasuk Catatan di bagian bawah form)
          bisa di-scroll ke atas keyboard alih-alih ketutup total. */}
      <View style={styles.overlay}>
        <View style={[styles.modal, { maxHeight: screenHeight * 0.88 - keyboardHeight }]}>
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

            <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving || deleting}>
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
        visible={!!layananPickerTarget}
        title="Pilih Jenis Layanan"
        options={orderOptions.jenisLayanan}
        onSelect={(v) => layananPickerTarget && setItemField(layananPickerTarget, "layananName", v)}
        onClose={() => setLayananPickerTarget(null)}
      />
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  // maxHeight SENGAJA tidak diset statis di sini — selalu di-override lewat
  // inline style di render (screenHeight * 0.88 - keyboardHeight, lihat
  // useKeyboardHeight() di atas) supaya modal mengecil proporsional tiap
  // keyboard muncul.
  modal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 24 },
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
