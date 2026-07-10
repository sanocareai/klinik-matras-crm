// Bubble pesan — pola SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/MessageBubble.jsx:
// varian teks/foto/video/audio/dokumen, ack ticks, reply quote, forwarded
// label, long-press → Reply/Forward/Salin. memo supaya list tidak
// re-render seluruh bubble tiap ada pesan baru masuk.
import React, { memo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image, Linking, Alert, Modal,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { mediaUrl } from "../api";
import { tokens } from "../constants/theme";
import { clockTime } from "../utils/format";
import AudioPlayer from "./AudioPlayer";

// Backend Message.ack: 0 pending, 1 sent, 2 delivered, 3 read — sama
// dengan frontend/src/features/inbox/utils/ackLevel.js.
function AckTicks({ ack }) {
  if (ack === 3) return <Text style={[styles.ackIcon, { color: "#3b82f6" }]}>✓✓</Text>;
  if (ack === 2) return <Text style={styles.ackIcon}>✓✓</Text>;
  if (ack === 1) return <Text style={styles.ackIcon}>✓</Text>;
  return null;
}

const MEDIA_LABEL = { image: "📷 Foto", video: "🎥 Video", audio: "🎤 Pesan Suara", document: "📄 Dokumen" };

function DocumentRow({ url }) {
  const fileName = decodeURIComponent(url.split("/").pop() || "Dokumen");
  async function open() {
    try {
      await Linking.openURL(mediaUrl(url));
    } catch {
      Alert.alert("Gagal buka dokumen", "Tidak ada aplikasi yang bisa membuka file ini");
    }
  }
  return (
    <TouchableOpacity style={styles.docRow} onPress={open}>
      <Text style={styles.docIcon}>📄</Text>
      <Text style={styles.docName} numberOfLines={1}>{fileName}</Text>
    </TouchableOpacity>
  );
}

function MessageBubbleBase({
  message: m, isGroup, onReply, onForward, onJumpToReply, onOpenMedia, onRetry, highlighted,
}) {
  const [showActions, setShowActions] = useState(false);

  const isOut = m.direction === "OUTBOUND";
  const isSending = m.status === "sending";
  const isFailed = m.status === "failed";
  const hasMedia = !!m.mediaType;
  const isBracketPlaceholder = typeof m.content === "string" && /^\[.+\]$/.test(m.content);
  const text = m.content && !(hasMedia && !m.mediaUrl && isBracketPlaceholder) ? m.content : "";

  function copyText() {
    setShowActions(false);
    if (text) Clipboard.setStringAsync(text);
  }

  return (
    <View style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={() => !isSending && !isFailed && setShowActions(true)}
        style={[
          styles.bubble,
          isOut ? styles.bubbleOut : styles.bubbleIn,
          highlighted && styles.bubbleHighlight,
          isFailed && styles.bubbleFailed,
        ]}
      >
        {!isOut && isGroup && m.senderName && (
          <Text style={styles.senderName}>{m.senderName}</Text>
        )}

        {m.replyTo && (
          <TouchableOpacity
            style={styles.quote}
            onPress={() => onJumpToReply?.(m.replyTo.id)}
          >
            <Text style={styles.quoteAuthor}>
              {m.replyTo.direction === "OUTBOUND" ? "Kamu" : "Pelanggan"}
            </Text>
            <Text style={styles.quoteText} numberOfLines={2}>
              {m.replyTo.content || (m.replyTo.mediaType ? MEDIA_LABEL[m.replyTo.mediaType] : "Pesan")}
            </Text>
          </TouchableOpacity>
        )}

        {m.forwarded && <Text style={styles.forwarded}>↪ Diteruskan</Text>}

        {m.mediaType === "image" && m.mediaUrl && (
          <TouchableOpacity onPress={() => onOpenMedia?.(m)}>
            <Image source={{ uri: mediaUrl(m.mediaUrl) }} style={styles.image} resizeMode="cover" />
          </TouchableOpacity>
        )}
        {m.mediaType === "video" && m.mediaUrl && (
          <TouchableOpacity style={styles.videoThumb} onPress={() => onOpenMedia?.(m)}>
            <Text style={styles.videoPlayIcon}>▶</Text>
            <Text style={styles.videoLabel}>Video</Text>
          </TouchableOpacity>
        )}
        {m.mediaType === "audio" && m.mediaUrl && <AudioPlayer uri={mediaUrl(m.mediaUrl)} />}
        {m.mediaType === "document" && m.mediaUrl && <DocumentRow url={m.mediaUrl} />}
        {hasMedia && !m.mediaUrl && (
          <Text style={styles.mediaMissing}>{MEDIA_LABEL[m.mediaType] || "Media"} tidak tersedia</Text>
        )}

        {!!text && <Text style={[styles.text, isOut && styles.textOut]}>{text}</Text>}

        <View style={styles.metaRow}>
          {isSending && <Text style={styles.metaIcon}>🕐</Text>}
          <Text style={[styles.time, isOut && styles.timeOut]}>{clockTime(m.createdAt)}</Text>
          {isOut && !isSending && !isFailed && <AckTicks ack={m.ack} />}
        </View>

        {isFailed && (
          <TouchableOpacity style={styles.retryBtn} onPress={() => onRetry?.(m)}>
            <Text style={styles.retryText}>Gagal terkirim — Coba lagi</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <TouchableOpacity style={styles.actionOverlay} activeOpacity={1} onPress={() => setShowActions(false)}>
          <View style={styles.actionSheet}>
            {onReply && (
              <TouchableOpacity style={styles.actionItem} onPress={() => { setShowActions(false); onReply(m); }}>
                <Text style={styles.actionText}>↩ Balas</Text>
              </TouchableOpacity>
            )}
            {onForward && (
              <TouchableOpacity style={styles.actionItem} onPress={() => { setShowActions(false); onForward(m); }}>
                <Text style={styles.actionText}>↪ Teruskan</Text>
              </TouchableOpacity>
            )}
            {!!text && (
              <TouchableOpacity style={styles.actionItem} onPress={copyText}>
                <Text style={styles.actionText}>📋 Salin Teks</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", marginVertical: 2, position: "relative" },
  rowOut: { alignItems: "flex-end" },
  rowIn: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "82%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8,
  },
  bubbleOut: { backgroundColor: tokens.color.accent, borderTopRightRadius: 4 },
  bubbleIn: {
    backgroundColor: tokens.color.card, borderTopLeftRadius: 4,
    borderWidth: 1, borderColor: tokens.color.border,
  },
  bubbleHighlight: { backgroundColor: "#fef9c3" },
  bubbleFailed: { backgroundColor: "#fee2e2" },
  senderName: { fontSize: 12, fontWeight: "700", color: tokens.color.accent, marginBottom: 2 },
  quote: {
    borderLeftWidth: 3, borderLeftColor: tokens.color.accent, backgroundColor: "rgba(0,0,0,0.06)",
    borderRadius: 6, padding: 6, marginBottom: 4,
  },
  quoteAuthor: { fontSize: 11, fontWeight: "700", color: tokens.color.textSecondary },
  quoteText: { fontSize: 12, color: tokens.color.textSecondary },
  forwarded: { fontSize: 11, color: tokens.color.textMuted, fontStyle: "italic", marginBottom: 3 },
  image: { width: 220, height: 220, borderRadius: 10, marginBottom: 4 },
  videoThumb: {
    width: 220, height: 140, borderRadius: 10, marginBottom: 4, backgroundColor: "#0f172a",
    alignItems: "center", justifyContent: "center",
  },
  videoPlayIcon: { color: "#fff", fontSize: 28 },
  videoLabel: { color: "#e2e8f0", fontSize: 11, marginTop: 4 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, maxWidth: 220 },
  docIcon: { fontSize: 20 },
  docName: { fontSize: 13, color: tokens.color.textPrimary, flex: 1 },
  mediaMissing: { fontSize: 12, color: tokens.color.textMuted, fontStyle: "italic", marginBottom: 4 },
  text: { fontSize: 15, color: tokens.color.textPrimary },
  textOut: { color: "#fff" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 },
  metaIcon: { fontSize: 10 },
  time: { fontSize: 10, color: tokens.color.textMuted },
  timeOut: { color: "rgba(255,255,255,0.8)" },
  ackIcon: { fontSize: 11, color: tokens.color.textMuted, marginLeft: 2 },
  retryBtn: { marginTop: 4 },
  retryText: { fontSize: 11, color: tokens.color.danger, fontWeight: "600" },
  actionOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center",
  },
  actionSheet: {
    backgroundColor: tokens.color.card, borderRadius: tokens.radius.control,
    paddingVertical: 4, minWidth: 180,
    borderWidth: 1, borderColor: tokens.color.border,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  actionItem: { paddingVertical: 10, paddingHorizontal: 16 },
  actionText: { fontSize: 14, color: tokens.color.textPrimary },
});

export default memo(MessageBubbleBase);
