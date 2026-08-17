// Galeri media per percakapan — fitur yang sebelumnya sudah ada di CRM web
// (frontend/src/features/inbox/components/CustomerPanel/MediaGallery.jsx)
// tapi TIDAK PERNAH dibangun di SANO Messenger mobile (dicek langsung ke git
// history sebelum menulis file ini — bukan "hilang", memang belum pernah
// ada). Dibangun 16 Agustus 2026.
//
// Data diambil dari messageStore (useMessagesForConv) — SAMA seperti
// galleryItems di ChatScreen.js, tidak fetch ulang ke server. Tap foto/video
// membuka MediaViewerModal yang SUDAH ADA (swipe + pinch-zoom), supaya tidak
// duplikasi viewer. Dokumen dibuka lewat Linking, pola sama seperti
// DocumentRow di MessageBubble.js.
import React, { lazy, Suspense, useMemo, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList, Linking, Alert } from "react-native";
import { Image } from "expo-image";
import { X, Video, FileText } from "lucide-react-native";
import { mediaUrl } from "../api";
import { useTokens } from "../constants/theme";
import { useMessagesForConv } from "../store/messageStore";

const MediaViewerModal = lazy(() => import("./MediaViewerModal"));

const GRID_GAP = 3;
const NUM_COLS = 3;

export default function GaleriMediaModal({ visible, conversationId, onClose }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const messages = useMessagesForConv(conversationId);
  const [tab, setTab] = useState("media"); // 'media' | 'doc'
  const [viewer, setViewer] = useState(null); // { items, index }

  const mediaItems = useMemo(
    () => messages.filter((m) => m.mediaUrl && (m.mediaType === "image" || m.mediaType === "video") && !m.isRevoked),
    [messages],
  );
  const docItems = useMemo(
    () => messages.filter((m) => m.mediaUrl && m.mediaType === "document" && !m.isRevoked),
    [messages],
  );
  const items = tab === "media" ? mediaItems : docItems;

  function openViewer(index) {
    setViewer({
      items: mediaItems.map((m) => ({
        id: m.id, type: m.mediaType, url: mediaUrl(m.mediaUrl),
        thumbUrl: m.thumbUrl ? mediaUrl(m.thumbUrl) : null,
      })),
      index,
    });
  }

  async function openDoc(url) {
    try {
      await Linking.openURL(mediaUrl(url));
    } catch {
      Alert.alert("Gagal buka dokumen", "Tidak ada aplikasi yang bisa membuka file ini");
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={tokens.color.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.title}>Galeri Media</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === "media" && styles.tabActive]} onPress={() => setTab("media")}>
            <Text style={[styles.tabText, tab === "media" && styles.tabTextActive]}>Media ({mediaItems.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === "doc" && styles.tabActive]} onPress={() => setTab("doc")}>
            <Text style={[styles.tabText, tab === "doc" && styles.tabTextActive]}>Dokumen ({docItems.length})</Text>
          </TouchableOpacity>
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {tab === "media" ? "Belum ada foto/video di percakapan ini." : "Belum ada dokumen di percakapan ini."}
            </Text>
          </View>
        ) : tab === "media" ? (
          <FlatList
            data={mediaItems}
            key="grid"
            numColumns={NUM_COLS}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: GRID_GAP }}
            renderItem={({ item: m, index }) => (
              <TouchableOpacity style={styles.gridCell} onPress={() => openViewer(index)}>
                {m.mediaType === "image" ? (
                  <Image source={{ uri: mediaUrl(m.mediaUrl) }} style={styles.gridThumb} contentFit="cover" cachePolicy="memory-disk" />
                ) : m.thumbUrl ? (
                  // Video: poster dari server + ikon kecil sebagai penanda
                  // bahwa ini video, bukan foto (sama seperti WhatsApp).
                  <View style={styles.gridThumb}>
                    <Image
                      source={{ uri: mediaUrl(m.thumbUrl) }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    <View style={styles.gridVideoBadge}>
                      <Video size={12} color="#fff" strokeWidth={2.2} />
                    </View>
                  </View>
                ) : (
                  <View style={[styles.gridThumb, styles.gridVideoThumb]}>
                    <Video size={20} color="#fff" strokeWidth={2} />
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        ) : (
          <FlatList
            data={docItems}
            key="list"
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item: m }) => (
              <TouchableOpacity style={styles.docRow} onPress={() => openDoc(m.mediaUrl)}>
                <FileText size={18} color={tokens.color.textSecondary} strokeWidth={1.8} />
                <Text style={styles.docName} numberOfLines={1}>
                  {decodeURIComponent(m.mediaUrl.split("/").pop() || "Dokumen")}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        {viewer && (
          <Suspense fallback={null}>
            <MediaViewerModal
              visible={!!viewer}
              items={viewer.items}
              initialIndex={viewer.index}
              onClose={() => setViewer(null)}
            />
          </Suspense>
        )}
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  const cellSize = Math.floor(100 / NUM_COLS);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tokens.color.bg },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 8, paddingTop: 54, paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    closeBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
    tabs: { flexDirection: "row", paddingHorizontal: 12, paddingTop: 10, gap: 8 },
    tab: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
      backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border,
    },
    tabActive: { backgroundColor: tokens.color.accent, borderColor: tokens.color.accent },
    tabText: { fontSize: 12.5, fontWeight: "600", color: tokens.color.textSecondary },
    tabTextActive: { color: "#fff" },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyText: { fontSize: 13.5, color: tokens.color.textMuted, textAlign: "center" },
    gridCell: { width: `${cellSize}%`, aspectRatio: 1, padding: GRID_GAP },
    gridThumb: { flex: 1, borderRadius: 6, backgroundColor: tokens.color.card, overflow: "hidden" },
    gridVideoThumb: { alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a1a" },
    gridVideoBadge: {
      position: "absolute", bottom: 4, left: 4, width: 20, height: 20, borderRadius: 10,
      alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)",
    },
    docRow: {
      flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    docName: { flex: 1, fontSize: 13.5, color: tokens.color.textPrimary },
  });
}
