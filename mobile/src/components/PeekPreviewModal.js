// Peek Preview ala WhatsApp — long-press percakapan di Inbox → popup ringan
// dekat item (BUKAN fullscreen), tampilkan beberapa pesan terakhir TANPA
// menandai percakapan sudah dibaca. Fetch lewat api.peekConversation()
// (GET /conversations/:id/peek), BUKAN api.getMessages() yang dipakai
// ChatScreen — endpoint itu punya side-effect mark-as-read yang justru
// ingin dihindari fitur ini (lihat backend/src/routes/conversations.js).
//
// Komponen ini SELF-CONTAINED (fetch peek + takeover urus sendiri, sama
// pola dengan toggleReadUnread/togglePin di ConversationItem.js) — parent
// cuma perlu kasih `conversation` + posisi anchor + onClose/onOpenChat.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Modal, ActivityIndicator,
} from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import {
  MessageCircle, UserPlus, Image as ImageIcon, Video, Mic, FileText,
} from "lucide-react-native";
import { useTokens } from "../constants/theme";
import Avatar from "./Avatar";
import { clockTime } from "../utils/format";
import { api } from "../api";
import { useConversationStore } from "../store/conversationStore";
import { lightHaptic } from "../lib/haptics";

const { height: SCREEN_H } = Dimensions.get("window");
const POPUP_HEIGHT_ESTIMATE = 340; // dipakai clamp posisi biar tidak overflow layar
const PEEK_LIMIT = 5;

const MEDIA_ICON = { image: ImageIcon, video: Video, audio: Mic, document: FileText };
const MEDIA_LABEL = { image: "Foto", video: "Video", audio: "Pesan suara", document: "Dokumen" };

// Baris pesan read-only, sengaja TIDAK interaktif (bukan MessageBubble asli
// — tidak butuh gesture reply/long-press/edit, cuma tampilan ringkas).
function PeekMessageRow({ message, tokens, styles }) {
  const isOut = message.direction === "OUTBOUND";
  const MediaIcon = message.mediaType ? MEDIA_ICON[message.mediaType] : null;
  const isBracketPlaceholder = typeof message.content === "string" && /^\[.+\]$/.test(message.content);
  const label = message.content && !isBracketPlaceholder
    ? message.content
    : (message.mediaType ? (MEDIA_LABEL[message.mediaType] || "Media") : "Pesan");

  return (
    <View style={[styles.msgRow, isOut ? styles.msgRowOut : styles.msgRowIn]}>
      <View style={[styles.msgBubble, isOut ? styles.msgBubbleOut : styles.msgBubbleIn]}>
        {MediaIcon && (
          <MediaIcon size={12} color={isOut ? "#fff" : tokens.color.textSecondary} strokeWidth={2} style={styles.msgIcon} />
        )}
        <Text numberOfLines={2} style={[styles.msgText, isOut && styles.msgTextOut]}>{label}</Text>
      </View>
      <Text style={styles.msgTime}>{clockTime(message.createdAt)}</Text>
    </View>
  );
}

// anchorY: posisi Y (pageY dari event long-press) tempat popup harus muncul
// dekat — DICLAMP di bawah supaya tidak pernah overflow keluar layar atas/bawah.
export default function PeekPreviewModal({ visible, conversation, anchorY = 0, onClose, onOpenChat }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [takingOver, setTakingOver] = useState(false);

  const conversationId = conversation?.id;

  useEffect(() => {
    if (!visible || !conversationId) return;
    let alive = true;
    setLoading(true);
    setErrorMsg(null);
    api.peekConversation(conversationId, PEEK_LIMIT)
      .then((data) => { if (alive) setMessages(data || []); })
      .catch((err) => { if (alive) setErrorMsg(err.message || "Gagal memuat pratinjau"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible, conversationId]);

  async function handleTakeover() {
    if (takingOver) return;
    setTakingOver(true);
    try {
      const updated = await api.takeoverConversation(conversationId);
      useConversationStore.getState().upsertConversation(updated);
      lightHaptic();
      onClose?.();
    } catch (err) {
      setErrorMsg(err.message || "Gagal ambil percakapan");
    } finally {
      setTakingOver(false);
    }
  }

  if (!conversation) return null;

  const isGroup = conversation.type === "GROUP";
  const name = isGroup
    ? (conversation.groupName || "Grup WhatsApp")
    : (conversation.customer?.name || conversation.customer?.phone || "Pelanggan");
  const sessionLabel = conversation.sessionId === "CS-1" || conversation.sessionId === "CS-2" ? conversation.sessionId : null;
  const needsTakeover = !isGroup && !conversation.assignedToId;

  // Clamp: popup ditaruh sedikit di atas titik tekan, tidak pernah lewat
  // batas atas (50px, sisakan ruang status bar) atau batas bawah layar.
  const top = Math.min(Math.max(anchorY - 60, 50), SCREEN_H - POPUP_HEIGHT_ESTIMATE - 40);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Backdrop — tap di luar popup → tutup (sama pola dengan PickerSheet
          di CustomerProfileContent.js: TouchableOpacity penuh layar, konten
          popup di dalamnya plain View, tombol di dalam tetap terima tap
          duluan karena Touchable anak menang responder). */}
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View entering={ZoomIn.duration(150)} style={[styles.popup, { top }]}>
          <View style={styles.header}>
            <Avatar name={name} isGroup={isGroup} size={36} avatarUrl={conversation.customer?.profilePictureUrl} />
            <View style={styles.headerText}>
              <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
              {sessionLabel ? (
                <Text style={styles.headerSession}>{sessionLabel}</Text>
              ) : isGroup ? (
                <Text style={styles.headerSession}>Grup WhatsApp</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.body}>
            {loading ? (
              <ActivityIndicator color={tokens.color.accent} style={{ marginVertical: 24 }} />
            ) : errorMsg ? (
              <Text style={styles.errorText}>{errorMsg}</Text>
            ) : messages.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada pesan</Text>
            ) : (
              messages.map((m) => <PeekMessageRow key={m.id} message={m} tokens={tokens} styles={styles} />)
            )}
          </View>

          <View style={styles.footer}>
            {needsTakeover && (
              <TouchableOpacity style={styles.footerBtnSecondary} onPress={handleTakeover} disabled={takingOver}>
                {takingOver ? (
                  <ActivityIndicator size="small" color={tokens.color.accent} />
                ) : (
                  <>
                    <UserPlus size={15} color={tokens.color.accent} strokeWidth={2.2} style={styles.footerBtnIcon} />
                    <Text style={styles.footerBtnSecondaryText}>Ambil Percakapan</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.footerBtn} onPress={onOpenChat}>
              <MessageCircle size={15} color="#fff" strokeWidth={2.2} style={styles.footerBtnIcon} />
              <Text style={styles.footerBtnText}>Buka Chat</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
    popup: {
      position: "absolute", left: 16, right: 16,
      backgroundColor: tokens.color.card, borderRadius: tokens.radius.card,
      paddingTop: 14, overflow: "hidden",
      ...tokens.shadow.soft, shadowOpacity: 0.2, elevation: 8,
    },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 10 },
    headerText: { flex: 1, marginLeft: 10 },
    headerName: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary },
    headerSession: { fontSize: 11, color: tokens.color.textMuted, marginTop: 1 },
    body: {
      paddingHorizontal: 14, paddingVertical: 8, minHeight: 60,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    errorText: { fontSize: 12, color: tokens.color.danger, textAlign: "center", marginVertical: 20 },
    emptyText: { fontSize: 12, color: tokens.color.textMuted, textAlign: "center", marginVertical: 20 },
    msgRow: { marginVertical: 4, flexShrink: 1 },
    msgRowIn: { alignItems: "flex-start" },
    msgRowOut: { alignItems: "flex-end" },
    msgBubble: {
      flexDirection: "row", alignItems: "center", maxWidth: "85%",
      borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6,
    },
    msgBubbleIn: { backgroundColor: tokens.color.subtle },
    msgBubbleOut: { backgroundColor: tokens.color.accent },
    msgIcon: { marginRight: 4 },
    msgText: { fontSize: 12.5, color: tokens.color.textPrimary },
    msgTextOut: { color: "#fff" },
    msgTime: { fontSize: 9, color: tokens.color.textMuted, marginTop: 2 },
    footer: { flexDirection: "row", padding: 10, gap: 8 },
    footerBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      backgroundColor: tokens.color.accent, borderRadius: tokens.radius.pill, paddingVertical: 10,
    },
    footerBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
    footerBtnSecondary: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      backgroundColor: tokens.color.accentSoft, borderRadius: tokens.radius.pill, paddingVertical: 10,
    },
    footerBtnSecondaryText: { color: tokens.color.accent, fontWeight: "700", fontSize: 13 },
    footerBtnIcon: { marginRight: 6 },
  });
}
