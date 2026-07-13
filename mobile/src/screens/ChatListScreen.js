// InboxScreen (Fase M-B) — desain light-blue: card putih rounded-2xl, tab
// pill biru, search expandable, swipe actions, infinite scroll + real-time.
// Data: cache global conversationStore (Zustand) + useConversations
// (TanStack useInfiniteQuery, cursor pagination) — list yang tampil disaring
// ulang di sini lewat filter/search AKTIF SEKARANG (pola sama dengan
// frontend/src/features/inbox/components/ConversationList/index.jsx).
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, ActivityIndicator, ScrollView,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect } from "@react-navigation/native";
import { Search, LogOut, Inbox, MessageCircle, MailWarning, Clock, CheckCircle2, User, X, RefreshCw } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import ConversationItem from "../components/ConversationItem";
import PressableScale from "../components/PressableScale";
import { InboxListSkeleton } from "../components/SkeletonLoader";
import { useConversations } from "../hooks/useConversations";
import {
  useConversationStore, useOrderedIds, useFilter, useConvSearchQuery,
} from "../store/conversationStore";

const DEBOUNCE_MS = 300;

const TABS = [
  { key: "ALL", label: "Semua" },
  { key: "UNREAD", label: "Belum Dibaca" },
  { key: "OPEN", label: "Terbuka" },
  { key: "PENDING", label: "Pending" },
  { key: "CLOSED", label: "Selesai" },
  { key: "MINE", label: "Milik Saya" },
];

const EMPTY_STATE = {
  ALL:     { Icon: Inbox, text: "Belum ada percakapan" },
  UNREAD:  { Icon: MailWarning, text: "Tidak ada percakapan belum dibaca" },
  OPEN:    { Icon: MessageCircle, text: "Tidak ada percakapan terbuka" },
  PENDING: { Icon: Clock, text: "Tidak ada percakapan pending" },
  CLOSED:  { Icon: CheckCircle2, text: "Tidak ada percakapan selesai" },
  MINE:    { Icon: User, text: "Belum ada percakapan milik kamu" },
};

// Cocokkan 1 conversation dengan filter + search AKTIF SEKARANG. Perlu
// re-filter di client karena store bersifat global/akumulatif (percakapan
// dari tab lain yang pernah di-fetch tetap ada di cache) — lihat komentar
// di conversationStore.js.
function matches(c, filter, userId, query) {
  if (!c) return false;
  if (filter === "MINE" && c.assignedToId !== userId) return false;
  if (filter === "OPEN" && c.status !== "OPEN") return false;
  if (filter === "PENDING" && c.status !== "PENDING") return false;
  if (filter === "CLOSED" && c.status !== "RESOLVED") return false;
  if (filter === "UNREAD") {
    const unreadCount = c.unreadCount ?? (c.unread ? 1 : 0);
    if (unreadCount <= 0) return false;
  }
  if (query) {
    const hay = [c.customer?.name, c.customer?.phone, c.groupName]
      .filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

export default function ChatListScreen({ navigation }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { user, logout } = useAuth();
  const filter = useFilter();
  const search = useConvSearchQuery();
  const orderedIds = useOrderedIds();
  // Subscribe ke SELURUH conversationsById (bukan granular) memang tidak
  // terhindarkan di sini — visibleIds di bawah butuh filter/search lintas
  // SEMUA percakapan (nama/nomor/status), jadi ChatListScreen wajib tahu
  // begitu ada perubahan di mana pun. Ini AMAN untuk perf list selama
  // renderItem/openChat stabil (lihat useCallback di bawah) — re-render
  // ChatListScreen sendiri (header/tab) murah, yang mahal adalah kalau ikut
  // memaksa render ulang SEMUA ConversationItem yang kelihatan, itu yang
  // dicegah lewat stabilitas closure, bukan lewat selector granular di sini.
  const conversationsById = useConversationStore((s) => s.conversationsById);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [counts, setCounts] = useState({});
  const debounceRef = useRef(null);

  const { isLoading, isError, error, isRefetching, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
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
    return orderedIds.filter((id) => matches(conversationsById[id], filter, user?.id, q));
  }, [orderedIds, conversationsById, filter, user?.id, search]);

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

  // useCallback (bukan function declaration biasa) — ChatListScreen re-render
  // SERING (tiap keystroke search, tiap tab count refresh, dst). Kalau
  // openChat dibuat ulang tiap render, renderItem di bawah (yang menutup
  // openChat) juga berubah reference tiap render, lalu SETIAP ConversationItem
  // yang lagi kelihatan di layar ikut re-render (memo() jadi percuma karena
  // prop onPress-nya selalu "baru") walau data conversation-nya sendiri tidak
  // berubah — ini penyebab utama lag scroll Inbox.
  const openChat = useCallback((c) => {
    const isGroup = c.type === "GROUP";
    navigation.navigate("ChatRoom", {
      conversationId: c.id,
      name: isGroup ? (c.groupName || "Grup WhatsApp") : (c.customer?.name || c.customer?.phone || "Pelanggan"),
      isGroup,
      customerId: c.customerId,
      assignedTo: c.assignedTo?.name || null,
    });
  }, [navigation]);

  // renderItem JUGA harus stabil untuk alasan yang sama — FlashList
  // memanggil ulang fungsi ini setiap kali komponen induk re-render, jadi
  // kalau bukan useCallback, closure baru dibuat tiap kali walau openChat
  // sendiri sudah stabil.
  const renderItem = useCallback(({ item }) => (
    <ConversationItem id={item} onPress={openChat} />
  ), [openChat]);

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
            t.key === "ALL" ? "semua" : t.key === "UNREAD" ? "belumDibaca" :
            t.key === "OPEN" ? "terbuka" : t.key === "PENDING" ? "pending" :
            t.key === "CLOSED" ? "selesai" : "milikSaya"
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
        <InboxListSkeleton />
      ) : isError && visibleIds.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MailWarning size={36} color={tokens.color.danger} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>Gagal memuat percakapan</Text>
          <Text style={styles.errorDetail} numberOfLines={2}>{error?.message}</Text>
          <PressableScale style={styles.retryBtn} onPress={() => refetch()}>
            <RefreshCw size={14} color="#fff" strokeWidth={2.2} style={{ marginRight: 6 }} />
            <Text style={styles.retryBtnText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : visibleIds.length === 0 ? (
        <View style={styles.emptyWrap}>
          <empty.Icon size={36} color={tokens.color.textMuted} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>{empty.text}</Text>
        </View>
      ) : (
        <FlashList
          data={visibleIds}
          keyExtractor={(id) => id}
          renderItem={renderItem}
          // Diukur dari styles ConversationItem.js, bukan tebakan: card
          // paddingVertical 13*2=26 + avatar 48 (elemen tertinggi tanpa badge
          // session) = 74, ATAU (kalau ada badgesRow CS-1/CS-2 — sessionLabel
          // terisi untuk mayoritas percakapan aktif di setup multi-session
          // ini) body text ~62 + padding 26 = 88, + hairline border ~1.
          // 86 = titik tengah realistis antara kedua kasus itu.
          estimatedItemSize={86}
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
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
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
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { color: tokens.color.textMuted, fontSize: 14, textAlign: "center" },
  errorDetail: { color: tokens.color.textMuted, fontSize: 12, marginTop: 4, textAlign: "center" },
  retryBtn: {
    flexDirection: "row", alignItems: "center", backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: 16,
  },
  retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  });
}
