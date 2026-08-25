// Tab Pelanggan — list customer + search (Fase M5.5-B), diperluas M5.5-D:
// filter pipeline stage bergaya chip + view "Pipeline Board" (kanban mini).
//
// Revisi 28 Jul 2026 — BUG YANG DIPERBAIKI: layar ini SEBELUMNYA selalu
// menarik SELURUH daftar pelanggan (GET /customers TANPA ?page=, jalur lama
// yang balikin array polos penuh) setiap kali dibuka — diukur langsung di
// produksi: 1.442.029 bytes utk ~1.320 pelanggan, 50x lebih besar dari
// respons web yang sudah dipaginasi (28.728 bytes utk 25 baris). Di 4G ini
// bisa beberapa detik nunggu tiap buka tab Pelanggan, dan makin lambat
// seiring pelanggan bertambah.
//
// Sekarang split 2 jalur data:
// - LIST VIEW → paginasi SUNGGUHAN ke server (?page=&limit=), infinite
//   scroll nambah halaman, filter search/sales/stage dikirim ke server
//   (backend sudah dukung ini dari revisi Customers.jsx web sebelumnya).
//   Trade-off yang disengaja: pindah tab stage sekarang butuh 1 request
//   baru (dulu instan karena SEMUA data sudah ada di memori) — itu memang
//   harga dari tidak lagi menarik semuanya sekaligus.
// - BOARD VIEW (kanban) → tetap butuh SEMUA pelanggan per stage (kolom
//   kanban tidak masuk akal kalau cuma sebagian), jadi tetap pakai jalur
//   lama (tanpa ?page=) TAPI cuma di-fetch LAZY saat user benar-benar
//   pindah ke Board — bukan otomatis ikut ke-fetch tiap buka tab Pelanggan
//   seperti sebelumnya (yang mana itu pemborosan ekstra untuk mayoritas
//   sales yang cuma pakai List view).
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, FlatList, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlashList } from "@shopify/flash-list";
import { Search, MapPin, Users as UsersIcon, ChevronDown, LayoutGrid, List as ListIcon } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { stageColors, stageLabels } from "../theme";
import { formatRupiah } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";
import PipelineBoard from "../components/PipelineBoard";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;
const VIEW_MODE_KEY = "pelangganViewMode"; // "list" | "board" — persist AsyncStorage

// Konsolidasi 24 Agustus 2026 (restrukturisasi pipeline 7→4): SEBELUMNYA
// layar ini punya salinan label sendiri (STAGE_ORDER/PIPELINE_LABELS)
// terpisah dari stageLabels global di theme.js, sengaja dibiarkan drift
// supaya tidak ada efek samping ke layar lain. Sekarang jumlah stage jauh
// lebih kecil (4, bukan 7) jadi risiko itu juga mengecil — dikonsolidasi ke
// satu sumber kebenaran (theme.js), sama pola dengan web (utils/format.js).
const STAGE_ORDER = Object.keys(stageLabels);
const PIPELINE_LABELS = stageLabels;
const STAGE_TABS = [{ key: "ALL", label: "Semua" }, ...STAGE_ORDER.map((s) => ({ key: s, label: PIPELINE_LABELS[s] }))];

function daysSinceChat(lastMessageAt) {
  if (!lastMessageAt) return "Belum pernah chat";
  const days = Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 86_400_000);
  if (days <= 0) return "Chat hari ini";
  if (days === 1) return "1 hari sejak chat terakhir";
  return `${days} hari sejak chat terakhir`;
}

// memo — FlashList recycle sel lain dengan prop baru terus-menerus saat
// scroll; tanpa memo tiap recycle re-render walau data customer sama.
// BUG (fix): renderCustomerRow di bawah SEBELUMNYA bungkus onPress jadi
// closure inline (`onPress={() => openDetail(item)}`) — closure itu SELALU
// reference baru tiap kali FlashList memanggil renderItem, walau
// openDetail-nya sendiri sudah stabil lewat useCallback. Props CustomerRow
// jadi tidak pernah shallow-equal antar render, memo() di sini jadi PERCUMA
// (persis kontradiksi sama komentar "harus stabil" yang sudah ada di
// renderCustomerRow). Fix: terima `onPress` MENTAH (openDetail langsung,
// tanpa dibungkus), closure `() => onPress(customer)` dipindah ke DALAM
// komponen memo ini — closure baru di sini tidak masalah karena cuma
// dibuat ulang kalau CustomerRow SENDIRI re-render (yang berarti memo sudah
// memutuskan render ulang memang perlu).
const CustomerRow = memo(function CustomerRow({ customer, onPress }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const stage = customer.pipelineStage;
  const stageColor = stageColors[stage] || tokens.color.textMuted;
  return (
    <PressableScale style={styles.row} onPress={() => onPress(customer)}>
      <Avatar name={customer.name || customer.phone} size={44} avatarUrl={customer.profilePictureUrl} />
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>{customer.name || "Tanpa nama"}</Text>
        <Text style={styles.phone} numberOfLines={1}>{customer.phone ? "+" + customer.phone : "-"}</Text>
        {customer.city ? (
          <View style={styles.cityRow}>
            <MapPin size={11} color={tokens.color.textMuted} strokeWidth={2} style={styles.cityIcon} />
            <Text style={styles.city} numberOfLines={1}>{customer.city}</Text>
          </View>
        ) : null}
        <Text style={styles.followUpCue} numberOfLines={1}>{daysSinceChat(customer.lastMessageAt)}</Text>
      </View>
      {customer.orderValue > 0 && (
        <Text style={styles.rowValue} numberOfLines={1}>{formatRupiah(customer.orderValue)}</Text>
      )}
      {stage ? (
        <View style={[styles.stageBadge, { backgroundColor: stageColor + "22" }]}>
          <Text style={[styles.stageBadgeText, { color: stageColor }]}>{PIPELINE_LABELS[stage] || stage}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
});

function SkeletonRow() {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.row}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.rowBody}>
        <View style={[styles.skeletonBar, { width: "50%" }]} />
        <View style={[styles.skeletonBar, { width: "35%", marginTop: 6 }]} />
      </View>
    </View>
  );
}

export default function PelangganScreen({ navigation }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // ── List view: paginasi sungguhan ke server ──
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stageCounts, setStageCounts] = useState({ ALL: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // ── Board view: tetap butuh SEMUA data per stage, tapi lazy-load
  // (cuma fetch begitu user benar-benar pindah ke Board) ──
  const [boardCustomers, setBoardCustomers] = useState([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState(null);
  const [boardLoadedOnce, setBoardLoadedOnce] = useState(false);

  const [salesUsers, setSalesUsers] = useState([]);
  const [stageFilter, setStageFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState("list"); // "list" | "board"
  // Definisi kepemilikan: conversation yang DITANGANI sales itu
  // (Conversation.assignedToId — sama seperti definisi take-over), BUKAN
  // Customer.assignedSalesId (kepemilikan lead/pipeline) — lihat catatan di
  // backend/src/routes/customers.js#salesId. Default: role SALES →
  // dirinya sendiri, role ADMIN → Semua (null).
  const [salesId, setSalesId] = useState(user?.role === "SALES" ? user.id : null);
  const [showSalesPicker, setShowSalesPicker] = useState(false);
  const debounceRef = useRef(null);

  // Preferensi view (list/board) persist AsyncStorage — dibaca sekali saat mount.
  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then((v) => {
      if (v === "board" || v === "list") setViewMode(v);
    }).catch(() => {});
  }, []);

  function toggleViewMode() {
    setViewMode((prev) => {
      const next = prev === "list" ? "board" : "list";
      AsyncStorage.setItem(VIEW_MODE_KEY, next).catch(() => {});
      return next;
    });
  }

  // Daftar sales utk picker — role SALES lewat kolom lama ATAU peran
  // tambahan SALES (D-010, mis. admin/leader yang kadang turun tangan
  // jualan sendiri — lihat Pengguna & Peran). GET /users sudah balikin
  // array `roles` gabungan (lihat backend/src/routes/users.js), jadi
  // dicek dari situ, bukan cuma exclude-ADMIN pola lama.
  useEffect(() => {
    api.getUsers().then((list) => setSalesUsers((list || []).filter((u) =>
      (Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role]).includes("SALES")
    ))).catch(() => {});
  }, []);

  // Muat 1 halaman List view. targetPage dikirim eksplisit (bukan dari state
  // `page`) supaya tidak ada race antara "halaman berikutnya" vs "reset ke
  // halaman 1 karena filter berubah" saling timpa.
  const loadPage = useCallback(async (targetPage, { append = false, silent = false } = {}) => {
    if (append) setLoadingMore(true);
    else if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const params = { page: targetPage, limit: PAGE_SIZE };
      if (search) params.search = search;
      if (salesId) params.salesId = salesId;
      if (stageFilter !== "ALL") params.stage = stageFilter;
      const data = await api.getCustomers(params);
      setItems((prev) => (append ? [...prev, ...(data.items || [])] : (data.items || [])));
      setTotal(data.total || 0);
      setPage(targetPage);
      // stageCounts dari SERVER (agregat cepat, bukan dihitung dari array
      // penuh di client seperti sebelumnya) — tetap akurat walau List view
      // cuma memuat sebagian data.
      if (data.stageCounts) setStageCounts(data.stageCounts);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [search, salesId, stageFilter]);

  // Filter berubah (search/sales/stage) → reset ke halaman 1, BUKAN nambah
  // halaman — kalau tidak, ganti tab stage akan nge-append ke list lama.
  useEffect(() => { loadPage(1); }, [loadPage]);

  // Board view — full fetch (jalur lama TANPA ?page=) HANYA saat viewMode
  // benar-benar "board", supaya List view (mayoritas pemakaian) tidak ikut
  // menanggung biaya menarik semua data.
  const loadBoard = useCallback(async (silent = false) => {
    if (!silent) setBoardLoading(true);
    setBoardError(null);
    try {
      const params = {};
      if (search) params.search = search;
      if (salesId) params.salesId = salesId;
      const data = await api.getCustomers(params); // TANPA page= → array penuh
      setBoardCustomers(data || []);
    } catch (err) {
      setBoardError(err.message);
    } finally {
      setBoardLoading(false);
      setBoardLoadedOnce(true);
    }
  }, [search, salesId]);

  useEffect(() => {
    if (viewMode === "board") loadBoard();
  }, [viewMode, loadBoard]);

  function handleSearchChange(v) {
    setSearchInput(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(v.trim()), DEBOUNCE_MS);
  }

  function handleRefresh() {
    setRefreshing(true);
    if (viewMode === "board") loadBoard(true);
    else loadPage(1, { silent: true });
  }

  function handleEndReached() {
    if (loadingMore || loading || items.length >= total) return;
    loadPage(page + 1, { append: true });
  }

  // useCallback — dipakai closure renderItem (list) & PipelineBoard (board),
  // harus stabil supaya CustomerRow/PipelineCard.memo() efektif (lihat
  // catatan sama di PipelineBoard.js).
  const openDetail = useCallback((c) => {
    navigation.navigate("CustomerDetail", { customerId: c.id, name: c.name, phone: c.phone });
  }, [navigation]);

  // Board dikelompokkan dari boardCustomers (full fetch lazy), BUKAN dari
  // `items` (halaman List view yang sengaja cuma sebagian).
  const customersByStage = useMemo(() => {
    const grouped = {};
    STAGE_ORDER.forEach((s) => { grouped[s] = []; });
    boardCustomers.forEach((c) => {
      const s = c.pipelineStage || "NEW";
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(c);
    });
    return grouped;
  }, [boardCustomers]);

  // Pindahkan pelanggan ke stage lain dari Pipeline Board (long-press card)
  // — optimistic update ke state lokal (boardCustomers), revert + alert
  // kalau gagal. Endpoint SAMA yang dipakai CustomerProfileContent.js
  // (PATCH /customers/:id).
  const handleMoveStage = useCallback(async (customer, newStage) => {
    const prevStage = customer.pipelineStage;
    setBoardCustomers((list) => list.map((c) => (c.id === customer.id ? { ...c, pipelineStage: newStage } : c)));
    try {
      await api.updateCustomer(customer.id, { pipelineStage: newStage });
    } catch (err) {
      setBoardCustomers((list) => list.map((c) => (c.id === customer.id ? { ...c, pipelineStage: prevStage } : c)));
      throw err;
    }
  }, []);

  // useCallback — renderItem list utama, closure atas openDetail (sudah
  // stabil di atas) supaya CustomerRow.memo() efektif saat scroll panjang.
  // onPress dioper MENTAH (bukan dibungkus arrow di sini) — lihat catatan
  // panjang di CustomerRow di atas kenapa itu penting.
  const renderCustomerRow = useCallback(({ item }) => (
    <CustomerRow customer={item} onPress={openDetail} />
  ), [openDetail]);

  const selectedSalesName = salesId ? (salesUsers.find((u) => u.id === salesId)?.name || "…") : "Semua";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pelanggan</Text>
        <TouchableOpacity style={styles.viewToggleBtn} onPress={toggleViewMode}>
          {viewMode === "list" ? (
            <LayoutGrid size={20} color={tokens.color.textPrimary} strokeWidth={2} />
          ) : (
            <ListIcon size={20} color={tokens.color.textPrimary} strokeWidth={2} />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={tokens.color.textMuted} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari nama atau nomor…"
          placeholderTextColor={tokens.color.textMuted}
          value={searchInput}
          onChangeText={handleSearchChange}
        />
      </View>

      {/* Filter Sales — kepemilikan berdasar conversation yang ditangani
          (assignedToId, definisi take-over), BUKAN pipeline/lead. */}
      <TouchableOpacity style={styles.salesFilterPill} onPress={() => setShowSalesPicker(true)}>
        <Text style={styles.salesFilterLabel}>Sales: </Text>
        <Text style={styles.salesFilterValue} numberOfLines={1}>{selectedSalesName}</Text>
        <ChevronDown size={14} color={tokens.color.textSecondary} strokeWidth={2} style={{ marginLeft: 4 }} />
      </TouchableOpacity>

      {/* Chip pipeline stage — cuma relevan di list view (board sudah
          menampilkan semua stage sebagai kolom sekaligus). */}
      {viewMode === "list" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsWrap}
          contentContainerStyle={styles.tabsContent}
        >
          {STAGE_TABS.map((t) => {
            const active = stageFilter === t.key;
            const color = t.key === "ALL" ? tokens.color.accent : (stageColors[t.key] || tokens.color.textMuted);
            const count = stageCounts[t.key] || 0;
            return (
              <PressableScale
                key={t.key}
                style={[styles.stageChip, active && { backgroundColor: color + "22", borderColor: color }]}
                onPress={() => setStageFilter(t.key)}
              >
                <Text style={[styles.stageChipText, active && { color }]}>{t.label} ({count})</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      )}

      {viewMode === "board" ? (
        boardLoading && !boardLoadedOnce ? (
          <View style={styles.list}>
            {Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)}
          </View>
        ) : boardError ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>Gagal memuat pelanggan: {boardError}</Text>
          </View>
        ) : (
          <PipelineBoard
            customersByStage={customersByStage}
            stageOrder={STAGE_ORDER}
            pipelineLabels={PIPELINE_LABELS}
            pipelineColors={stageColors}
            onCardPress={openDetail}
            onMoveStage={handleMoveStage}
          />
        )
      ) : loading ? (
        <View style={styles.list}>
          {Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)}
        </View>
      ) : errorMsg ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Gagal memuat pelanggan: {errorMsg}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <UsersIcon size={36} color={tokens.color.textMuted} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>
            {search ? "Tidak ada pelanggan cocok pencarian" : "Belum ada pelanggan"}
          </Text>
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(c) => c.id}
          renderItem={renderCustomerRow}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[tokens.color.accent]} />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} color={tokens.color.accent} /> : null
          }
          contentContainerStyle={{ paddingBottom: 90 }}
        />
      )}

      <Modal visible={showSalesPicker} transparent animationType="slide" onRequestClose={() => setShowSalesPicker(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setShowSalesPicker(false)}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Filter Sales</Text>
            <FlatList
              data={[{ id: null, name: "Semua" }, ...salesUsers]}
              keyExtractor={(item) => item.id || "all"}
              style={{ maxHeight: 360 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerItem}
                  onPress={() => { setSalesId(item.id); setShowSalesPicker(false); }}
                >
                  <Avatar name={item.name} avatarUrl={item.avatarUrl} size={26} />
                  <Text style={[styles.pickerItemText, item.id === salesId && styles.pickerItemTextActive, { marginLeft: 10 }]}>
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  title: { fontSize: 24, fontWeight: "700", color: tokens.color.textPrimary },
  viewToggleBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 8, backgroundColor: tokens.color.card,
    borderRadius: tokens.radius.pill, paddingHorizontal: 14, paddingVertical: 10,
    ...tokens.shadow.soft, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 14, color: tokens.color.textPrimary },
  salesFilterPill: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start",
    marginHorizontal: 16, marginBottom: 10, backgroundColor: tokens.color.card,
    borderRadius: tokens.radius.chip, paddingHorizontal: 14, paddingVertical: 8,
    ...tokens.shadow.soft, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  salesFilterLabel: { fontSize: 12, color: tokens.color.textMuted, fontWeight: "600" },
  salesFilterValue: { fontSize: 12, color: tokens.color.textPrimary, fontWeight: "700", maxWidth: 140 },
  tabsWrap: { flexGrow: 0, marginBottom: 8 },
  tabsContent: { paddingHorizontal: 16, gap: 8 },
  stageChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: tokens.radius.chip,
    backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border,
  },
  stageChipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  list: { paddingHorizontal: 0 },
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: tokens.color.card, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.subtle,
  },
  rowBody: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: "600", color: tokens.color.textPrimary },
  phone: { fontSize: 13, color: tokens.color.textSecondary, marginTop: 1 },
  cityRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  cityIcon: { marginRight: 3 },
  city: { fontSize: 11, color: tokens.color.textMuted },
  followUpCue: { fontSize: 11, color: tokens.color.textMuted, marginTop: 2 },
  rowValue: { fontSize: 12, fontWeight: "700", color: tokens.color.success, marginLeft: 8, maxWidth: 90 },
  stageBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
  stageBadgeText: { fontSize: 10, fontWeight: "700" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80, paddingHorizontal: 24 },
  emptyText: { color: tokens.color.textMuted, fontSize: 14, textAlign: "center" },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.color.subtle },
  skeletonBar: { height: 11, borderRadius: 6, backgroundColor: tokens.color.subtle },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70%" },
  pickerTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  pickerItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  pickerItemText: { fontSize: 14, color: tokens.color.textPrimary },
  pickerItemTextActive: { color: tokens.color.accent, fontWeight: "700" },
  });
}
