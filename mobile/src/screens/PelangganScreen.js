// Tab Pelanggan — list customer + search (Fase M5.5-B).
// ⚠️ GET /customers TIDAK paginated di backend (balikin array penuh) —
// lihat catatan di api.js#getCustomers. "Infinite scroll" di sini jadi
// WINDOWING client-side atas array penuh hasil search (pola sama dengan
// windowing pesan di ChatScreen.js), bukan cursor pagination server asli.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, FlatList,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Search, MapPin, Users as UsersIcon, ChevronDown } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { stageColors, stageLabels } from "../theme";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

function CustomerRow({ customer, onPress }) {
  const stage = customer.pipelineStage;
  const stageColor = stageColors[stage] || tokens.color.textMuted;
  return (
    <PressableScale style={styles.row} onPress={onPress}>
      <Avatar name={customer.name || customer.phone} size={44} />
      <View style={styles.rowBody}>
        <Text style={styles.name} numberOfLines={1}>{customer.name || "Tanpa nama"}</Text>
        <Text style={styles.phone} numberOfLines={1}>{customer.phone ? "+" + customer.phone : "-"}</Text>
        {customer.city ? (
          <View style={styles.cityRow}>
            <MapPin size={11} color={tokens.color.textMuted} strokeWidth={2} style={styles.cityIcon} />
            <Text style={styles.city} numberOfLines={1}>{customer.city}</Text>
          </View>
        ) : null}
      </View>
      {stage ? (
        <View style={[styles.stageBadge, { backgroundColor: stageColor + "22" }]}>
          <Text style={[styles.stageBadgeText, { color: stageColor }]}>{stageLabels[stage] || stage}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

function SkeletonRow() {
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
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [salesUsers, setSalesUsers] = useState([]);
  // Definisi kepemilikan: conversation yang DITANGANI sales itu
  // (Conversation.assignedToId — sama seperti definisi take-over), BUKAN
  // Customer.assignedSalesId (kepemilikan lead/pipeline) — lihat catatan di
  // backend/src/routes/customers.js#salesId. Default: role SALES →
  // dirinya sendiri, role ADMIN → Semua (null).
  const [salesId, setSalesId] = useState(user?.role === "SALES" ? user.id : null);
  const [showSalesPicker, setShowSalesPicker] = useState(false);
  const debounceRef = useRef(null);

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
    setVisibleCount((v) => Math.min(v + PAGE_SIZE, customers.length));
  }

  function openDetail(c) {
    navigation.navigate("CustomerDetail", { customerId: c.id, name: c.name, phone: c.phone });
  }

  const visible = customers.slice(0, visibleCount);
  const selectedSalesName = salesId ? (salesUsers.find((u) => u.id === salesId)?.name || "…") : "Semua";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pelanggan</Text>
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

      {loading ? (
        <View style={styles.list}>
          {Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)}
        </View>
      ) : errorMsg ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Gagal memuat pelanggan: {errorMsg}</Text>
        </View>
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
          renderItem={({ item }) => <CustomerRow customer={item} onPress={() => openDetail(item)} />}
          estimatedItemSize={72}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[tokens.color.accent]} />
          }
          ListFooterComponent={
            visibleCount < customers.length ? (
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
                  <Text style={[styles.pickerItemText, item.id === salesId && styles.pickerItemTextActive]}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  title: { fontSize: 24, fontWeight: "700", color: tokens.color.textPrimary },
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
  stageBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
  stageBadgeText: { fontSize: 10, fontWeight: "700" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80, paddingHorizontal: 24 },
  emptyText: { color: tokens.color.textMuted, fontSize: 14, textAlign: "center" },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: tokens.color.subtle },
  skeletonBar: { height: 11, borderRadius: 6, backgroundColor: tokens.color.subtle },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70%" },
  pickerTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  pickerItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  pickerItemText: { fontSize: 14, color: tokens.color.textPrimary },
  pickerItemTextActive: { color: tokens.color.accent, fontWeight: "700" },
});
