// Tambah produk baru ke Galeri Produk langsung dari HP — gap yang
// diperbaiki (4 Agustus 2026): sebelumnya sales HANYA bisa MEMILIH produk
// dari galeri (ProductPicker.js) untuk dikirim ke chat, tidak bisa
// menambah produk sendiri sama sekali — baik di CRM web (dulu admin-only)
// maupun mobile (belum ada UI-nya sama sekali). Backend routes/products.js
// sekarang membolehkan semua user login membuat produk (POST /products),
// tapi edit/hapus tetap dibatasi HANYA ke pembuatnya sendiri atau admin.
//
// Kompresi foto pakai pola SAMA dengan AttachComposer.js (expo-image-
// manipulator, resize max width 1600 + JPEG 0.8) — backend TIDAK
// mengompres foto produk (beda dari avatar yang di-resize sharp di server).
import React, { useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Alert,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { X, Check, Package } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import PressableScale from "./PressableScale";

const KATEGORI_OPTIONS = ["Upgrade", "Matras Baru", "Garansi", "Servis", "Info", "Lainnya"];
const PRICE_UNIT_OPTIONS = [
  { value: "",             label: "Tidak ada" },
  { value: "mulai dari",   label: "Mulai dari" },
  { value: "per unit",     label: "Per unit" },
  { value: "per bulan",    label: "Per bulan" },
];

async function compressImage(uri) {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
    const result = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return result.uri;
  } catch {
    return uri;
  }
}

export default function AddProductModal({ visible, onClose, onCreated }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState("");
  const [photos, setPhotos] = useState([]); // [{ uri, type }]
  const [saving, setSaving] = useState(false);

  function reset() {
    setName(""); setDescription(""); setCategory(""); setPrice(""); setPriceUnit(""); setPhotos([]);
  }

  async function pickPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Izin diperlukan", "Aktifkan izin akses galeri untuk menambah foto produk.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 1, allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setPhotos((prev) => [
      ...prev,
      ...result.assets.map((a) => ({ uri: a.uri, type: a.mimeType || "image/jpeg" })),
    ]);
  }

  function removePhoto(idx) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!name.trim()) return Alert.alert("Nama produk wajib diisi");
    setSaving(true);
    try {
      const product = await api.createProduct({
        name: name.trim(),
        description: description.trim() || null,
        category: category || null,
        price: price ? parseInt(price, 10) : null,
        priceUnit: priceUnit || null,
      });

      // Upload foto SATU PER SATU (lihat catatan api.js#uploadProductImage) —
      // gagal di tengah jalan tidak membatalkan produk yang sudah dibuat,
      // sisa foto yang belum sempat ke-upload cukup ditambah lagi lewat
      // "Edit Produk" di CRM web, jadi tidak perlu rollback rumit di sini.
      let created = product;
      for (const p of photos) {
        try {
          const compressedUri = await compressImage(p.uri);
          const uploaded = await api.uploadProductImage(product.id, {
            uri: compressedUri, name: "produk.jpg", type: p.type,
          });
          created = { ...created, images: [...(created.images || []), ...uploaded] };
        } catch (err) {
          Alert.alert("Sebagian foto gagal diunggah", `${err.message}\n\nProduk tetap tersimpan — foto yang gagal bisa ditambah lagi lewat CRM web.`);
        }
      }

      onCreated(created);
      reset();
    } catch (err) {
      Alert.alert("Gagal membuat produk", err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerBtn} />
          <Text style={styles.headerTitle}>Tambah Produk</Text>
          <PressableScale style={styles.headerBtn} onPress={() => { reset(); onClose(); }}>
            <X size={18} color={tokens.color.textPrimary} strokeWidth={2} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Nama Produk *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Contoh: Upgrade Lapisan Matras"
            placeholderTextColor={tokens.color.textMuted}
          />

          <Text style={styles.label}>Deskripsi</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Deskripsi singkat produk / layanan..."
            placeholderTextColor={tokens.color.textMuted}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Kategori</Text>
          <View style={styles.chipRow}>
            {KATEGORI_OPTIONS.map((k) => {
              const active = category === k;
              return (
                <PressableScale
                  key={k}
                  style={[styles.chip, active && { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent }]}
                  onPress={() => setCategory(active ? "" : k)}
                >
                  <Text style={[styles.chipText, active && { color: tokens.color.accent }]}>{k}</Text>
                </PressableScale>
              );
            })}
          </View>

          <Text style={styles.label}>Harga (Rupiah)</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={(v) => setPrice(v.replace(/[^0-9]/g, ""))}
            placeholder="Contoh: 450000"
            placeholderTextColor={tokens.color.textMuted}
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Satuan Harga</Text>
          <View style={styles.chipRow}>
            {PRICE_UNIT_OPTIONS.map((o) => {
              const active = priceUnit === o.value;
              return (
                <PressableScale
                  key={o.value || "none"}
                  style={[styles.chip, active && { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent }]}
                  onPress={() => setPriceUnit(o.value)}
                >
                  <Text style={[styles.chipText, active && { color: tokens.color.accent }]}>{o.label}</Text>
                </PressableScale>
              );
            })}
          </View>

          <Text style={styles.label}>Foto Produk ({photos.length})</Text>
          <View style={styles.photoGrid}>
            {photos.map((p, idx) => (
              <View key={p.uri} style={styles.photoItem}>
                <Image source={{ uri: p.uri }} style={styles.photoItemImg} contentFit="cover" />
                <TouchableOpacity style={styles.photoRemove} onPress={() => removePhoto(idx)}>
                  <X size={11} color="#fff" strokeWidth={3} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.photoAdd} onPress={pickPhotos}>
              <Package size={18} color={tokens.color.textMuted} strokeWidth={1.6} />
              <Text style={styles.photoAddText}>Tambah{"\n"}Foto</Text>
            </TouchableOpacity>
          </View>

          <PressableScale
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Check size={14} color="#fff" strokeWidth={2.4} />
            <Text style={styles.saveBtnText}>{saving ? "Menyimpan..." : "Simpan Produk"}</Text>
          </PressableScale>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.color.bg, paddingTop: 50 },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    headerBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary },
    body: { padding: 16, paddingBottom: 40 },
    label: { fontSize: 12, fontWeight: "700", color: tokens.color.textSecondary, marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: tokens.color.card, borderRadius: 10, borderWidth: 1, borderColor: tokens.color.border,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: tokens.color.textPrimary,
    },
    textarea: { minHeight: 70, textAlignVertical: "top" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: tokens.radius.chip, backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border },
    chipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
    photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    photoItem: { width: 72, height: 72, borderRadius: 10, overflow: "hidden" },
    photoItemImg: { width: "100%", height: "100%" },
    photoRemove: {
      position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9,
      backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center",
    },
    photoAdd: {
      width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: tokens.color.border,
      alignItems: "center", justifyContent: "center", gap: 2,
    },
    photoAddText: { fontSize: 9.5, color: tokens.color.textMuted, textAlign: "center", lineHeight: 12 },
    saveBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      marginTop: 24, backgroundColor: tokens.color.accent, borderRadius: 14, paddingVertical: 13,
    },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  });
}
