// 1 baris Inbox — memo + subscribe granular by id (cuma re-render item ini
// kalau conversation dengan id ini berubah, bukan seluruh list). Pola SAMA
// dengan frontend/src/features/inbox/components/ConversationList/ConversationItem.jsx.
// Swipe kanan → toggle dibaca/belum, swipe kiri → sematkan/lepas sematan.
import React, { memo, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  Check, Circle, Pin, PinOff, Image as ImageIcon, Video, Mic, FileText,
} from "lucide-react-native";
import AvatarStack from "./AvatarStack";
import PressableScale from "./PressableScale";
import { tokens } from "../constants/theme";
import { smartTimestamp } from "../utils/format";
import { useConversation, useConversationStore } from "../store/conversationStore";
import { api } from "../api";

const MEDIA_ICON = { image: ImageIcon, video: Video, audio: Mic, document: FileText };
const MEDIA_LABEL = { image: "Foto", video: "Video", audio: "Pesan suara", document: "Dokumen" };

function convName(c) {
  if (c.type === "GROUP") return c.groupName || "Grup WhatsApp";
  return c.customer?.name || c.customer?.phone || "Pelanggan";
}

// Preview pesan terakhir dipecah jadi { OutboundIcon, MediaIcon, text } —
// BUKAN string dengan emoji ditempel, supaya bisa dirender sebagai ikon
// lucide asli (spec: emoji cuma boleh di konten pesan chat user, bukan
// ikon UI seperti label preview ini).
function lastPreviewParts(c) {
  const msg = c.messages?.[0];
  if (!msg) return { OutboundIcon: null, MediaIcon: null, text: "Belum ada pesan" };
  const OutboundIcon = msg.direction === "OUTBOUND" ? Check : null;
  if (msg.content) return { OutboundIcon, MediaIcon: null, text: msg.content };
  const MediaIcon = MEDIA_ICON[msg.mediaType] || null;
  return { OutboundIcon, MediaIcon, text: MediaIcon ? MEDIA_LABEL[msg.mediaType] : "" };
}

function ConversationItemBase({ id, onPress }) {
  const c = useConversation(id);
  const swipeableRef = useRef(null);

  if (!c) return null;

  const isGroup = c.type === "GROUP";
  const name = convName(c);
  const isUnread = !!c.unread;
  const isRead = !!c.isRead;
  const isPinned = !!c.pinned;
  const unreadCount = c.unreadCount ?? (isUnread ? 1 : 0);
  // Badge CS-1/CS-2 — field sessionId cuma berisi salah satu dari ini kalau
  // sudah ter-set (lihat CLAUDE.md "Multi-session WAHA aktif").
  const sessionLabel = c.sessionId === "CS-1" || c.sessionId === "CS-2" ? c.sessionId : null;
  // Sudah dibuka tapi tidak unread lagi → dim (bukan pelanggan aktif butuh perhatian)
  const dim = isRead && !isUnread;
  const previewColor = dim ? tokens.color.textMuted : isUnread ? tokens.color.textPrimary : tokens.color.textSecondary;
  const { OutboundIcon, MediaIcon, text: previewText } = lastPreviewParts(c);

  function toggleReadUnread() {
    swipeableRef.current?.close();
    if (isUnread) {
      useConversationStore.getState().upsertConversation({ id, unread: false, unreadCount: 0, isRead: true });
      api.markConversationRead(id).catch(() => {});
    } else {
      const prev = { unread: c.unread, isRead: c.isRead, unreadCount: c.unreadCount };
      useConversationStore.getState().upsertConversation({ id, unread: true, isRead: false });
      api.updateConversation(id, { unread: true, isRead: false }).catch(() => {
        useConversationStore.getState().upsertConversation({ id, ...prev });
      });
    }
  }

  function togglePin() {
    swipeableRef.current?.close();
    const nextPinned = !isPinned;
    const prevPinnedAt = c.pinnedAt;
    useConversationStore.getState().upsertConversation({
      id, pinned: nextPinned, pinnedAt: nextPinned ? new Date().toISOString() : null,
    });
    api.updateConversation(id, { pinned: nextPinned }).catch(() => {
      useConversationStore.getState().upsertConversation({ id, pinned: isPinned, pinnedAt: prevPinnedAt });
    });
  }

  function renderLeftActions() {
    // Muncul saat swipe KANAN (drag ke kanan) → toggle dibaca/belum dibaca
    const ReadIcon = isUnread ? Check : Circle;
    return (
      <View style={[styles.actionBox, { backgroundColor: tokens.color.success }]}>
        <View style={styles.actionRow}>
          <ReadIcon size={16} color="#fff" strokeWidth={2.5} />
          <Text style={styles.actionText}>{isUnread ? "Tandai Dibaca" : "Tandai Belum Dibaca"}</Text>
        </View>
      </View>
    );
  }

  function renderRightActions() {
    // Muncul saat swipe KIRI (drag ke kiri) → sematkan/lepas sematan
    const PinIcon = isPinned ? PinOff : Pin;
    return (
      <View style={[styles.actionBox, { backgroundColor: tokens.color.accent, alignItems: "flex-end" }]}>
        <View style={styles.actionRow}>
          <PinIcon size={16} color="#fff" strokeWidth={2.5} />
          <Text style={styles.actionText}>{isPinned ? "Lepas Sematan" : "Sematkan"}</Text>
        </View>
      </View>
    );
  }

  return (
    // entering: fade + slide-in ringan SEKALI saat cell ini pertama mount —
    // memo() di bawah mencegah remount tiap kali FlashList recycle cell
    // dengan id/data baru, jadi animasi ini tidak mengganggu recycling
    // (tidak replay tiap scroll, cuma sekali per slot baru muncul).
    <Animated.View entering={FadeInDown.duration(220)} style={styles.itemWrap}>
      <Swipeable
        ref={swipeableRef}
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
        onSwipeableOpen={(direction) => {
          if (direction === "left") toggleReadUnread();
          else togglePin();
        }}
        overshootLeft={false}
        overshootRight={false}
        leftThreshold={60}
        rightThreshold={60}
      >
        <PressableScale style={styles.card} onPress={() => onPress(c)}>
          <AvatarStack avatars={[{ name }]} size={48} isGroup={isGroup} />
          <View style={styles.body}>
            <View style={styles.top}>
              <View style={styles.nameRow}>
                {isPinned && <Pin size={13} color={tokens.color.accent} strokeWidth={2.4} style={styles.nameIcon} />}
                <Text style={[styles.name, isUnread && styles.nameUnread, dim && styles.dimText]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <Text style={[styles.time, isUnread && styles.timeUnread]}>
                {smartTimestamp(c.lastMessageAt)}
              </Text>
            </View>
            <View style={styles.bottom}>
              <View style={styles.previewRow}>
                {OutboundIcon && <OutboundIcon size={13} color={previewColor} strokeWidth={2.4} style={styles.previewIcon} />}
                {MediaIcon && <MediaIcon size={13} color={previewColor} strokeWidth={2} style={styles.previewIcon} />}
                <Text
                  style={[styles.preview, isUnread && styles.previewUnread, dim && styles.dimText]}
                  numberOfLines={1}
                >
                  {previewText}
                </Text>
              </View>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                </View>
              )}
            </View>
            {sessionLabel && (
              <View style={styles.badgesRow}>
                <Text style={styles.sessionBadge}>{sessionLabel}</Text>
              </View>
            )}
          </View>
        </PressableScale>
      </Swipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  itemWrap: { marginHorizontal: 12, marginBottom: 8 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: tokens.color.card, borderRadius: tokens.radius.card,
    padding: 12, ...tokens.shadow.soft,
  },
  body: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 8 },
  nameIcon: { marginRight: 4 },
  name: { fontSize: 15, fontWeight: "600", color: tokens.color.textPrimary, flexShrink: 1 },
  nameUnread: { fontWeight: "800" },
  time: { fontSize: 11, color: tokens.color.textMuted },
  timeUnread: { color: tokens.color.accent, fontWeight: "700" },
  bottom: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  previewRow: { flex: 1, flexDirection: "row", alignItems: "center" },
  previewIcon: { marginRight: 4 },
  preview: { flex: 1, fontSize: 13, color: tokens.color.textSecondary },
  previewUnread: { color: tokens.color.textPrimary, fontWeight: "600" },
  dimText: { color: tokens.color.textMuted },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: tokens.color.accent,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 5, marginLeft: 8,
  },
  unreadBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  badgesRow: { flexDirection: "row", marginTop: 4 },
  sessionBadge: {
    fontSize: 10, fontWeight: "700", color: tokens.color.accent, backgroundColor: tokens.color.accentSoft,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden",
  },
  actionBox: {
    flex: 1, justifyContent: "center", paddingHorizontal: 18,
    borderRadius: tokens.radius.card, marginVertical: 0,
  },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});

export default memo(ConversationItemBase);
