// Daftar percakapan (gaya layar utama WhatsApp) + tab filter status + search.
// Polling 5 detik — sama dengan Inbox versi web.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, Alert, ActivityIndicator, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api";
import { colors } from "../theme";
import { timeAgo } from "../utils/format";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";

// key "MINE" filter berdasarkan assignedToId (user login), sisanya berdasarkan status.
// countKey menunjuk field yang cocok di response GET /conversations/counts.
const TABS = [
  { key: "", label: "Semua", countKey: "semua" },
  { key: "OPEN", label: "Terbuka", countKey: "terbuka" },
  { key: "PENDING", label: "Pending", countKey: "pending" },
  { key: "RESOLVED", label: "Selesai", countKey: "selesai" },
  { key: "MINE", label: "Milik Saya", countKey: "milikSaya" },
];

const POLL_MS = 5000;

// Nama tampilan percakapan: nama grup, atau nama/nomor customer
function convName(conv) {
  if (conv.type === "GROUP") return conv.groupName || "Grup WhatsApp";
  return conv.customer?.name || conv.customer?.phone || "Pelanggan";
}

// Preview pesan terakhir untuk baris daftar
function lastPreview(conv) {
  const msg = conv.messages?.[0];
  if (!msg) return "";
  const prefix = msg.direction === "OUTBOUND" ? "✓ " : "";
  if (msg.content) return prefix + msg.content;
  if (msg.mediaType === "image") return prefix + "📷 Foto";
  if (msg.mediaType === "video") return prefix + "🎥 Video";
  if (msg.mediaType === "audio") return prefix + "🎤 Pesan suara";
  if (msg.mediaType === "document") return prefix + "📄 Dokumen";
  return "";
}

export default function ChatListScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [counts, setCounts] = useState({});
  // Tab tidak di-persist ke storage (sengaja) — reset ke "Semua" tiap app dibuka lagi
  const [tab, setTab] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    try {
      const params = tab === "MINE"
        ? { assignedToId: user?.id }
        : { status: tab || undefined };
      const [data, countData] = await Promise.all([
        api.getConversations(params),
        api.getConversationCounts(),
      ]);
      setConversations(data);
      setCounts(countData);
    } catch (err) {
      // Saat polling diam-diam, jangan spam alert kalau koneksi putus sebentar
      if (!silent) Alert.alert("Gagal memuat", err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, user?.id]);

  // Muat ulang + polling hanya saat layar ini aktif (hemat baterai & kuota)
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      pollRef.current = setInterval(() => load(true), POLL_MS);
      return () => clearInterval(pollRef.current);
    }, [load])
  );

  // Filter search di sisi client (data sudah di memori, max 100 percakapan)
  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          convName(c).toLowerCase().includes(q) ||
          (c.customer?.phone || "").includes(q)
      )
    : conversations;

  function renderItem({ item }) {
    const name = convName(item);
    const isGroup = item.type === "GROUP";
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() =>
          navigation.navigate("Chat", {
            conversationId: item.id,
            name,
            isGroup,
            customerId: item.customerId,
            assignedTo: item.assignedTo?.name || null,
          })
        }
      >
        <Avatar name={name} isGroup={isGroup} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, item.unread && styles.nameUnread]} numberOfLines={1}>
              {item.pinned ? "📌 " : ""}{name}
            </Text>
            <Text style={[styles.time, item.unread && styles.timeUnread]}>
              {timeAgo(item.lastMessageAt)}
            </Text>
          </View>
          <View style={styles.rowBottom}>
            <Text
              style={[styles.preview, item.unread && styles.previewUnread]}
              numberOfLines={1}
            >
              {lastPreview(item)}
            </Text>
            {item.unread && <View style={styles.unreadDot} />}
          </View>
          <View style={styles.badges}>
            {item.assignedTo && (
              <Text style={styles.assignedBadge}>👤 {item.assignedTo.name}</Text>
            )}
            {item.isUnanswered && item.unansweredMinutes >= 60 && (
              <Text style={styles.warnBadge}>Belum dibalas {Math.floor(item.unansweredMinutes / 60)}j+</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header hijau gaya WhatsApp */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Klinik Matras</Text>
          <Text style={styles.headerSub}>{user?.name} · {user?.role === "ADMIN" ? "Admin" : "Sales"}</Text>
        </View>
        <TouchableOpacity
          onPress={() =>
            Alert.alert("Keluar", "Yakin ingin keluar dari akun ini?", [
              { text: "Batal", style: "cancel" },
              { text: "Keluar", style: "destructive", onPress: logout },
            ])
          }
        >
          <Text style={styles.logoutIcon}>⎋</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Cari nama atau nomor…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Tab filter — horizontal scroll, mirip WhatsApp Business */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((t) => {
          const count = counts[t.countKey] || 0;
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
              {count > 0 && (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text style={styles.tabBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.header} size="large" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>Tidak ada percakapan</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  header: {
    backgroundColor: colors.header, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
  },
  headerTitle: { color: colors.headerText, fontSize: 20, fontWeight: "700" },
  headerSub: { color: "#b2dfdb", fontSize: 12, marginTop: 2 },
  logoutIcon: { color: colors.headerText, fontSize: 22, padding: 6 },
  searchWrap: { padding: 10, backgroundColor: colors.header, paddingTop: 0 },
  search: {
    backgroundColor: "#ffffff", borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 8, fontSize: 14, color: colors.text,
  },
  tabs: { backgroundColor: colors.header, flexGrow: 0 },
  tabsContent: { paddingHorizontal: 8 },
  tab: {
    flexDirection: "row", alignItems: "center", paddingVertical: 10,
    paddingHorizontal: 14, borderBottomWidth: 3, borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: "#b2dfdb", fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#fff" },
  tabBadge: {
    marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center",
    justifyContent: "center", paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: colors.accent },
  tabBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  row: {
    flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    alignItems: "center", gap: 12,
  },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 16, fontWeight: "600", color: colors.text, flex: 1, marginRight: 8 },
  nameUnread: { fontWeight: "800" },
  time: { fontSize: 12, color: colors.textMuted },
  timeUnread: { color: colors.accent, fontWeight: "700" },
  rowBottom: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  preview: { flex: 1, fontSize: 14, color: colors.textSecondary },
  previewUnread: { color: colors.text, fontWeight: "600" },
  unreadDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent, marginLeft: 8,
  },
  badges: { flexDirection: "row", gap: 6, marginTop: 3 },
  assignedBadge: {
    fontSize: 11, color: colors.primary, backgroundColor: "#eff6ff",
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: "hidden",
  },
  warnBadge: {
    fontSize: 11, color: "#92400e", backgroundColor: "#fef3c7",
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: "hidden",
  },
  empty: { textAlign: "center", marginTop: 60, color: colors.textMuted },
});
