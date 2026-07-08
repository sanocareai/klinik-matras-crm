// Layar chat — bubble gaya WhatsApp, kirim teks/media, template balasan cepat,
// ubah status percakapan, dan Ambil Alih. Polling 5 detik.
// Grup: tampilkan senderName per pesan, input dinonaktifkan (backend menolak
// balas ke grup dari CRM).
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Image, Alert, ActivityIndicator, Modal,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api, mediaUrl } from "../api";
import { colors } from "../theme";
import { clockTime, dayLabel } from "../utils/format";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";

const POLL_MS = 5000;

const STATUS_OPTIONS = [
  { key: "OPEN", label: "🔵 Tandai Terbuka" },
  { key: "PENDING", label: "🟡 Tandai Pending" },
  { key: "RESOLVED", label: "✅ Tandai Selesai" },
];

// Nama file dari URI kalau picker tidak kasih nama
function fileNameFromUri(uri, fallbackExt) {
  const last = (uri || "").split("/").pop() || "";
  return last.includes(".") ? last : `file-${Date.now()}.${fallbackExt}`;
}

export default function ChatScreen({ route, navigation }) {
  const { conversationId, name, isGroup, customerId } = route.params;
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const listRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    try {
      const data = await api.getMessages(conversationId);
      setMessages(data);
    } catch (err) {
      if (!silent) Alert.alert("Gagal memuat pesan", err.message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [load]);

  // Template balasan cepat dimuat sekali (bukan tiap buka modal)
  useEffect(() => {
    if (!isGroup) api.getTemplates().then(setTemplates).catch(() => {});
  }, [isGroup]);

  function appendMessage(msg) {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }

  async function handleSend() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      const msg = await api.sendMessage(conversationId, content);
      appendMessage(msg);
    } catch (err) {
      setText(content); // kembalikan teks supaya tidak hilang
      Alert.alert("Gagal kirim", err.message);
    } finally {
      setSending(false);
    }
  }

  // ---- Kirim media (galeri / kamera / dokumen) ----
  async function uploadFile(file) {
    setUploading(true);
    try {
      const msg = await api.sendMedia(conversationId, file, text.trim());
      setText(""); // teks di input terpakai sebagai caption
      appendMessage(msg);
    } catch (err) {
      Alert.alert("Gagal kirim media", err.message);
    } finally {
      setUploading(false);
    }
  }

  async function pickFromGallery() {
    setShowAttach(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.7, // kompres foto supaya hemat kuota & cepat terkirim
    });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    await uploadFile({
      uri: a.uri,
      name: a.fileName || fileNameFromUri(a.uri, a.type === "video" ? "mp4" : "jpg"),
      type: a.mimeType || (a.type === "video" ? "video/mp4" : "image/jpeg"),
    });
  }

  async function pickFromCamera() {
    setShowAttach(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Kamera", "Izin kamera diperlukan untuk ambil foto");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    await uploadFile({
      uri: a.uri,
      name: a.fileName || fileNameFromUri(a.uri, "jpg"),
      type: a.mimeType || "image/jpeg",
    });
  }

  async function pickDocument() {
    setShowAttach(false);
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    await uploadFile({
      uri: a.uri,
      name: a.name || fileNameFromUri(a.uri, "bin"),
      type: a.mimeType || "application/octet-stream",
    });
  }

  // ---- Aksi percakapan (menu ⋮) ----
  async function changeStatus(status) {
    setShowMenu(false);
    try {
      await api.updateConversation(conversationId, { status });
      Alert.alert("Berhasil", `Status percakapan diubah`);
    } catch (err) {
      Alert.alert("Gagal", err.message);
    }
  }

  async function handleTakeover() {
    setShowMenu(false);
    try {
      await api.takeoverConversation(conversationId);
      Alert.alert("Berhasil", "Percakapan sekarang jadi lead kamu");
    } catch (err) {
      Alert.alert("Ambil Alih", err.message);
    }
  }

  // Sisipkan label tanggal ("Hari ini", "Kemarin", …) di antara pesan
  const items = [];
  let lastDay = null;
  for (const m of messages) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      items.push({ id: `day-${m.id}`, _type: "day", label: day });
      lastDay = day;
    }
    items.push(m);
  }

  function renderItem({ item }) {
    if (item._type === "day") {
      return (
        <View style={styles.dayWrap}>
          <Text style={styles.dayText}>{item.label}</Text>
        </View>
      );
    }
    const out = item.direction === "OUTBOUND";
    return (
      <View style={[styles.bubbleRow, out ? styles.rowOut : styles.rowIn]}>
        <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}>
          {isGroup && !out && item.senderName ? (
            <Text style={styles.senderName}>{item.senderName}</Text>
          ) : null}
          {item.forwarded && <Text style={styles.forwarded}>↪️ Diteruskan</Text>}
          {item.replyTo && (
            <View style={styles.quote}>
              <Text style={styles.quoteText} numberOfLines={2}>
                {item.replyTo.content || `[${item.replyTo.mediaType || "media"}]`}
              </Text>
            </View>
          )}
          {item.mediaType === "image" && item.mediaUrl ? (
            <Image source={{ uri: mediaUrl(item.mediaUrl) }} style={styles.image} resizeMode="cover" />
          ) : item.mediaType ? (
            <Text style={styles.mediaLabel}>
              {item.mediaType === "video" ? "🎥 Video" :
               item.mediaType === "audio" ? "🎤 Pesan suara" : "📄 Dokumen"}
            </Text>
          ) : null}
          {item.content ? <Text style={styles.msgText}>{item.content}</Text> : null}
          <Text style={styles.msgTime}>{clockTime(item.createdAt)}</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerInfo}
          disabled={isGroup || !customerId}
          onPress={() => navigation.navigate("Customer", { customerId, name })}
        >
          <Avatar name={name} size={38} isGroup={isGroup} />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
            <Text style={styles.headerSub}>
              {isGroup ? "Grup WhatsApp internal" : "Ketuk untuk info pelanggan"}
            </Text>
          </View>
        </TouchableOpacity>
        {!isGroup && (
          <TouchableOpacity onPress={() => setShowMenu(true)} style={styles.menuBtn}>
            <Text style={styles.menuIcon}>⋮</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Daftar pesan */}
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.header} size="large" />
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.empty}>Belum ada pesan</Text>}
        />
      )}

      {uploading && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator color="#fff" size="small" />
          <Text style={styles.uploadingText}>Mengirim media…</Text>
        </View>
      )}

      {/* Input kirim pesan */}
      {isGroup ? (
        <View style={styles.groupNotice}>
          <Text style={styles.groupNoticeText}>
            Percakapan grup hanya bisa dibaca — balas lewat HP WhatsApp langsung
          </Text>
        </View>
      ) : (
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowTemplates(true)}>
            <Text style={styles.iconBtnText}>⚡</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowAttach(true)}>
            <Text style={styles.iconBtnText}>📎</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Ketik pesan…"
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendIcon}>➤</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Modal pilih lampiran */}
      <Modal visible={showAttach} transparent animationType="fade"
             onRequestClose={() => setShowAttach(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1}
                          onPress={() => setShowAttach(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Kirim Media</Text>
            <TouchableOpacity style={styles.sheetItem} onPress={pickFromGallery}>
              <Text style={styles.sheetItemText}>🖼️ Foto / Video dari Galeri</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetItem} onPress={pickFromCamera}>
              <Text style={styles.sheetItemText}>📷 Ambil Foto (Kamera)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetItem} onPress={pickDocument}>
              <Text style={styles.sheetItemText}>📄 Dokumen</Text>
            </TouchableOpacity>
            <Text style={styles.sheetHint}>
              Teks di kolom pesan akan ikut terkirim sebagai caption
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal template balasan cepat */}
      <Modal visible={showTemplates} transparent animationType="fade"
             onRequestClose={() => setShowTemplates(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1}
                          onPress={() => setShowTemplates(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Template Balasan</Text>
            {templates.length === 0 && (
              <Text style={styles.sheetHint}>Belum ada template — buat di CRM web</Text>
            )}
            <FlatList
              data={templates}
              keyExtractor={(t) => String(t.id)}
              style={{ maxHeight: 320 }}
              renderItem={({ item: t }) => (
                <TouchableOpacity
                  style={styles.sheetItem}
                  onPress={() => { setText(t.isi); setShowTemplates(false); }}
                >
                  <Text style={styles.templateName}>{t.nama}</Text>
                  <Text style={styles.templatePreview} numberOfLines={2}>{t.isi}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal menu aksi percakapan */}
      <Modal visible={showMenu} transparent animationType="fade"
             onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1}
                          onPress={() => setShowMenu(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Aksi Percakapan</Text>
            {STATUS_OPTIONS.map((s) => (
              <TouchableOpacity key={s.key} style={styles.sheetItem}
                                onPress={() => changeStatus(s.key)}>
                <Text style={styles.sheetItemText}>{s.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.sheetItem} onPress={handleTakeover}>
              <Text style={styles.sheetItemText}>🙋 Ambil Alih Lead Ini</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.chatBg },
  header: {
    backgroundColor: colors.header, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 10,
  },
  backBtn: { paddingHorizontal: 8 },
  backText: { color: "#fff", fontSize: 30, lineHeight: 32 },
  headerInfo: { flexDirection: "row", alignItems: "center", flex: 1 },
  headerName: { color: colors.headerText, fontSize: 16, fontWeight: "700" },
  headerSub: { color: "#b2dfdb", fontSize: 11 },
  menuBtn: { paddingHorizontal: 12 },
  menuIcon: { color: "#fff", fontSize: 22, fontWeight: "700" },
  list: { flex: 1, paddingHorizontal: 10 },
  dayWrap: { alignItems: "center", marginVertical: 8 },
  dayText: {
    backgroundColor: "#e1f2fb", color: colors.textSecondary, fontSize: 12,
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, overflow: "hidden",
  },
  bubbleRow: { flexDirection: "row", marginVertical: 2 },
  rowOut: { justifyContent: "flex-end" },
  rowIn: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    elevation: 1,
  },
  bubbleOut: { backgroundColor: colors.bubbleOut, borderTopRightRadius: 2 },
  bubbleIn: { backgroundColor: colors.bubbleIn, borderTopLeftRadius: 2 },
  senderName: { fontSize: 12, fontWeight: "700", color: colors.primary, marginBottom: 2 },
  forwarded: { fontSize: 11, color: colors.textMuted, fontStyle: "italic", marginBottom: 2 },
  quote: {
    borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 6, padding: 6, marginBottom: 4,
  },
  quoteText: { fontSize: 12, color: colors.textSecondary },
  image: { width: 220, height: 220, borderRadius: 8, marginBottom: 4 },
  mediaLabel: { fontSize: 13, color: colors.textSecondary, fontStyle: "italic" },
  msgText: { fontSize: 15, color: colors.text },
  msgTime: { fontSize: 10, color: colors.textMuted, alignSelf: "flex-end", marginTop: 2 },
  empty: { textAlign: "center", marginTop: 60, color: colors.textMuted },
  uploadingBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.header, paddingVertical: 6,
  },
  uploadingText: { color: "#fff", fontSize: 12 },
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", padding: 8, gap: 6,
  },
  iconBtn: {
    width: 40, height: 44, alignItems: "center", justifyContent: "center",
  },
  iconBtnText: { fontSize: 20 },
  input: {
    flex: 1, backgroundColor: "#fff", borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 15, maxHeight: 110, color: colors.text,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.header,
    alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendIcon: { color: "#fff", fontSize: 18 },
  groupNotice: { backgroundColor: "#fef3c7", padding: 12 },
  groupNoticeText: { color: "#92400e", fontSize: 13, textAlign: "center" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 28,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: 8 },
  sheetItem: {
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetItemText: { fontSize: 15, color: colors.text },
  sheetHint: { fontSize: 12, color: colors.textMuted, marginTop: 10, textAlign: "center" },
  templateName: { fontSize: 14, fontWeight: "700", color: colors.text },
  templatePreview: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
