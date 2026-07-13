// Tab Pelanggan — list customer + search (Fase M5.5-B), diperluas M5.5-D:
// filter pipeline stage bergaya chip + view "Pipeline Board" (kanban mini).
// ⚠️ GET /customers TIDAK paginated di backend (balikin array PENUH hasil
// search+salesId, tanpa filter stage — lihat catatan di api.js#getCustomers).
// Ini dimanfaatkan: SATU fetch dipakai utk list, count per stage, DAN board
// — semua difilter/dikelompokkan CLIENT-SIDE dari array yang sudah LENGKAP
// (bukan dari subset ter-paginate, jadi count-nya akurat), baru di-WINDOWING
// per tampilan (list: visibleCount, board: per-kolom) demi performa render.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, FlatList, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlashList } from "@shopify/flash-list";
import { Search, MapPin, Users as UsersIcon, ChevronDown, LayoutGrid, List as ListIcon } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { stageColors } from "../theme";
import { formatRupiah } from "../utils/format";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";
import PipelineBoard from "../components/PipelineBoard";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;
const VIEW_MODE_KEY = "pelangganViewMode"; // "list" | "board" — persist AsyncStorage

// Label pipeline KHUSUS layar ini (chip/board) — beda dari stageLabels
// global di theme.js (dipakai CustomerProfileContent.js pipeline-pill
// editor, TIDAK diubah supaya tidak ada efek samping di layar lain). Warna
// TETAP reuse stageColors global (konsisten dengan badge stage yang sudah
// dipakai di mana-mana).
const STAGE_ORDER = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
const PIPELINE_LABELS = {
  LEAD: "Lead", QUALIFIED: "Prospek", QUOTED: "Offers/Negosiasi", WON: "Berhasil", LOST: "Gagal",
};
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
const CustomerRow = memo(function CustomerRow({ customer, onPress }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const stage = customer.pipelineStage;
  const stageColor = stageColors[stage] || tokens.color.textMuted;
  return (
    <PressableScale style={styles.row} onPress={onPress}>
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
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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

  // Daftar sales utk picker — role SALES saja (ADMIN tidak "menangani" chat
  // sebagai sales), sama pola exclude-ADMIN yang dipakai cs-performance.
  useEffect(() => {
    api.getUsers().then((list) => setSalesUsers((list || []).filter((u) => u.role !== "ADMIN"))).catch(() => {});
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const params = {};
      if (search) params.search = search;
      if (salesId) params.salesId = salesId;
      const data = await api.getCustomers(params);
      setCustomers(data);
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, salesId]);

  useEffect(() => { load(); }, [load]);

  function handleSearchChange(v) {
    setSearchInput(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(v.trim()), DEBOUNCE_MS);
  }

  function handleRefresh() {
    setRefreshing(true);
    load(true);
  }

  function handleEndReached() {
    setVisibleCount((v) => Math.min(v + PAGE_SIZE, filteredByStage.length));
  }

  // useCallback — dipakai closure renderItem (list) & PipelineBoard (board),
  // harus stabil supaya CustomerRow/PipelineCard.memo() efektif (lihat
  // catatan sama di PipelineBoard.js).
  const openDetail = useCallback((c) => {
    navigation.navigate("CustomerDetail", { customerId: c.id, name: c.name, phone: c.phone });
  }, [navigation]);

  // Count per stage — DARI ARRAY PENUH hasil search+salesId (bukan dari
  // subset ter-windowing/ter-paginate), jadi selalu akurat & independen
  // dari stage tab mana yang sedang aktif.
  const stageCounts = useMemo(() => {
    const counts = { ALL: customers.length };
    STAGE_ORDER.forEach((s) => { counts[s] = 0; });
    customers.forEach((c) => {
      const s = c.pipelineStage || "LEAD";
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [customers]);

  const filteredByStage = useMemo(() => {
    if (stageFilter === "ALL") return customers;
    return customers.filter((c) => (c.pipelineStage || "LEAD") === stageFilter);
  }, [customers, stageFilter]);

  const customersByStage = useMemo(() => {
    const grouped = {};
    STAGE_ORDER.forEach((s) => { grouped[s] = []; });
    customers.forEach((c) => {
      const s = c.pipelineStage || "LEAD";
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(c);
    });
    return grouped;
  }, [customers]);

  // Pindahkan pelanggan ke stage lain dari Pipeline Board (long-press card)
  // — optimistic update ke state lokal, revert + alert kalau gagal. Endpoint
  // SAMA yang dipakai CustomerProfileContent.js (PATCH /customers/:id).
  const handleMoveStage = useCallback(async (customer, newStage) => {
    const prevStage = customer.pipelineStage;
    setCustomers((list) => list.map((c) => (c.id === customer.id ? { ...c, pipelineStage: newStage } : c)));
    try {
      await api.updateCustomer(customer.id, { pipelineStage: newStage });
    } catch (err) {
      setCustomers((list) => list.map((c) => (c.id === customer.id ? { ...c, pipelineStage: prevStage } : c)));
      throw err;
    }
  }, []);

  // useCallback — renderItem list utama, closure atas openDetail (sudah
  // stabil di atas) supaya CustomerRow.memo() efektif saat scroll panjang.
  const renderCustomerRow = useCallback(({ item }) => (
    <CustomerRow customer={item} onPress={() => openDetail(item)} />
  ), [openDetail]);

  const visible = filteredByStage.slice(0, visibleCount);
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

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)}
        </View>
      ) : errorMsg ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Gagal memuat pelanggan: {errorMsg}</Text>
        </View>
      ) : viewMode === "board" ? (
        <PipelineBoard
          customersByStage={customersByStage}
          stageOrder={STAGE_ORDER}
          pipelineLabels={PIPELINE_LABELS}
          pipelineColors={stageColors}
          onCardPress={openDetail}
          onMoveStage={handleMoveStage}
        />
      ) : visible.length === 0 ? (
        <View style={styles.emptyWrap}>
          <UsersIcon size={36} color={tokens.color.textMuted} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>
            {search ? "Tidak ada pelanggan cocok pencarian" : "Belum ada pelanggan"}
          </Text>
        </View>
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(c) => c.id}
          renderItem={renderCustomerRow}
          estimatedItemSize={82}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[tokens.color.accent]} />
          }
          ListFooterComponent={
            visibleCount < filteredByStage.length ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={tokens.color.accent} />
            ) : null
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
