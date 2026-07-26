// Galeri Produk siap-kirim dari chat — gap yang diperbaiki (analisa fitur
// CRM web vs app, 26 Jul 2026): Inbox web sudah lama punya ini (cari produk
// → pilih foto → kirim dengan caption harga), tapi mobile HANYA bisa
// melampirkan foto dari galeri/kamera HP sendiri — sales tidak bisa
// mengirim katalog produk resmi dari HP tanpa keluar app dulu ke WhatsApp
// langsung. Kontrak API SAMA PERSIS dengan web (ProductPicker.jsx):
// POST /conversations/:id/send-product { productId, imageIds, includePrice }.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, FlatList, ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { X, Search, Package, Check, ChevronLeft, SendHorizonal } from "lucide-react-native";
import { api, mediaUrl } from "../api";
import { useTokens } from "../constants/theme";
import PressableScale from "./PressableScale";

const KATEGORI_ALL = "Semua";
const KATEGORI_OPTIONS = [KATEGORI_ALL, "Upgrade", "Garansi", "Servis", "Info", "Lainnya"];

function formatHarga(price, priceUnit) {
  if (!price) return null;
  const angka = `Rp${price.toLocaleString("id-ID")}`;
  return priceUnit ? `${priceUnit} ${angka}` : angka;
}

// Preview caption — SAMA PERSIS logikanya dengan web (termasuk *bold* nama
// produk memakai sintaks format WhatsApp asli, lihat frontend/src/utils/
// waFormat.jsx untuk penjelasan kenapa cuma 1 bintang, bukan **markdown**).
function previewCaption(product, includePrice) {
  if (!product) return "";
  let text = `*${product.name}*`;
  if (product.description) text += `\n${product.description}`;
  if (includePrice && product.price) {
    const harga = `Rp${product.price.toLocaleString("id-ID")}`;
    text += `\n\n💰 ${product.priceUnit ? `${product.priceUnit} ` : ""}${harga}`;
  }
  return text;
}

export default function ProductPicker({ visible, customerName, onClose, onSend, sending }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState(KATEGORI_ALL);
  const [selected, setSelected] = useState(null);
  const [checkedIds, setCheckedIds] = useState([]);
  const [includePrice, setIncludePrice] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api.getProducts().then(setProducts).catch(() => {}).finally(() => setLoading(false));
  }, [visible]);

  // Reset ke daftar (bukan detail produk terakhir) tiap kali sheet dibuka —
  // sama seperti perilaku AttachComposer sheet, tidak menyisakan state layar
  // sebelumnya yang membingungkan.
  useEffect(() => {
    if (visible) { setSelected(null); setSearch(""); setKategori(KATEGORI_ALL); }
  }, [visible]);

  function selectProduct(p) {
    setSelected(p);
    setCheckedIds((p.images || []).map((i) => i.id));
  }

  function toggleImage(imageId) {
    setCheckedIds((prev) => (prev.includes(imageId) ? prev.filter((id) => id !== imageId) : [...prev, imageId]));
  }

  function toggleAll() {
    if (!selected) return;
    const allIds = (selected.images || []).map((i) => i.id);
    setCheckedIds(checkedIds.length === allIds.length ? [] : allIds);
  }

  function handleSend() {
    if (!selected || !checkedIds.length) return;
    onSend({ productId: selected.id, imageIds: checkedIds, includePrice });
  }

  const filtered = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchKat = kategori === KATEGORI_ALL || p.category === kategori;
    return matchSearch && matchKat;
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          {selected ? (
            <PressableScale style={styles.headerBtn} onPress={() => setSelected(null)}>
              <ChevronLeft size={18} color={tokens.color.textPrimary} strokeWidth={2} />
            </PressableScale>
          ) : <View style={styles.headerBtn} />}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {selected ? selected.name : "Galeri Produk"}
          </Text>
          <PressableScale style={styles.headerBtn} onPress={onClose}>
            <X size={18} color={tokens.color.textPrimary} strokeWidth={2} />
          </PressableScale>
        </View>

        {!selected ? (
          <>
            <View style={styles.searchWrap}>
              <Search size={16} color={tokens.color.textMuted} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                placeholder="Cari produk…"
                placeholderTextColor={tokens.color.textMuted}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.katWrap} contentContainerStyle={styles.katContent}>
              {KATEGORI_OPTIONS.map((k) => {
                const active = kategori === k;
                return (
                  <PressableScale
                    key={k}
                    style={[styles.katChip, active && { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent }]}
                    onPress={() => setKategori(k)}
                  >
                    <Text style={[styles.katChipText, active && { color: tokens.color.accent }]}>{k}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>

            {loading ? (
              <Text style={styles.emptyText}>Memuat produk…</Text>
            ) : filtered.length === 0 ? (
              <Text style={styles.emptyText}>Tidak ada produk ditemukan.</Text>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                renderItem={({ item: p }) => {
                  const thumb = p.images?.[0];
                  const harga = formatHarga(p.price, p.priceUnit);
                  return (
                    <TouchableOpacity style={styles.productRow} onPress={() => selectProduct(p)}>
                      <View style={styles.productThumb}>
                        {thumb ? (
                          <Image source={{ uri: mediaUrl(thumb.url) }} style={styles.productThumbImg} contentFit="cover" />
                        ) : (
                          <Package size={20} color={tokens.color.textMuted} strokeWidth={1.6} />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                        {harga && <Text style={styles.productPrice}>{harga}</Text>}
                        {p.description ? <Text style={styles.productDesc} numberOfLines={1}>{p.description}</Text> : null}
                      </View>
                      <Text style={styles.productCount}>{p.images?.length || 0} foto</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </>
        ) : (
          <View style={{ flex: 1 }}>
            {(!selected.images || selected.images.length === 0) ? (
              <Text style={styles.emptyText}>
                Produk ini belum punya foto.{"\n"}Upload foto lewat CRM web → Galeri Produk.
              </Text>
            ) : (
              <>
                <View style={styles.imagesHeader}>
                  <Text style={styles.imagesHeaderText}>{checkedIds.length}/{selected.images.length} foto dipilih</Text>
                  <PressableScale onPress={toggleAll}>
                    <Text style={styles.toggleAllText}>
                      {checkedIds.length === selected.images.length ? "Batal Semua" : "Pilih Semua"}
                    </Text>
                  </PressableScale>
                </View>
                <ScrollView contentContainerStyle={styles.imagesGrid}>
                  {selected.images.map((img) => {
                    const checked = checkedIds.includes(img.id);
                    return (
                      <TouchableOpacity key={img.id} style={styles.imageItem} onPress={() => toggleImage(img.id)}>
                        <Image source={{ uri: mediaUrl(img.url) }} style={[styles.imageItemImg, checked && styles.imageItemImgChecked]} contentFit="cover" />
                        <View style={[styles.imageCheck, checked && { backgroundColor: tokens.color.accent, borderColor: tokens.color.accent }]}>
                          {checked && <Check size={11} color="#fff" strokeWidth={3} />}
                        </View>
                        {img.label ? <Text style={styles.imageLabel} numberOfLines={1}>{img.label}</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <View style={styles.optionsRow}>
              <PressableScale style={styles.priceToggle} onPress={() => setIncludePrice((v) => !v)}>
                <View style={[styles.checkbox, includePrice && { backgroundColor: tokens.color.accent, borderColor: tokens.color.accent }]}>
                  {includePrice && <Check size={11} color="#fff" strokeWidth={3} />}
                </View>
                <Text style={styles.priceToggleText}>Sertakan harga</Text>
              </PressableScale>
            </View>

            <View style={styles.captionPreview}>
              <Text style={styles.captionLabel}>Preview caption (gambar terakhir):</Text>
              <Text style={styles.captionText}>{previewCaption(selected, includePrice)}</Text>
            </View>

            <PressableScale
              style={[styles.sendBtn, (sending || checkedIds.length === 0) && { opacity: 0.5 }]}
              onPress={handleSend}
              disabled={sending || checkedIds.length === 0}
            >
              <SendHorizonal size={14} color="#fff" strokeWidth={2.2} />
              <Text style={styles.sendBtnText}>
                {sending ? `Mengirim ${checkedIds.length} foto…` : `Kirim ke ${customerName || "pelanggan"} (${checkedIds.length} foto)`}
              </Text>
            </PressableScale>
          </View>
        )}
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
    searchWrap: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginHorizontal: 16, marginTop: 12, marginBottom: 8, backgroundColor: tokens.color.card,
      borderRadius: tokens.radius.pill, paddingHorizontal: 14, paddingVertical: 10, ...tokens.shadow.soft,
    },
    searchInput: { flex: 1, fontSize: 14, color: tokens.color.textPrimary },
    katWrap: { flexGrow: 0, marginBottom: 8 },
    katContent: { paddingHorizontal: 16, gap: 8 },
    katChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: tokens.radius.chip, backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border },
    katChipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
    emptyText: { textAlign: "center", color: tokens.color.textMuted, fontSize: 13, marginTop: 32, paddingHorizontal: 24 },
    productRow: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: tokens.color.card, borderRadius: 12, padding: 10, marginBottom: 8,
    },
    productThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: tokens.color.subtle, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    productThumbImg: { width: "100%", height: "100%" },
    productName: { fontSize: 13.5, fontWeight: "700", color: tokens.color.textPrimary },
    productPrice: { fontSize: 12, fontWeight: "700", color: tokens.color.success, marginTop: 1 },
    productDesc: { fontSize: 11, color: tokens.color.textMuted, marginTop: 1 },
    productCount: { fontSize: 10, color: tokens.color.textMuted },
    imagesHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    imagesHeaderText: { fontSize: 12, color: tokens.color.textMuted },
    toggleAllText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent },
    imagesGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
    imageItem: { width: "31%" },
    imageItemImg: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: tokens.color.subtle },
    imageItemImgChecked: { opacity: 0.6 },
    imageCheck: {
      position: "absolute", top: 6, right: 6, width: 20, height: 20, borderRadius: 10,
      borderWidth: 2, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.5)", alignItems: "center", justifyContent: "center",
    },
    imageLabel: { fontSize: 10, color: tokens.color.textMuted, marginTop: 2, textAlign: "center" },
    optionsRow: { paddingHorizontal: 16, paddingVertical: 8 },
    priceToggle: { flexDirection: "row", alignItems: "center", gap: 8 },
    checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: tokens.color.border, alignItems: "center", justifyContent: "center" },
    priceToggleText: { fontSize: 13, color: tokens.color.textPrimary },
    captionPreview: { marginHorizontal: 16, marginBottom: 10, padding: 10, backgroundColor: tokens.color.subtle, borderRadius: 10 },
    captionLabel: { fontSize: 10, color: tokens.color.textMuted, marginBottom: 4, textTransform: "uppercase", fontWeight: "700", letterSpacing: 0.3 },
    captionText: { fontSize: 12.5, color: tokens.color.textPrimary, lineHeight: 18 },
    sendBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      marginHorizontal: 16, marginBottom: 20, backgroundColor: tokens.color.accent, borderRadius: 14, paddingVertical: 13,
    },
    sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  });
}
