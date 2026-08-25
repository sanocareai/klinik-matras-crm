// InboxScreen (Fase M-B) — desain light-blue: card putih rounded-2xl, tab
// pill biru, search expandable, swipe actions, infinite scroll + real-time.
// Data: cache global conversationStore (Zustand) + useConversations
// (TanStack useInfiniteQuery, cursor pagination) — list yang tampil disaring
// ulang di sini lewat filter/search AKTIF SEKARANG (pola sama dengan
// frontend/src/features/inbox/components/ConversationList/index.jsx).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  RefreshControl, ActivityIndicator, ScrollView, Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlashList } from "@shopify/flash-list";
import { useFocusEffect } from "@react-navigation/native";
import {
  Search, LogOut, Inbox, MessageCircle, MailWarning, Clock, CheckCircle2, User, X, RefreshCw,
  Pin, PinOff, Check, Circle, MessageSquarePlus, MessageCircleWarning, Users, UserX, Timer, Megaphone,
} from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import { lightHaptic } from "../lib/haptics";
import ConversationItem from "../components/ConversationItem";
import PressableScale from "../components/PressableScale";
import ReorderFiltersModal from "../components/ReorderFiltersModal";
import ChatBaruModal from "../components/ChatBaruModal";
import SalesFilterModal from "../components/SalesFilterModal";
import { InboxListSkeleton } from "../components/SkeletonLoader";
import { useConversations, TAG_BROADCAST } from "../hooks/useConversations";
import {
  useConversationStore, useOrderedIds, useFilter, useConvSearchQuery, useSalesFilter,
} from "../store/conversationStore";

// Urutan tab tersimpan per-perangkat (bukan per-akun) — pola sama dengan
// preferensi tema web (localStorage). Diatur lewat ReorderFiltersModal
// (tekan-tahan salah satu tab), bukan drag inline — lihat catatan panjang
// di ReorderFiltersModal.js soal kenapa (ScrollView tab ini sudah punya
// gesture pan sendiri untuk scroll, drag-reorder inline berisiko bentrok
// gesture tanpa perangkat asli untuk diuji langsung).
const TAB_ORDER_KEY = "sano-inbox-tab-order";

function validOrder(parsed, defaultOrder) {
  if (!Array.isArray(parsed)) return null;
  const validKeys = new Set(defaultOrder);
  if (parsed.length !== defaultOrder.length) return null;
  if (!parsed.every((k) => validKeys.has(k))) return null;
  if (new Set(parsed).size !== defaultOrder.length) return null;
  return parsed;
}

const DEBOUNCE_MS = 300;

// "Milik Saya" di depan — filter yang paling sering dipakai sales sendiri
// sebelumnya di ujung, mengharuskan scroll tab tiap buka Inbox.
const TABS = [
  { key: "MINE", label: "Milik Saya" },
  // Paritas dengan web (frontend FilterTabs.jsx) — ditambahkan 25 Agustus
  // 2026, sebelumnya cuma ada di web. Definisi SAMA PERSIS: UNASSIGNED =
  // assignedToId masih kosong (belum ada satu pun sales yang klaim).
  // STALLED = sudah ada sales yang pegang, TAPI pesan terakhir customer
  // sudah >60 menit tanpa balasan (lebih ketat dari UNANSWERED di bawah).
  { key: "UNASSIGNED", label: "Belum Diambil" },
  { key: "STALLED", label: "Menggantung" },
  { key: "ALL", label: "Semua" },
  { key: "UNREAD", label: "Belum Dibaca" },
  // D-031 (20 Agustus 2026) — "Belum Dibalas" BEDA dari "Belum Dibaca":
  // Belum Dibaca = sales belum BUKA chat-nya sama sekali (bisa jadi pesan
  // customer sudah lama, sales cuma belum lihat). Belum Dibalas = pesan
  // TERAKHIR di percakapan itu dari CUSTOMER (arah INBOUND) — sales SUDAH
  // baca tapi belum sempat balas, ini yang paling penting dikejar duluan
  // (definisi sama persis dengan `isUnanswered` yang sudah dipakai badge
  // "Ambil Alih (belum dibalas 1j+)" di web, lihat conversations.js).
  { key: "UNANSWERED", label: "Belum Dibalas" },
  { key: "OPEN", label: "Terbuka" },
  { key: "PENDING", label: "Pending" },
  { key: "CLOSED", label: "Selesai" },
  // Penerima broadcast — paritas dengan web (lihat TAG_BROADCAST di
  // hooks/useConversations.js).
  { key: "BROADCAST", label: "Broadcast" },
];

const EMPTY_STATE = {
  ALL:        { Icon: Inbox, text: "Belum ada percakapan" },
  UNREAD:     { Icon: MailWarning, text: "Tidak ada percakapan belum dibaca" },
  UNANSWERED: { Icon: MessageCircleWarning, text: "Semua percakapan sudah dibalas" },
  OPEN:       { Icon: MessageCircle, text: "Tidak ada percakapan terbuka" },
  PENDING:    { Icon: Clock, text: "Tidak ada percakapan pending" },
  CLOSED:     { Icon: CheckCircle2, text: "Tidak ada percakapan selesai" },
  MINE:       { Icon: User, text: "Belum ada percakapan milik kamu" },
  UNASSIGNED: { Icon: UserX, text: "Tidak ada percakapan belum diambil" },
  STALLED:    { Icon: Timer, text: "Tidak ada percakapan menggantung" },
  BROADCAST:  { Icon: Megaphone, text: "Belum ada penerima broadcast" },
};

// Cocokkan 1 conversation dengan filter + search AKTIF SEKARANG. Perlu
// re-filter di client karena store bersifat global/akumulatif (percakapan
// dari tab lain yang pernah di-fetch tetap ada di cache) — lihat komentar
// di conversationStore.js.
// searchMatchedIds: Set id percakapan yang cocok dengan `query` menurut
// SERVER (GET /conversations?search=, lihat useConversations di bawah) —
// null kalau belum ada hasil (masih fetching) atau query kosong. WAJIB
// dipakai untuk kecocokan teks, BUKAN dihitung ulang di sini dari field
// lokal (nama/nomor/nama grup) seperti versi sebelumnya: server sudah
// mencocokkan ISI PESAN sejak 28 Juli 2026 (backend/src/routes/
// conversations.js), tapi field itu tidak pernah tersimpan di
// conversationsById (cuma metadata percakapan, bukan daftar pesan) —
// menghitung ulang di client cuma bisa mengecek nama/nomor/grup lagi,
// membuat percakapan yang cocok LEWAT ISI PESAN diam-diam hilang dari
// hasil pencarian walau server sudah benar mengembalikannya.
function matches(c, filter, userId, query, searchMatchedIds, salesFilter) {
  if (!c) return false;
  // "Filter per Sales" (fitur baru) MENANG atas MINE — sama urutan prioritas
  // dengan assignedToId di useConversations.js. Begitu salesFilter aktif,
  // MINE tab diabaikan (sudah otomatis dialihkan ke ALL saat filter dipilih,
  // lihat conversationStore.js#setSalesFilter, ini jaring pengaman kedua).
  if (salesFilter) {
    if (c.assignedToId !== salesFilter.id) return false;
  } else if (filter === "MINE" && c.assignedToId !== userId) return false;
  if (filter === "UNASSIGNED" && c.assignedToId) return false;
  // "Menggantung" — assigned, pesan terakhir INBOUND, >60 menit. `isUnanswered`/
  // `unansweredMinutes` datang dari backend (GET /conversations), definisi
  // SAMA PERSIS dengan web (ConversationList/index.jsx#matches).
  if (filter === "STALLED" && !(c.assignedToId && c.isUnanswered && (c.unansweredMinutes ?? 0) >= 60 && c.status !== "RESOLVED")) return false;
  if (filter === "OPEN" && c.status !== "OPEN") return false;
  if (filter === "PENDING" && c.status !== "PENDING") return false;
  if (filter === "CLOSED" && c.status !== "RESOLVED") return false;
  if (filter === "BROADCAST" && !c.customer?.tags?.includes(TAG_BROADCAST)) return false;
  // `isUnanswered` datang dari backend (GET /conversations), dihitung dari
  // arah pesan TERAKHIR — lihat catatan definisi di TABS di atas.
  if (filter === "UNANSWERED" && !c.isUnanswered) return false;
  if (filter === "UNREAD") {
    // BUG YANG DIPERBAIKI: `c.unreadCount ?? (c.unread ? 1 : 0)` SALAH kalau
    // unreadCount sudah terisi ANGKA 0 (bukan null/undefined) — `??` cuma
    // fallback saat null/undefined, jadi 0 tetap 0, bukan ikut fallback ke
    // `c.unread`. Ini kejadian NYATA: swipe manual "Tandai Belum Dibaca"
    // (ConversationItem.js#toggleReadUnread) set unread=true TANPA
    // menaikkan unreadCount (tetap 0 dari sebelumnya sudah dibaca) — badge
    // tab "Belum Dibaca" (dihitung server dari kolom `unread` boolean,
    // lihat GET /conversations/counts) jadi lebih besar dari jumlah baris
    // yang lolos filter client ini (contoh produksi: badge 34, baris
    // tampil cuma 4). Sekarang `unread` boolean jadi sumber kebenaran utama
    // — SAMA seperti definisi server — unreadCount cuma dipakai kalau
    // benar-benar > 0.
    const isUnread = !!c.unread || (c.unreadCount ?? 0) > 0;
    if (!isUnread) return false;
  }
  if (query && !searchMatchedIds?.has(c.id)) return false;
  return true;
}

export default function ChatListScreen({ navigation }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { user, logout } = useAuth();
  const filter = useFilter();
  const salesFilter = useSalesFilter();
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
  const listRef = useRef(null);

  // Urutan tab filter — lihat catatan TAB_ORDER_KEY di atas.
  const defaultTabOrder = useMemo(() => TABS.map((t) => t.key), []);
  const [tabOrder, setTabOrder] = useState(defaultTabOrder);
  const [reorderModalVisible, setReorderModalVisible] = useState(false);
  const [chatBaruVisible, setChatBaruVisible] = useState(false);
  const [salesFilterModalVisible, setSalesFilterModalVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(TAB_ORDER_KEY).then((raw) => {
      if (!raw) return;
      try {
        const valid = validOrder(JSON.parse(raw), defaultTabOrder);
        if (valid) setTabOrder(valid);
      } catch { /* data tersimpan rusak — abaikan, pakai default */ }
    }).catch(() => {});
  }, [defaultTabOrder]);

  function handleChangeTabOrder(next) {
    setTabOrder(next);
    AsyncStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next)).catch(() => {});
  }

  // GAP (fix): dulu tidak ada mode pilih-banyak ala WhatsApp (tap avatar
  // beberapa chat → header berubah jadi bar aksi). Aksi bar SENGAJA dibatasi
  // ke yang SUDAH ada endpoint per-item aman (pin, tandai dibaca) — TIDAK
  // menambah kapabilitas baru (mis. hapus percakapan) yang belum pernah ada
  // & butuh diskusi produk sendiri soal retensi data CRM.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const enterSelection = useCallback((id) => {
    lightHaptic();
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  async function bulkAction(patchFn) {
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => patchFn(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) Alert.alert("Sebagian gagal", `${failed} dari ${ids.length} percakapan gagal diproses.`);
    exitSelection();
  }
  // Pin/unpin massal: kalau SEBAGIAN sudah pin & sebagian belum, aksi
  // menyamakan semua jadi PINNED (lebih intuitif drpd toggle per-item yang
  // hasilnya campur aduk) — sama pola dgn email client umumnya.
  function bulkPin() {
    bulkAction((id) => api.updateConversation(id, { pinned: true }).then(() =>
      useConversationStore.getState().upsertConversation({ id, pinned: true, pinnedAt: new Date().toISOString() })
    ));
  }
  function bulkUnpin() {
    bulkAction((id) => api.updateConversation(id, { pinned: false }).then(() =>
      useConversationStore.getState().upsertConversation({ id, pinned: false, pinnedAt: null })
    ));
  }
  function bulkMarkRead() {
    bulkAction((id) => api.markConversationRead(id).then(() =>
      useConversationStore.getState().upsertConversation({ id, unread: false, unreadCount: 0, isRead: true })
    ));
  }
  function bulkMarkUnread() {
    bulkAction((id) => api.updateConversation(id, { unread: true, isRead: false }).then(() =>
      useConversationStore.getState().upsertConversation({ id, unread: true, isRead: false })
    ));
  }
  // Tombol pin di bar: kalau SEMUA yang dipilih sudah pinned → aksi jadi
  // unpin semua; selain itu (campur/belum ada yang pin) → pin semua.
  const selectedConvs = [...selectedIds].map((id) => conversationsById[id]).filter(Boolean);
  const allSelectedPinned = selectedConvs.length > 0 && selectedConvs.every((c) => c.pinned);

  const { data, isLoading, isError, error, isRefetching, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
    useConversations({ filter, search, userId: user?.id, salesFilterId: salesFilter?.id });

  // Id percakapan yang cocok `search` MENURUT SERVER (termasuk isi pesan) —
  // lihat catatan panjang di matches() kenapa ini tidak dihitung ulang dari
  // field lokal. `data` di sini SELALU hasil query untuk `search` yang
  // SEDANG aktif (queryKey ikut berubah tiap search berubah, lihat
  // useConversations.js), jadi tidak perlu filter tambahan by staleness.
  const searchMatchedIds = useMemo(() => {
    if (!search.trim()) return null;
    return new Set((data?.pages ?? []).flatMap((p) => p?.data ?? []).map((c) => c.id));
  }, [data, search]);

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
    return orderedIds.filter((id) => matches(conversationsById[id], filter, user?.id, q, searchMatchedIds, salesFilter));
  }, [orderedIds, conversationsById, filter, user?.id, search, searchMatchedIds, salesFilter]);

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
  // GAP (fix): selectionMode/selectedIds sengaja MASUK dependency — saat
  // mode pilih aktif, checkmark tiap baris harus ikut update. Ini beda dari
  // openChat (stabil selamanya) — trade-off perf yang disengaja & aman:
  // mode pilih cuma aktif saat user EKSPLISIT lagi memilih (bukan jalur
  // scroll normal sehari-hari yang perf-nya krusial).
  const renderItem = useCallback(({ item }) => (
    <ConversationItem
      id={item}
      onPress={openChat}
      selectionMode={selectionMode}
      selected={selectedIds.has(item)}
      onToggleSelect={toggleSelect}
      onEnterSelection={enterSelection}
    />
  ), [openChat, selectionMode, selectedIds, toggleSelect, enterSelection]);

  const empty = EMPTY_STATE[filter] || EMPTY_STATE.ALL;

  return (
    <View style={styles.container}>
      {/* Header — GAP (fix): bar aksi mode-pilih ala WhatsApp, muncul GANTI
          header biasa selama selectionMode aktif (bukan modal/overlay
          terpisah — sama pola dgn selectionToolbar di ChatScreen.js). */}
      <View style={styles.header}>
        {selectionMode ? (
          <View style={styles.selectionBar}>
            <TouchableOpacity onPress={exitSelection} style={styles.headerIconBtn}>
              <X size={20} color={tokens.color.textPrimary} strokeWidth={2.2} />
            </TouchableOpacity>
            <Text style={styles.selectionCount}>{selectedIds.size} dipilih</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={allSelectedPinned ? bulkUnpin : bulkPin} style={styles.headerIconBtn}>
              {allSelectedPinned
                ? <PinOff size={19} color={tokens.color.textPrimary} strokeWidth={2.2} />
                : <Pin size={19} color={tokens.color.textPrimary} strokeWidth={2.2} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={bulkMarkRead} style={styles.headerIconBtn}>
              <Check size={19} color={tokens.color.textPrimary} strokeWidth={2.2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={bulkMarkUnread} style={styles.headerIconBtn}>
              <Circle size={19} color={tokens.color.textPrimary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
        ) : searchOpen ? (
          <View style={styles.searchRow}>
            <TextInput
              autoFocus
              style={styles.searchInput}
              placeholder="Cari nama, nomor, grup, atau isi pesan…"
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
            {/* Filter per Sales (fitur baru) — pilih siapa pun (bukan cuma
                diri sendiri lewat tab MINE) untuk menyaring daftar percakapan
                ke yang assignedToId-nya orang itu. Ikon jadi warna accent +
                lingkaran soft begitu ada filter aktif, sama pola visual
                dengan MessageSquarePlus di sebelahnya. */}
            <TouchableOpacity onPress={() => setSalesFilterModalVisible(true)} style={styles.headerIconBtn}>
              <Users
                size={20}
                color={salesFilter ? tokens.color.accent : tokens.color.textPrimary}
                strokeWidth={2}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSearchOpen(true)} style={styles.headerIconBtn}>
              <Search size={20} color={tokens.color.textPrimary} strokeWidth={2} />
            </TouchableOpacity>
            {/* Chat baru — ketik nomor langsung, tanpa menunggu pelanggan
                chat duluan. Ditaruh sebelah Search karena keduanya sama-sama
                "mencari orang", bedanya yang satu di dalam CRM dan yang ini
                di luar (nomor yang belum pernah masuk sama sekali). */}
            <TouchableOpacity onPress={() => setChatBaruVisible(true)} style={styles.headerIconBtn}>
              <MessageSquarePlus size={20} color={tokens.color.accent} strokeWidth={2} />
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

      {/* Chip filter per Sales aktif — cuma tampil kalau ada, tap X untuk
          hapus filter (setara memilih "Semua Sales" di modal). */}
      {salesFilter && (
        <View style={styles.salesFilterChipRow}>
          <View style={styles.salesFilterChip}>
            <Users size={13} color={tokens.color.accent} strokeWidth={2.2} />
            <Text style={styles.salesFilterChipText} numberOfLines={1}>
              Sales: {salesFilter.name}
            </Text>
            <TouchableOpacity onPress={() => useConversationStore.getState().setSalesFilter(null)} hitSlop={8}>
              <X size={14} color={tokens.color.accent} strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Tab pill horizontal scrollable */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsWrap}
        contentContainerStyle={styles.tabsContent}
      >
        {tabOrder.map((key) => {
          const t = TABS.find((x) => x.key === key);
          if (!t) return null;
          const active = filter === t.key;
          const count = counts[
            t.key === "ALL" ? "semua" : t.key === "UNREAD" ? "belumDibaca" :
            t.key === "UNANSWERED" ? "belumDibalas" :
            t.key === "OPEN" ? "terbuka" : t.key === "PENDING" ? "pending" :
            t.key === "CLOSED" ? "selesai" :
            t.key === "UNASSIGNED" ? "belumDiambil" : t.key === "STALLED" ? "menggantung" :
            t.key === "BROADCAST" ? "broadcast" : "milikSaya"
          ] || 0;
          return (
            <PressableScale
              key={t.key}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => {
                // FITUR (tambahan): gaya WhatsApp — tab yang SUDAH aktif
                // ditekan lagi → scroll balik ke chat teratas, bukan no-op.
                // Sebelumnya user yang sudah scroll jauh ke bawah cari
                // customer lama harus scroll manual balik ke atas satu-satu.
                if (active) {
                  listRef.current?.scrollToOffset({ offset: 0, animated: true });
                } else {
                  useConversationStore.getState().setFilter(t.key);
                }
              }}
              // Tekan-tahan tab mana pun → buka pengatur urutan (lihat
              // catatan TAB_ORDER_KEY di atas soal kenapa bukan drag inline).
              onLongPress={() => { lightHaptic(); setReorderModalVisible(true); }}
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

      <ReorderFiltersModal
        visible={reorderModalVisible}
        tabs={TABS}
        order={tabOrder}
        onChangeOrder={handleChangeTabOrder}
        onClose={() => setReorderModalVisible(false)}
      />

      <SalesFilterModal
        visible={salesFilterModalVisible}
        selectedId={salesFilter?.id}
        onClose={() => setSalesFilterModalVisible(false)}
        onSelect={(u) => useConversationStore.getState().setSalesFilter(u ? { id: u.id, name: u.name } : null)}
      />

      {/* Setelah percakapan berhasil dibuat/ditemukan, langsung dibuka —
          sama seperti perilaku openChat dari daftar. Nama diambil dari
          respons backend (bisa dari WhatsApp kalau kontak baru, atau nama
          yang sudah ada di CRM kalau nomornya sudah dikenal). */}
      <ChatBaruModal
        visible={chatBaruVisible}
        onClose={() => setChatBaruVisible(false)}
        onJadi={(hasil) => {
          navigation.navigate("ChatRoom", {
            conversationId: hasil.conversationId,
            name: hasil.nama || hasil.nomor || "Pelanggan",
            isGroup: false,
            customerId: hasil.customerId,
            assignedTo: null,
          });
        }}
      />

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
          <Text style={styles.emptyText}>
            {salesFilter ? `Tidak ada percakapan milik ${salesFilter.name}` : empty.text}
          </Text>
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={visibleIds}
          keyExtractor={(id) => id}
          renderItem={renderItem}
          // BUG (fix): estimatedItemSize dulu diset di sini — prop ini SUDAH
          // TIDAK ADA di @shopify/flash-list v2 API sama sekali (v2 pakai
          // RecyclerView baru arsitektur yang mengukur cell otomatis/real,
          // lihat audit yang sama di ChatScreen.js), jadi selama ini
          // diam-diam diabaikan, dihapus supaya tidak menyesatkan pembaca.
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
  selectionBar: { flex: 1, flexDirection: "row", alignItems: "center" },
  selectionCount: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginLeft: 4 },
  headerIconText: { fontSize: 18, color: tokens.color.textPrimary },
  searchRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  searchInput: {
    flex: 1, backgroundColor: tokens.color.card, borderRadius: tokens.radius.control,
    paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, color: tokens.color.textPrimary,
    borderWidth: 1, borderColor: tokens.color.border,
  },
  salesFilterChipRow: { paddingHorizontal: 16, marginBottom: 8 },
  salesFilterChip: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6,
    backgroundColor: tokens.color.accentSoft, borderRadius: tokens.radius.chip,
    paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%",
  },
  salesFilterChipText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent, flexShrink: 1 },
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
