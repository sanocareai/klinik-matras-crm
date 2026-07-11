// Form tambah order cepat dari HP — pilih produk dari Galeri Produk
// (searchable, prefill nama+harga) ATAU ketik manual, qty, catatan.
// 2 panggilan endpoint existing (SAMA dengan web, lihat
// frontend/src/components/customer/OrderSection.jsx untuk versi lengkapnya):
//   1. POST /customers/:id/orders  → bikin shell order (quantity, notes)
//   2. POST /orders/:orderId/items → tambah 1 baris layanan+harga, otomatis
//      hitung ulang Order.value (backend#syncOrderValue)
// CATATAN: Product (Galeri Produk) TIDAK punya relasi DB ke Order/OrderItem
// — di sini cuma dipakai sebagai pemilih cepat utk prefill nama+harga,
// bukan referensi tersimpan (sama seperti send-product di chat).
import React, { useEffect, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert, Image,
} from "react-native";
import { Package, X } from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { tokens } from "../constants/theme";
import { formatRupiah } from "../utils/format";

export default function OrderFormModal({ visible, customerId, onClose, onCreated }) {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [layananName, setLayananName] = useState("");
  const [harga, setHarga] = useState("");
  const [qty, setQty] = useState("1");
  const [catatan, setCatatan] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoadingProducts(true);
    setSearch("");
    setSelectedProductId(null);
    setLayananName("");
    setHarga("");
    setQty("1");
    setCatatan("");
    api.getProducts().then(setProducts).catch(() => {}).finally(() => setLoadingProducts(false));
  }, [visible]);

  const q = search.trim().toLowerCase();
  const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;

  function pickProduct(p) {
    setSelectedProductId(p.id);
    setLayananName(p.name);
    setHarga(p.price ? String(p.price) : "");
  }

  async function handleSubmit() {
    if (!layananName.trim()) {
      Alert.alert("Nama layanan wajib diisi");
      return;
    }
    const hargaNum = Number(harga.replace(/\D/g, "")) || 0;
    if (saving) return;
    setSaving(true);
    try {
      const order = await api.addOrder(customerId, {
        quantity: Number(qty) || 1,
        category: "LAYANAN",
        notes: catatan.trim() || undefined,
      });
      const { item, orderValue } = await api.addOrderItem(order.id, {
        layananName: layananName.trim(),
        harga: hargaNum,
      });
      onCreated?.({ ...order, value: orderValue, items: [item] });
      onClose();
    } catch (err) {
      Alert.alert("Gagal buat order", err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Order Baru</Text>
            <TouchableOpacity onPress={onClose} disabled={saving}>
              <X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(p) => p.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: 96 }}
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
                    <Image source={{ uri: mediaUrl(thumb) }} style={styles.productThumb} />
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

          <Text style={styles.label}>Nama Layanan</Text>
          <TextInput
            style={styles.input}
            placeholder="Contoh: Upgrade Fondasi"
            placeholderTextColor={tokens.color.textMuted}
            value={layananName}
            onChangeText={setLayananName}
          />

          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Harga (Rp)</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={tokens.color.textMuted}
                value={harga}
                onChangeText={setHarga}
                keyboardType="numeric"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Qty</Text>
              <TextInput
                style={styles.input}
                value={qty}
                onChangeText={setQty}
                keyboardType="numeric"
              />
            </View>
          </View>

          {!!harga && <Text style={styles.previewValue}>{formatRupiah(Number(harga.replace(/\D/g, "")) || 0)}</Text>}

          <Text style={styles.label}>Catatan</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Catatan tambahan (opsional)…"
            placeholderTextColor={tokens.color.textMuted}
            value={catatan}
            onChangeText={setCatatan}
            multiline
          />

          <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={handleSubmit} disabled={saving}>
            <Text style={styles.submitText}>{saving ? "Menyimpan…" : "Simpan Order"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 24 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  headerTitle: { fontWeight: "700", fontSize: 15, color: tokens.color.textPrimary },
  closeText: { fontSize: 16, color: tokens.color.textSecondary, padding: 4 },
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
  label: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 14, color: tokens.color.textPrimary,
  },
  textarea: { minHeight: 60, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 10 },
  previewValue: { fontSize: 13, fontWeight: "700", color: tokens.color.success, marginTop: 6 },
  submitBtn: {
    backgroundColor: tokens.color.accent, borderRadius: 14, paddingVertical: 12,
    alignItems: "center", marginTop: 16,
  },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
