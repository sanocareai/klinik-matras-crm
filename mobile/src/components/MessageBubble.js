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
import {
  Check, CheckCheck, Clock, FileText, Play, Forward, Reply, Copy, MapPin, User, BarChart3, Ban,
} from "lucide-react-native";
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
const MEDIA_LABEL = {
  image: "Foto", video: "Video", audio: "Pesan Suara", document: "Dokumen", sticker: "Stiker",
  location: "Lokasi", contact: "Kontak", poll: "Polling",
};

// Lokasi/kontak/poll BUKAN media asli (tidak pernah punya mediaUrl) —
// content-nya JSON string (lihat backend/src/utils/parseHistoryMessage.js),
// perlu di-parse ulang di sini untuk dirender jadi card, bukan teks mentah.
const STRUCTURED_TYPES = new Set(["location", "contact", "poll"]);
function parseStructuredContent(mediaType, content) {
  if (!STRUCTURED_TYPES.has(mediaType)) return null;
  try { return JSON.parse(content); } catch { return null; }
}

function LocationCard({ data }) {
  const { lat, lng, name, address } = data;
  const canOpen = lat != null && lng != null;
  function open() {
    if (!canOpen) return;
    Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`).catch(() => {});
  }
  return (
    <View style={styles.structCard}>
      <View style={styles.structHeaderRow}>
        <MapPin size={16} color={tokens.color.accent} strokeWidth={2} />
        <Text style={styles.structTitle} numberOfLines={1}>{name || "Lokasi"}</Text>
      </View>
      {!!address && <Text style={styles.structSub} numberOfLines={2}>{address}</Text>}
      {canOpen && (
        <TouchableOpacity onPress={open}>
          <Text style={styles.structLink}>Buka di Maps</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ContactCard({ data }) {
  const contacts = data.contacts || [];
  return (
    <View style={styles.structCard}>
      {contacts.map((c, i) => (
        <View key={i} style={[styles.structHeaderRow, i > 0 && { marginTop: 6 }]}>
          <User size={16} color={tokens.color.accent} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.structTitle} numberOfLines={1}>{c.name || "Kontak"}</Text>
            {!!c.phone && <Text style={styles.structSub}>{c.phone}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

function PollCard({ data }) {
  const options = data.options || [];
  return (
    <View style={styles.structCard}>
      <View style={styles.structHeaderRow}>
        <BarChart3 size={16} color={tokens.color.accent} strokeWidth={2} />
        <Text style={styles.structTitle} numberOfLines={2}>{data.question || "Polling"}</Text>
      </View>
      {options.map((opt, i) => (
        <View key={i} style={styles.pollOption}>
          <Text style={styles.pollOptionText} numberOfLines={2}>{opt}</Text>
        </View>
      ))}
    </View>
  );
}

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
  const isRevoked = !!m.isRevoked;
  const hasMedia = !!m.mediaType;
  const isStructured = STRUCTURED_TYPES.has(m.mediaType);
  const structuredData = isStructured ? parseStructuredContent(m.mediaType, m.content) : null;
  const isBracketPlaceholder = typeof m.content === "string" && /^\[.+\]$/.test(m.content);
  const text = m.content && !isRevoked && !isStructured && !(hasMedia && !m.mediaUrl && isBracketPlaceholder) ? m.content : "";

  // BUG (fix): setStringAsync balikin Promise — kalau reject (native side
  // clipboard gagal dsb) itu jadi "Uncaught (in promise)" walau pemanggil
  // dibungkus try/catch biasa, sama seperti kasus Haptics (lihat
  // src/lib/haptics.js). WAJIB .catch() + Alert supaya user tahu gagal,
  // bukan diam-diam uncaught.
  function copyText() {
    setShowActions(false);
    if (!text) return;
    try {
      Clipboard.setStringAsync(text).catch(() => {
        Alert.alert("Gagal menyalin", "Tidak bisa menyalin teks ke clipboard");
      });
    } catch {
      Alert.alert("Gagal menyalin", "Tidak bisa menyalin teks ke clipboard");
    }
  }

  function handleReply() {
    setShowActions(false);
    try {
      onReply?.(m);
    } catch {
      Alert.alert("Gagal membalas", "Terjadi kesalahan saat menyiapkan balasan");
    }
  }

  function handleForward() {
    setShowActions(false);
    try {
      onForward?.(m);
    } catch {
      Alert.alert("Gagal meneruskan", "Terjadi kesalahan saat menyiapkan pesan diteruskan");
    }
  }

  return (
    // entering: fade + slide-in ringan SEKALI saat bubble ini pertama mount —
    // memo() di bawah (lihat export) mencegah remount tiap FlashList recycle
    // cell dengan pesan lain, jadi animasi ini tidak mengganggu recycling,
    // sama seperti pola yang sudah dipakai ConversationItem.js.
    <Animated.View entering={FadeInDown.duration(180)} style={[styles.row, isOut ? styles.rowOut : styles.rowIn]}>
      <PressableScale
        onLongPress={() => { if (!isSending && !isFailed && !isRevoked) { lightHaptic(); setShowActions(true); } }}
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
              {m.replyTo.isRevoked
                ? "Pesan ini telah dihapus"
                : STRUCTURED_TYPES.has(m.replyTo.mediaType)
                ? MEDIA_LABEL[m.replyTo.mediaType]
                : (m.replyTo.content || (m.replyTo.mediaType ? MEDIA_LABEL[m.replyTo.mediaType] : "Pesan"))}
            </Text>
          </TouchableOpacity>
        )}

        {m.forwarded && (
          <View style={styles.forwardedRow}>
            <Forward size={11} color={tokens.color.textMuted} strokeWidth={2} />
            <Text style={styles.forwarded}>Diteruskan</Text>
          </View>
        )}

        {isRevoked ? (
          // Soft-delete (WAHA message.revoked) — row TETAP ADA di DB, bubble
          // tampilkan penanda "dihapus" (pola WhatsApp asli), BUKAN bubble
          // kosong/hilang. Tidak render media/text asli sama sekali walau
          // masih ada sisa data lama di kolom lain.
          <View style={styles.revokedRow}>
            <Ban size={13} color={isOut ? "rgba(255,255,255,0.8)" : tokens.color.textMuted} strokeWidth={2} />
            <Text style={[styles.revokedText, isOut && styles.revokedTextOut]}>Pesan ini telah dihapus</Text>
          </View>
        ) : (
          <>
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
            {m.mediaType === "sticker" && m.mediaUrl && (
              // Stiker WhatsApp = WebP transparan kecil — TIDAK pakai TouchableOpacity/
              // onOpenMedia (bukan foto, tidak masuk galeri swipe, tidak perlu di-zoom,
              // sama seperti perilaku asli WhatsApp) dan TIDAK ada background bubble
              // di baliknya (resizeMode "contain" jaga transparansi apa adanya).
              <Image source={{ uri: mediaUrl(m.mediaUrl) }} style={styles.sticker} resizeMode="contain" />
            )}
            {m.mediaType === "audio" && m.mediaUrl && <AudioPlayer uri={mediaUrl(m.mediaUrl)} />}
            {m.mediaType === "document" && m.mediaUrl && <DocumentRow url={m.mediaUrl} />}
            {m.mediaType === "location" && (structuredData ? <LocationCard data={structuredData} /> : (
              <Text style={styles.mediaMissing}>Lokasi tidak bisa ditampilkan</Text>
            ))}
            {m.mediaType === "contact" && (structuredData ? <ContactCard data={structuredData} /> : (
              <Text style={styles.mediaMissing}>Kontak tidak bisa ditampilkan</Text>
            ))}
            {m.mediaType === "poll" && (structuredData ? <PollCard data={structuredData} /> : (
              <Text style={styles.mediaMissing}>Polling tidak bisa ditampilkan</Text>
            ))}
            {hasMedia && !m.mediaUrl && !isStructured && (
              <Text style={styles.mediaMissing}>{MEDIA_LABEL[m.mediaType] || "Media"} tidak tersedia</Text>
            )}

            {!!text && <Text style={[styles.text, isOut && styles.textOut]}>{text}</Text>}
          </>
        )}

        <View style={styles.metaRow}>
          {isSending && <Clock size={10} color={tokens.color.textMuted} strokeWidth={2.2} style={styles.metaIcon} />}
          {!!m.editedAt && !isRevoked && (
            <Text style={[styles.editedLabel, isOut && styles.editedLabelOut]}>diedit</Text>
          )}
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
              <TouchableOpacity style={styles.actionItemRow} onPress={handleReply}>
                <Reply size={16} color={tokens.color.textPrimary} strokeWidth={2} style={styles.actionIcon} />
                <Text style={styles.actionText}>Balas</Text>
              </TouchableOpacity>
            )}
            {onForward && (
              <TouchableOpacity style={styles.actionItemRow} onPress={handleForward}>
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
  sticker: { width: 130, height: 130, marginBottom: 4 },
  videoThumb: {
    width: 220, height: 140, borderRadius: 10, marginBottom: 4, backgroundColor: "#0f172a",
    alignItems: "center", justifyContent: "center",
  },
  videoLabel: { color: "#e2e8f0", fontSize: 11, marginTop: 4 },
  docRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, maxWidth: 220 },
  docName: { fontSize: 13, color: tokens.color.textPrimary, flex: 1 },
  mediaMissing: { fontSize: 12, color: tokens.color.textMuted, fontStyle: "italic", marginBottom: 4 },
  structCard: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, padding: 10, marginBottom: 4, minWidth: 180,
  },
  structHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  structTitle: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary, flex: 1 },
  structSub: { fontSize: 12, color: tokens.color.textSecondary, marginTop: 2 },
  structLink: { fontSize: 12, fontWeight: "700", color: tokens.color.accent, marginTop: 6 },
  pollOption: {
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border,
  },
  pollOptionText: { fontSize: 13, color: tokens.color.textPrimary },
  text: { fontSize: 15, color: tokens.color.textPrimary },
  textOut: { color: "#fff" },
  revokedRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  revokedText: { fontSize: 14, fontStyle: "italic", color: tokens.color.textMuted },
  revokedTextOut: { color: "rgba(255,255,255,0.8)" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 },
  metaIcon: { marginRight: 1 },
  editedLabel: { fontSize: 10, color: tokens.color.textMuted, fontStyle: "italic" },
  editedLabelOut: { color: "rgba(255,255,255,0.75)" },
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
