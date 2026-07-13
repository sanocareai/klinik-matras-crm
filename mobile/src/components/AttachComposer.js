// Tombol lampiran (+) → sheet pilih Foto/Video (galeri) | Kamera | Dokumen →
// modal preview (thumbnail + caption per file + toggle HD/Standar) → kirim.
// Pola SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/MediaUploader.jsx,
// kompresi "Standar" pakai expo-image-manipulator (API kontekstual baru
// SDK 57 — manipulateAsync versi lama sudah deprecated, lihat AGENTS.md).
import React, { useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert, ScrollView,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Plus, Image as ImageIcon, Camera, FileText, X, Video } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import PressableScale from "./PressableScale";

let uidCounter = 0;
function nextUid() { uidCounter += 1; return `att-${Date.now()}-${uidCounter}`; }

// uploadFile() (mobile/src/api.js, dipakai api.sendMedia) kadang GAGAL cuma
// di sisi respons — file sudah ke-upload penuh, WAHA sudah kirim ke
// WhatsApp, Message sudah tersimpan di backend, TAPI koneksi seluler lemah
// pas balasan JSON kecil terakhir balik ke HP, jadi client tetap terima
// error. Sebelum vonis "gagal" (yang akan bikin user tergoda pencet ulang
// → kirim dobel ke WhatsApp beneran), cek dulu riwayat pesan: kalau memang
// SUDAH ada pesan OUTBOUND media baru dalam beberapa detik terakhir, itu
// bukti sudah terkirim — anggap sukses.
async function findRecentlySentMedia(conversationId, sinceMs) {
  try {
    const msgs = await api.getMessages(conversationId);
    const cutoff = sinceMs - 3000; // toleransi jam server/klien sedikit meleset
    const candidates = msgs
      .filter((m) => m.direction === "OUTBOUND" && m.mediaType && new Date(m.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function fileNameFromUri(uri, fallbackExt) {
  const last = (uri || "").split("/").pop() || "";
  return last.includes(".") ? last : `file-${Date.now()}.${fallbackExt}`;
}

// Kompresi "Standar" — resize max width 1600 + JPEG quality 0.8, sama
// seperti compressImage() versi web (canvas). Gagal manipulasi → kirim asli.
async function compressImage(uri) {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: 1600 }).renderAsync();
    const result = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return result.uri;
  } catch {
    return uri;
  }
}

export default function AttachComposer({ conversationId, onSent }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [showSheet, setShowSheet] = useState(false);
  const [items, setItems] = useState([]);
  const [hd, setHd] = useState(false);
  const [sending, setSending] = useState(false);

  // mediaTypeOf: string tetap ("document") ATAU function per-asset (dari
  // ImagePicker, tiap asset punya field .type "image"|"video" sendiri).
  function addAssets(assets, mediaTypeOf) {
    const newItems = assets.map((a) => {
      const mediaType = typeof mediaTypeOf === "function" ? mediaTypeOf(a) : mediaTypeOf;
      return {
        uid: nextUid(),
        uri: a.uri,
        name: a.fileName || a.name || fileNameFromUri(a.uri, mediaType === "video" ? "mp4" : mediaType === "document" ? "bin" : "jpg"),
        type: a.mimeType || (mediaType === "video" ? "video/mp4" : mediaType === "document" ? "application/octet-stream" : "image/jpeg"),
        mediaType,
        caption: "",
        error: null,
      };
    });
    setItems((prev) => [...prev, ...newItems]);
  }

  async function pickFromGallery() {
    setShowSheet(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"], quality: 1, allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets, (a) => (a.type === "video" ? "video" : "image"));
  }

  async function pickFromCamera() {
    setShowSheet(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Kamera", "Izin kamera diperlukan untuk ambil foto");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets, (a) => (a.type === "video" ? "video" : "image"));
  }

  async function pickDocument() {
    setShowSheet(false);
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets, "document");
  }

  function removeItem(uid) {
    setItems((prev) => prev.filter((i) => i.uid !== uid));
  }
  function setCaption(uid, caption) {
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, caption } : i)));
  }
  function closePreview() {
    setItems([]);
  }

  async function handleSendAll() {
    setSending(true);
    const remaining = [];
    for (const item of items) {
      const startedAt = Date.now();
      try {
        let uri = item.uri;
        let type = item.type;
        let name = item.name;
        if (item.mediaType === "image" && !hd) {
          uri = await compressImage(uri);
          type = "image/jpeg";
          name = name.replace(/\.[^.]+$/, ".jpg");
        }
        const file = { uri, name, type };
        const sendAs = item.mediaType === "document" ? "document" : "media";
        const msg = await api.sendMedia(conversationId, file, item.caption.trim(), sendAs);
        onSent?.(msg);
      } catch (err) {
        const reconciled = await findRecentlySentMedia(conversationId, startedAt);
        if (reconciled) {
          onSent?.(reconciled); // sebenarnya sudah terkirim, cuma respons yang gagal sampai
        } else {
          remaining.push({ ...item, error: err.message });
        }
      }
    }
    setItems(remaining);
    setSending(false);
  }

  return (
    <>
      <PressableScale style={styles.attachBtn} onPress={() => setShowSheet(true)}>
        <Plus size={22} color={tokens.color.textSecondary} strokeWidth={2.2} />
      </PressableScale>

      {/* Sheet pilih sumber lampiran */}
      <Modal visible={showSheet} transparent animationType="fade" onRequestClose={() => setShowSheet(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSheet(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Lampirkan</Text>
            <TouchableOpacity style={styles.sheetItemRow} onPress={pickFromGallery}>
              <ImageIcon size={18} color={tokens.color.textPrimary} strokeWidth={1.8} style={styles.sheetItemIcon} />
              <Text style={styles.sheetItemText}>Foto / Video dari Galeri</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetItemRow} onPress={pickFromCamera}>
              <Camera size={18} color={tokens.color.textPrimary} strokeWidth={1.8} style={styles.sheetItemIcon} />
              <Text style={styles.sheetItemText}>Ambil Foto (Kamera)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetItemRow} onPress={pickDocument}>
              <FileText size={18} color={tokens.color.textPrimary} strokeWidth={1.8} style={styles.sheetItemIcon} />
              <Text style={styles.sheetItemText}>Dokumen</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal preview sebelum kirim */}
      <Modal visible={items.length > 0} transparent animationType="slide" onRequestClose={() => !sending && closePreview()}>
        <View style={styles.previewOverlay}>
          <View style={styles.previewModal}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewHeaderText}>{items.length} file dipilih</Text>
              <TouchableOpacity onPress={closePreview} disabled={sending}>
                <X size={18} color={tokens.color.textSecondary} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {items.map((item) => (
                <View key={item.uid} style={styles.previewItem}>
                  <View style={styles.previewThumbWrap}>
                    {item.mediaType === "image" ? (
                      <Image source={{ uri: item.uri }} style={styles.previewThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.previewThumb, styles.previewThumbIcon]}>
                        {item.mediaType === "video" ? (
                          <Video size={22} color={tokens.color.textSecondary} strokeWidth={1.8} />
                        ) : (
                          <FileText size={22} color={tokens.color.textSecondary} strokeWidth={1.8} />
                        )}
                      </View>
                    )}
                    {!sending && (
                      <TouchableOpacity style={styles.previewRemove} onPress={() => removeItem(item.uid)}>
                        <X size={11} color="#fff" strokeWidth={2.6} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={styles.previewCaption}
                    placeholder="Caption…"
                    placeholderTextColor={tokens.color.textMuted}
                    value={item.caption}
                    editable={!sending}
                    onChangeText={(t) => setCaption(item.uid, t)}
                  />
                  {item.error && <Text style={styles.previewError}>{item.error}</Text>}
                </View>
              ))}
            </ScrollView>
            <View style={styles.previewFooter}>
              <TouchableOpacity
                style={[styles.hdToggle, hd && styles.hdToggleActive]}
                onPress={() => setHd((v) => !v)}
                disabled={sending}
              >
                <Text style={[styles.hdToggleText, hd && styles.hdToggleTextActive]}>{hd ? "HD" : "Standar"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendAllBtn} onPress={handleSendAll} disabled={sending}>
                <Text style={styles.sendAllText}>{sending ? "Mengirim…" : `Kirim (${items.length})`}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  attachBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  attachIcon: { fontSize: 22, color: tokens.color.textSecondary },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 28,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  sheetItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  sheetItemRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  sheetItemIcon: { marginRight: 10 },
  sheetItemText: { fontSize: 15, color: tokens.color.textPrimary },
  previewOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  previewModal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16 },
  previewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  previewHeaderText: { fontWeight: "700", color: tokens.color.textPrimary },
  previewClose: { fontSize: 16, color: tokens.color.textSecondary, padding: 4 },
  previewItem: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  previewThumbWrap: { position: "relative" },
  previewThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: tokens.color.subtle },
  previewThumbIcon: { alignItems: "center", justifyContent: "center" },
  previewRemove: {
    position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: tokens.color.danger, alignItems: "center", justifyContent: "center",
  },
  previewRemoveText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  previewCaption: {
    flex: 1, backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, fontSize: 13, color: tokens.color.textPrimary,
  },
  previewError: { fontSize: 11, color: tokens.color.danger },
  previewFooter: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 10 },
  hdToggle: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: tokens.color.subtle },
  hdToggleActive: { backgroundColor: tokens.color.accentSoft },
  hdToggleText: { fontSize: 12, fontWeight: "700", color: tokens.color.textSecondary },
  hdToggleTextActive: { color: tokens.color.accent },
  sendAllBtn: { marginLeft: "auto", backgroundColor: tokens.color.accent, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  sendAllText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  });
}
