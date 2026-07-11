// InboxScreen (Fase M-B) — desain light-blue: card putih rounded-2xl, tab
// pill biru, search expandable, swipe actions, infinite scroll + real-time.
// Data: cache global conversationStore (Zustand) + useConversations
// (TanStack useInfiniteQuery, cursor pagination) — list yang tampil disaring
// ulang di sini lewat filter/search AKTIF SEKARANG (pola sama dengan
// frontend/src/features/inbox/components/ConversationList/index.jsx).
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, ActivityIndicator, ScrollView, Modal, Switch,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect } from "@react-navigation/native";
import { Search, SlidersHorizontal, LogOut, Inbox, MessageCircle, Clock, CheckCircle2, User, X } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import ConversationItem from "../components/ConversationItem";
import PressableScale from "../components/PressableScale";
import { useConversations } from "../hooks/useConversations";
import {
  useConversationStore, useOrderedIds, useFilter, useConvSearchQuery,
} from "../store/conversationStore";

const DEBOUNCE_MS = 300;

const TABS = [
  { key: "ALL", label: "Semua" },
  { key: "OPEN", label: "Terbuka" },
  { key: "PENDING", label: "Pending" },
  { key: "CLOSED", label: "Selesai" },
  { key: "MINE", label: "Milik Saya" },
];

const EMPTY_STATE = {
  ALL:     { Icon: Inbox, text: "Belum ada percakapan" },
  OPEN:    { Icon: MessageCircle, text: "Tidak ada percakapan terbuka" },
  PENDING: { Icon: Clock, text: "Tidak ada percakapan pending" },
  CLOSED:  { Icon: CheckCircle2, text: "Tidak ada percakapan selesai" },
  MINE:    { Icon: User, text: "Belum ada percakapan milik kamu" },
};

// Cocokkan 1 conversation dengan filter + search + toggle "belum dibaca"
// AKTIF SEKARANG. Perlu re-filter di client karena store bersifat
// global/akumulatif (percakapan dari tab lain yang pernah di-fetch tetap
// ada di cache) — lihat komentar di conversationStore.js.
function matches(c, filter, userId, query, onlyUnread) {
  if (!c) return false;
  if (filter === "MINE" && c.assignedToId !== userId) return false;
  if (filter === "OPEN" && c.status !== "OPEN") return false;
  if (filter === "PENDING" && c.status !== "PENDING") return false;
  if (filter === "CLOSED" && c.status !== "RESOLVED") return false;
  if (onlyUnread && !c.unread) return false;
  if (query) {
    const hay = [c.customer?.name, c.customer?.phone, c.groupName]
      .filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

export default function ChatListScreen({ navigation }) {
  const { user, logout } = useAuth();
  const filter = useFilter();
  const search = useConvSearchQuery();
  const orderedIds = useOrderedIds();
  const conversationsById = useConversationStore((s) => s.conversationsById);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [counts, setCounts] = useState({});
  const debounceRef = useRef(null);

  const { isLoading, isRefetching, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useConversations({ filter, search, userId: user?.id });

  // Badge jumlah per tab — dipisah dari list utama (fitur pelengkap, kalau
  // gagal list tetap tampil normal).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.getConversationCounts().then((d) => { if (alive) setCounts(d); }).catch(() => {});
      return () => { alive = false; };
    }, [])
  );

  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedIds.filter((id) => matches(conversationsById[id], filter, user?.id, q, onlyUnread));
  }, [orderedIds, conversationsById, filter, user?.id, search, onlyUnread]);

  function handleSearchChange(v) {
    setSearchInput(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      useConversationStore.getState().setSearch(v);
    }, DEBOUNCE_MS);
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchInput("");
    clearTimeout(debounceRef.current);
    useConversationStore.getState().setSearch("");
  }

  function handleEndReached() {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }

  function openChat(c) {
    const isGroup = c.type === "GROUP";
    navigation.navigate("ChatRoom", {
      conversationId: c.id,
      name: isGroup ? (c.groupName || "Grup WhatsApp") : (c.customer?.name || c.customer?.phone || "Pelanggan"),
      isGroup,
      customerId: c.customerId,
      assignedTo: c.assignedTo?.name || null,
    });
  }

  const empty = EMPTY_STATE[filter] || EMPTY_STATE.ALL;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {searchOpen ? (
          <View style={styles.searchRow}>
            <TextInput
              autoFocus
              style={styles.searchInput}
              placeholder="Cari nama, nomor, atau grup…"
              placeholderTextColor={tokens.color.textMuted}
              value={searchInput}
              onChangeText={handleSearchChange}
            />
            <TouchableOpacity onPress={closeSearch} style={styles.headerIconBtn}>
              <X size={20} color={tokens.color.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Inbox</Text>
              <Text style={styles.subtitle}>{user?.name} · {user?.role === "ADMIN" ? "Admin" : "Sales"}</Text>
            </View>
            <TouchableOpacity onPress={() => setSearchOpen(true)} style={styles.headerIconBtn}>
              <Search size={20} color={tokens.color.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowFilterSheet(true)} style={styles.headerIconBtn}>
              <SlidersHorizontal size={20} color={onlyUnread ? tokens.color.accent : tokens.color.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
            {/* Profil (pengaturan notifikasi, versi app/cek update, logout)
                sekarang tab tersendiri di bottom nav — tombol shortcut lama
                di sini dihapus karena sudah redundan. Logout tetap
                dipertahankan sebagai akses cepat. */}
            <TouchableOpacity
              onPress={() => logout()}
              style={styles.headerIconBtn}
            >
              <LogOut size={20} color={tokens.color.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Tab pill horizontal scrollable */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsWrap}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((t) => {
          const active = filter === t.key;
          const count = counts[
            t.key === "ALL" ? "semua" : t.key === "OPEN" ? "terbuka" :
            t.key === "PENDING" ? "pending" : t.key === "CLOSED" ? "selesai" : "milikSaya"
          ] || 0;
          return (
            <PressableScale
              key={t.key}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => useConversationStore.getState().setFilter(t.key)}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{t.label}</Text>
              {count > 0 && (
                <View style={[styles.pillBadge, active && styles.pillBadgeActive]}>
                  <Text style={[styles.pillBadgeText, active && styles.pillBadgeTextActive]}>{count}</Text>
                </View>
              )}
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Daftar percakapan */}
      {isLoading && visibleIds.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={tokens.color.accent} size="large" />
      ) : visibleIds.length === 0 ? (
        <View style={styles.emptyWrap}>
          <empty.Icon size={36} color={tokens.color.textMuted} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>{empty.text}</Text>
        </View>
      ) : (
        <FlashList
          data={visibleIds}
          keyExtractor={(id) => id}
          renderItem={({ item }) => <ConversationItem id={item} onPress={openChat} />}
          estimatedItemSize={90}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={!!isRefetching} onRefresh={refetch} colors={[tokens.color.accent]} />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={tokens.color.accent} />
            ) : null
          }
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 16 }}
        />
      )}

      {/* Sheet filter tambahan */}
      <Modal visible={showFilterSheet} transparent animationType="fade" onRequestClose={() => setShowFilterSheet(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowFilterSheet(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Filter Tambahan</Text>
            <View style={styles.sheetRow}>
              <Text style={styles.sheetRowText}>Hanya pesan belum dibaca</Text>
              <Switch
                value={onlyUnread}
                onValueChange={setOnlyUnread}
                trackColor={{ false: tokens.color.border, true: tokens.color.accentSoft }}
                thumbColor={onlyUnread ? tokens.color.accent : "#f4f3f4"}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  header: {
    flexDirection: "row", alignItems: "center", backgroundColor: tokens.color.bg,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 4,
  },
  title: { color: tokens.color.textPrimary, fontSize: 24, fontWeight: "700" },
  subtitle: { color: tokens.color.textSecondary, fontSize: 12, marginTop: 2 },
  headerIconBtn: { padding: 8 },
  headerIconText: { fontSize: 18, color: tokens.color.textPrimary },
  searchRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  searchInput: {
    flex: 1, backgroundColor: tokens.color.card, borderRadius: tokens.radius.control,
    paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: tokens.color.textPrimary,
    borderWidth: 1, borderColor: tokens.color.border,
  },
  tabsWrap: { flexGrow: 0, marginBottom: 4 },
  tabsContent: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  pill: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: tokens.radius.chip, backgroundColor: tokens.color.card,
    marginRight: 8, ...tokens.shadow.soft, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  pillActive: { backgroundColor: tokens.color.accent, shadowOpacity: 0.12 },
  pillText: { color: tokens.color.textSecondary, fontWeight: "600", fontSize: 13 },
  pillTextActive: { color: "#fff" },
  pillBadge: {
    marginLeft: 6, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: tokens.color.subtle, alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  pillBadgeActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  pillBadgeText: { color: tokens.color.textSecondary, fontSize: 11, fontWeight: "700" },
  pillBadgeTextActive: { color: "#fff" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: tokens.color.textMuted, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 18, paddingBottom: 28,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 12 },
  sheetRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  sheetRowText: { fontSize: 14, color: tokens.color.textPrimary },
});
