// Form tambah order dari HP — struktur field SAMA dengan AddOrderForm web
// (frontend/src/components/customer/OrderSection.jsx): Kategori, Berat
// Badan (multi-orang), Merk Kasur, Ukuran Kasur, Keluhan/Catatan, Harga
// Total (BARU/SEWA) atau daftar Layanan add-ons (LAYANAN). Field bertumpuk
// vertikal (bukan wizard multi-step ala web) — layar HP lebih sempit,
// semua muat lewat 1 ScrollView; dropdown pakai bottom-sheet picker
// (PickerSheet) konsisten dengan pola di CustomerProfileContent.js.
//
// Merk Kasur & Ukuran Kasur & Jenis Layanan (opsi) diambil dari
// GET /master-data/order-options — SATU sumber sama dengan web, bukan
// hardcode duplikat (lihat backend/src/constants/orderOptions.js).
//
// Endpoint dipakai (sama dengan web):
//   1. POST /customers/:id/orders        → shell order (category, notes)
//   2. POST /orders/:orderId/items       → baris layanan+harga (auto sync Order.value)
//   3. POST /orders/:orderId/weight-entries → baris berat badan per orang
// notes disimpan JSON {merkKasur, ukuranKasur, keluhanCustomer} — format
// SAMA persis dengan buildNotes()/parseNotes() di OrderSection.jsx web,
// supaya order dari mobile tampil benar juga di CRM web (dan sebaliknya).
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert, ScrollView,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Package, X } from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { useTokens } from "../constants/theme";
import { formatRupiah } from "../utils/format";
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

export default function OrderFormModal({ visible, customerId, onClose, onCreated, orderOptions: orderOptionsProp }) {
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
  const [merkKasur, setMerkKasur] = useState("");
  const [ukuran, setUkuran] = useState("");
  const [keluhan, setKeluhan] = useState("");
  const [hargaTotal, setHargaTotal] = useState("");
  const [items, setItems] = useState([newItem()]);
  const [weightEntries, setWeightEntries] = useState([newWeightEntry()]);
  const [saving, setSaving] = useState(false);

  const [showMerkPicker, setShowMerkPicker] = useState(false);
  const [showUkuranPicker, setShowUkuranPicker] = useState(false);
  const [layananPickerTarget, setLayananPickerTarget] = useState(null); // item key sedang dipilih

  const isLayanan = category === "LAYANAN";

  useEffect(() => {
    if (!visible) return;
    setLoadingProducts(true);
    setSearch("");
    setSelectedProductId(null);
    setCategory("LAYANAN");
    setMerkKasur("");
    setUkuran("");
    setKeluhan("");
    setHargaTotal("");
    setItems([newItem()]);
    setWeightEntries([newWeightEntry()]);
    api.getProducts().then(setProducts).catch(() => {}).finally(() => setLoadingProducts(false));
    if (!orderOptionsProp) api.getOrderOptions().then(setOrderOptionsState).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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

  async function handleSubmit() {
    if (saving) return;
    const validItems = items.filter((it) => it.layananName?.trim());
    if (isLayanan && validItems.length === 0) {
      Alert.alert("Tambahkan minimal satu layanan");
      return;
    }
    setSaving(true);
    try {
      const order = await api.addOrder(customerId, {
        category,
        notes: buildNotes({ merkKasur: isLayanan ? merkKasur : "Sano", ukuranKasur: ukuran, keluhanCustomer: keluhan }),
      });

      const createdItems = [];
      let finalOrderValue = 0;
      if (isLayanan) {
        for (const it of validItems) {
          const { item, orderValue } = await api.addOrderItem(order.id, { layananName: it.layananName.trim(), harga: Number(it.harga) || 0 });
          createdItems.push(item);
          finalOrderValue = orderValue;
        }
      } else {
        const harga = Number(hargaTotal) || 0;
        if (harga > 0) {
          const namaLayanan = category === "BARU" ? "Kasur Baru" : "Kasur Sewa";
          const { item, orderValue } = await api.addOrderItem(order.id, { layananName: namaLayanan, harga });
          createdItems.push(item);
          finalOrderValue = orderValue;
        }
      }

      const createdWeights = [];
      const validWeights = weightEntries.filter((e) => e.label?.trim() && e.beratKg);
      for (let i = 0; i < validWeights.length; i++) {
        const e = validWeights[i];
        const entry = await api.addWeightEntry(order.id, { label: e.label.trim(), beratKg: Number(e.beratKg), sortOrder: i });
        createdWeights.push(entry);
      }

      onCreated?.({ ...order, value: finalOrderValue, items: createdItems, weightEntries: createdWeights });
      onClose();
    } catch (err) {
      Alert.alert("Gagal buat order", err.message);
    } finally {
      setSaving(false);
    }
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
            <Text style={styles.headerTitle}>Order Baru</Text>
            <TouchableOpacity onPress={onClose} disabled={saving}>
              <X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: "100%" }}>
            {/* Kategori */}
            <Text style={styles.label}>Kategori</Text>
            <View style={styles.categoryRow}>
              {CATEGORY_OPTIONS.map((opt) => {
                const active = category === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                    onPress={() => setCategory(opt.value)}
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

            <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving}>
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
  categoryChipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  categoryChipTextActive: { color: tokens.color.accent },
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
