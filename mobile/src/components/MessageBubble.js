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
import Animated, { FadeInDown } from "react-native-reanimated";
import { Check, CheckCheck, Clock, FileText, Play, Forward, Reply, Copy } from "lucide-react-native";
import { mediaUrl } from "../api";
import { tokens } from "../constants/theme";
import { clockTime } from "../utils/format";
import AudioPlayer from "./AudioPlayer";
import PressableScale from "./PressableScale";
import { lightHaptic } from "../lib/haptics";

// Backend Message.ack: 0 pending, 1 sent, 2 delivered, 3 read — sama
// dengan frontend/src/features/inbox/utils/ackLevel.js.
function AckTicks({ ack }) {
  if (ack === 3) return <CheckCheck size={13} color="#3b82f6" strokeWidth={2.4} style={styles.ackIcon} />;
  if (ack === 2) return <CheckCheck size={13} color={tokens.color.textMuted} strokeWidth={2.4} style={styles.ackIcon} />;
  if (ack === 1) return <Check size={13} color={tokens.color.textMuted} strokeWidth={2.4} style={styles.ackIcon} />;
  return null;
}

// Label teks polos (TANPA emoji) — dipakai di konteks yang murni tekstual
// (preview kutipan reply, pesan "media tidak tersedia"); rendering media
// yang SEBENARNYA (bubble utama) sudah pakai ikon lucide asli di bawah.
const MEDIA_LABEL = { image: "Foto", video: "Video", audio: "Pesan Suara", document: "Dokumen" };

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
      <FileText size={20} color={tokens.color.textSecondary} strokeWidth={1.8} />
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
    // entering: fade + slide-in ringan SEKALI saat bubble ini pertama mount —
    // memo() di bawah (lihat export) mencegah remount tiap FlashList recycle
    // cell dengan pesan lain, jadi animasi ini tidak mengganggu recycling,
    // sama seperti pola yang sudah dipakai ConversationItem.js.
    <Animated.View entering={FadeInDown.duration(180)} style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}>
      <PressableScale
        onLongPress={() => { if (!isSending && !isFailed) { lightHaptic(); setShowActions(true); } }}
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

        {m.forwarded && (
          <View style={styles.forwardedRow}>
            <Forward size={11} color={tokens.color.textMuted} strokeWidth={2} />
            <Text style={styles.forwarded}>Diteruskan</Text>
          </View>
        )}

        {m.mediaType === "image" && m.mediaUrl && (
          <TouchableOpacity onPress={() => onOpenMedia?.(m)}>
            <Image source={{ uri: mediaUrl(m.mediaUrl) }} style={styles.image} resizeMode="cover" />
          </TouchableOpacity>
        )}
        {m.mediaType === "video" && m.mediaUrl && (
          <TouchableOpacity style={styles.videoThumb} onPress={() => onOpenMedia?.(m)}>
            <Play size={28} color="#fff" fill="#fff" strokeWidth={0} />
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
          {isSending && <Clock size={10} color={tokens.color.textMuted} strokeWidth={2.2} style={styles.metaIcon} />}
          <Text style={[styles.time, isOut && styles.timeOut]}>{clockTime(m.createdAt)}</Text>
          {isOut && !isSending && !isFailed && <AckTicks ack={m.ack} />}
        </View>

        {isFailed && (
          <TouchableOpacity style={styles.retryBtn} onPress={() => onRetry?.(m)}>
            <Text style={styles.retryText}>Gagal terkirim — Coba lagi</Text>
          </TouchableOpacity>
        )}
      </PressableScale>

      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <TouchableOpacity style={styles.actionOverlay} activeOpacity={1} onPress={() => setShowActions(false)}>
          <View style={styles.actionSheet}>
            {onReply && (
              <TouchableOpacity style={styles.actionItemRow} onPress={() => { setShowActions(false); onReply(m); }}>
                <Reply size={16} color={tokens.color.textPrimary} strokeWidth={2} style={styles.actionIcon} />
                <Text style={styles.actionText}>Balas</Text>
              </TouchableOpacity>
            )}
            {onForward && (
              <TouchableOpacity style={styles.actionItemRow} onPress={() => { setShowActions(false); onForward(m); }}>
                <Forward size={16} color={tokens.color.textPrimary} strokeWidth={2} style={styles.actionIcon} />
                <Text style={styles.actionText}>Teruskan</Text>
              </TouchableOpacity>
            )}
            {!!text && (
              <TouchableOpacity style={styles.actionItemRow} onPress={copyText}>
                <Copy size={16} color={tokens.color.textPrimary} strokeWidth={2} style={styles.actionIcon} />
                <Text style={styles.actionText}>Salin Teks</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", marginVertical: 2, position: "relative" },
  rowOut: { alignItems: "flex-end" },
  rowIn: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "82%", borderRadius: tokens.radius.bubble, paddingHorizontal: 12, paddingVertical: 8,
  },
  bubbleOut: { backgroundColor: tokens.color.accent, borderBottomRightRadius: tokens.radius.bubbleTail },
  bubbleIn: {
    backgroundColor: tokens.color.card, borderBottomLeftRadius: tokens.radius.bubbleTail,
    ...tokens.shadow.soft, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
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
  forwardedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  forwarded: { fontSize: 11, color: tokens.color.textMuted, fontStyle: "italic" },
  image: { width: 220, height: 220, borderRadius: 10, marginBottom: 4 },
  videoThumb: {
    width: 220, height: 140, borderRadius: 10, marginBottom: 4, backgroundColor: "#0f172a",
    alignItems: "center", justifyContent: "center",
  },
  videoLabel: { color: "#e2e8f0", fontSize: 11, marginTop: 4 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, maxWidth: 220 },
  docName: { fontSize: 13, color: tokens.color.textPrimary, flex: 1 },
  mediaMissing: { fontSize: 12, color: tokens.color.textMuted, fontStyle: "italic", marginBottom: 4 },
  text: { fontSize: 15, color: tokens.color.textPrimary },
  textOut: { color: "#fff" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 },
  metaIcon: { marginRight: 1 },
  time: { fontSize: 10, color: tokens.color.textMuted },
  timeOut: { color: "rgba(255,255,255,0.8)" },
  ackIcon: { marginLeft: 2 },
  retryBtn: { marginTop: 4 },
  retryText: { fontSize: 11, color: tokens.color.danger, fontWeight: "600" },
  actionOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center",
  },
  actionSheet: {
    backgroundColor: tokens.color.card, borderRadius: tokens.radius.control,
    paddingVertical: 4, minWidth: 180,
    ...tokens.shadow.soft, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  actionItemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 16 },
  actionIcon: { marginRight: 10 },
  actionText: { fontSize: 14, color: tokens.color.textPrimary },
});

export default memo(MessageBubbleBase);
