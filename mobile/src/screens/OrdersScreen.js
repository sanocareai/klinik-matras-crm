// Tab "Order" — ORDER-CENTRIC, lintas semua pelanggan. Gap yang diperbaiki
// (analisa 26 Jul 2026): sebelumnya order HANYA bisa dilihat dari dalam
// profil 1 pelanggan (CustomerProfileContent.js) — pertanyaan operasional
// paling dasar "order mana yang sedang diproses SEKARANG?" tidak bisa
// dijawab tanpa membuka satu-satu dari 1.297 pelanggan (94% di antaranya
// tidak punya order sama sekali). Endpoint & filosofi SAMA dengan halaman
// Order web (frontend/src/pages/Orders.jsx) — 1 baris = 1 order, bukan 1
// pelanggan, diurutkan per status kerja.
//
// TIDAK bisa membuat order baru dari sini (sengaja) — order baru tetap
// dibuat dari konteks 1 pelanggan (Pelanggan tab → profil → "+ Order"),
// karena butuh detail spesifik pelanggan itu. Layar ini murni untuk
// TRACKING & update status order yang sudah ada.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ActivityIndicator, RefreshControl,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Search, Package, AlertTriangle, MessageCircle, ChevronDown, Users, X } from "lucide-react-native";
import { ScrollView } from "react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { navigateToChat } from "../lib/navigationRef";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";
import OrderCard from "../components/OrderCard";
import OrderFormModal from "../components/OrderFormModal";
import SalesFilterModal from "../components/SalesFilterModal";
import {
  formatRupiah, formatRupiahShort,
  ORDER_STATUS_LABELS, ORDER_STATUS_BUCKET_LABELS, orderStatusBucket,
} from "../utils/format";

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;
// Ambang "mandek" — SAMA PERSIS dengan web (pages/Orders.jsx MANDEK_HARI)
// supaya sales yang kerja dari HP dan dari CRM web melihat definisi yang
// konsisten, bukan dua standar berbeda. SEWA_DIKIRIM/SEWA_DIAMBIL (4 Sep
// 2026) ikut dikecualikan — bertahan lama di SEWA_DIKIRIM MEMANG normal
// (itulah tujuan sewa), bukan tanda tertahan.
const MANDEK_HARI = 7;
const isMandek = (o) =>
  !["DELIVERED", "CANCELLED", "SEWA_DIKIRIM", "SEWA_DIAMBIL"].includes(o.status) && (o.daysInStatus || 0) >= MANDEK_HARI;

// Tab status ringkas (4 Sep 2026, paritas dgn web pages/Orders.jsx) — bucket
// utk LAYANAN/BARU (Diproses/Siap Kirim/Terkirim), + 2 status SEWA aslinya
// sbg tab terpisah (layar ini tidak punya filter Kategori tersendiri, jadi
// SEWA tetap harus bisa dicari lewat tab). "PROCESSING" dipakai SENTINEL
// bucket — lihat statusQueryParam().
const STATUS_TABS = [
  { key: "", label: "Semua" },
  { key: "PROCESSING", label: ORDER_STATUS_BUCKET_LABELS.PROCESSING },
  { key: "READY", label: ORDER_STATUS_BUCKET_LABELS.READY },
  { key: "DELIVERED", label: ORDER_STATUS_BUCKET_LABELS.DELIVERED },
  { key: "SEWA_DIKIRIM", label: ORDER_STATUS_LABELS.SEWA_DIKIRIM },
  { key: "SEWA_DIAMBIL", label: ORDER_STATUS_LABELS.SEWA_DIAMBIL },
  { key: "CANCELLED", label: ORDER_STATUS_BUCKET_LABELS.CANCELLED },
];
// Terjemahan filter status → query param backend — sama pola dgn web
// statusQueryParam(). Bucket "PROCESSING" TIDAK dikirim, disaring ulang
// client-side dari superset yang sudah dimuat (lihat load()).
function statusQueryParam(statusFilter) {
  return (statusFilter && statusFilter !== "PROCESSING") ? statusFilter : undefined;
}

function SkeletonRow({ tokens, styles }) {
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <View style={styles.skeletonAvatar} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={[styles.skeletonBar, { width: "50%" }]} />
          <View style={[styles.skeletonBar, { width: "30%" }]} />
        </View>
      </View>
      <View style={[styles.skeletonBar, { height: 40, borderRadius: 10 }]} />
    </View>
  );
}

// Header customer di atas tiap OrderCard — INI yang membuat daftar order
// lintas-pelanggan bisa dibaca: OrderCard sendiri TIDAK tahu/tidak
// menampilkan siapa pelanggannya (dibangun untuk konteks 1 customer yang
// sudah diketahui dari layar profil), jadi identitas pelanggan + jalan
// pintas ke chat-nya ditambahkan di SINI, bukan mengubah OrderCard (yang
// masih dipakai apa adanya di CustomerProfileContent.js).
function OrderRow({ order, tokens, styles, onRefresh, onDeleted, onEdit, onExpand }) {
  const mandek = isMandek(order);
  const nama = order.customerName || order.customerPhone || "Tanpa nama";
  return (
    <View style={styles.card}>
      <View style={styles.customerHeader}>
        <Avatar name={nama} size={36} avatarUrl={order.profilePictureUrl} />
        <View style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <Text style={styles.customerName} numberOfLines={1}>{nama}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text
              style={[
                styles.daysText,
                mandek && { color: tokens.color.warning, fontWeight: "700" },
              ]}
            >
              {mandek && <AlertTriangle size={10} color={tokens.color.warning} />}
              {" "}{order.daysInStatus === 0 ? "Masuk hari ini" : `${order.daysInStatus} hari di status ini`}
              {order.daysInStatusPerkiraan ? "*" : ""}
            </Text>
          </View>
        </View>
        <PressableScale
          style={[styles.chatBtn, !order.conversationId && { opacity: 0.35 }]}
          onPress={() => order.conversationId && navigateToChat({ conversationId: order.conversationId, name: nama, customerId: order.customerId })}
          disabled={!order.conversationId}
        >
          <MessageCircle size={16} color={tokens.color.accent} strokeWidth={2} />
        </PressableScale>
      </View>

      <OrderCard
        order={order}
        onRefresh={onRefresh}
        onDeleted={onDeleted}
        onEdit={onEdit}
        onExpand={onExpand}
      />
    </View>
  );
}

export default function OrdersScreen() {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [hanyaMandek, setHanyaMandek] = useState(false);
  // Filter per Sales (fitur baru) — Order sendiri TIDAK punya kolom sales,
  // kepemilikannya lewat customer.assignedSalesId (lihat schema.prisma).
  // Backend GET /orders?salesId= sudah lama ada (dipakai dropdown web
  // frontend/src/pages/Orders.jsx), di sini baru disambungkan ke mobile.
  const [salesFilter, setSalesFilter] = useState(null); // { id, name } | null
  const [salesModalVisible, setSalesModalVisible] = useState(false);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null); // { total, value } dari perStatus
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [editingOrder, setEditingOrder] = useState(null);

  const debounceRef = useRef(null);
  const listRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      // BUG YANG DIPERBAIKI (26 Agustus 2026): tidak pernah kirim `limit`,
      // jadi diam-diam kena default backend (200, lihat routes/orders.js
      // GET /) — TIDAK ADA hubungannya dengan periode/tanggal (endpoint ini
      // tidak difilter tanggal sama sekali kalau `from`/`to` tidak dikirim).
      // Production sekarang punya 344 order, jadi 144 di antaranya diam-diam
      // hilang dari layar & dari angka "total" ini, tanpa peringatan apa pun
      // — beda dari web (Orders.jsx) yang SUDAH mengecek `data.truncated`
      // dan kasih tahu. Sekarang minta batas maksimal (500, plafon backend)
      // dan tampilkan peringatan yang sama kalau tetap masih terpotong.
      const params = { limit: 500 };
      if (search) params.search = search;
      const statusParam = statusQueryParam(statusFilter);
      if (statusParam) params.status = statusParam;
      // Tab "Semua" (statusFilter kosong) sekarang berarti "semua yang masih
      // aktif" (26 Agustus 2026) -- 267 dari 344 order production sudah
      // DELIVERED/CANCELLED, tidak perlu ikut ditrack. Klik tab "Delivered"/
      // "Cancelled" eksplisit tetap menampilkannya seperti biasa (lihat
      // catatan `hideFinished` di routes/orders.js). Tab bucket "Diproses"
      // (statusFilter==="PROCESSING" tanpa statusParam) JUGA tidak boleh ikut
      // hideFinished — itu sendiri sudah eksplisit memilih status tertentu.
      else if (!statusFilter) params.hideFinished = "true";
      if (salesFilter) params.salesId = salesFilter.id;
      const data = await api.getOrders(params);
      // Bucket "Diproses" tidak dikirim ke backend (lihat statusQueryParam) —
      // disaring di sini, dari superset yang sudah dimuat.
      const items = statusFilter === "PROCESSING"
        ? (data.items || []).filter((o) => orderStatusBucket(o.status) === "PROCESSING")
        : (data.items || []);
      setOrders(items);
      setTruncated(!!data.truncated);
      setSummary({
        total: items.length,
        value: items.reduce((s, o) => s + (o.value || 0), 0),
      });
      setVisibleCount(PAGE_SIZE);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, statusFilter, salesFilter]);

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

  const filtered = useMemo(
    () => (hanyaMandek ? orders.filter(isMandek) : orders),
    [orders, hanyaMandek]
  );
  const mandekCount = useMemo(() => orders.filter(isMandek).length, [orders]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // GAP (fix): card yang di-expand dekat bawah layar dulu kepotong, harus
  // scroll manual. double rAF: tunggu 1 frame render `expanded` commit +
  // FlashList re-measure tinggi cell yang baru, baru scroll — kalau langsung
  // scroll di frame yang sama, list masih pakai tinggi LAMA (collapsed) jadi
  // hasilnya salah posisi.
  //
  // BUG (fix, 28 Jul 2026): card PALING ATAS/BAWAH di daftar masih kepotong
  // walau sudah ada auto-scroll di atas. Root cause ganda:
  //   1. viewPosition:0.25 taruh bagian ATAS card di 25% tinggi viewport —
  //      untuk card yang tinggi konten expanded-nya BESAR (banyak add-ons/
  //      catatan), sisa 75% viewport seringkali TIDAK CUKUP menampung
  //      seluruh detail, jadi bagian bawahnya tetap kepotong. viewPosition:0
  //      (taruh di PALING ATAS viewport) kasih ruang MAKSIMAL di bawahnya,
  //      berlaku sama baik untuk card di tengah maupun di ujung daftar.
  //   2. Untuk card PALING BAWAH daftar, total content-size FlashList belum
  //      sempat bertambah (masih ukuran lama/collapsed) di momen scroll
  //      pertama sehingga permintaan scroll ke-clamp duluan sebelum area
  //      expanded selesai ter-render — card auto-scroll ke posisi yang
  //      SEOLAH benar tapi sebetulnya masih dibatasi content-size lama.
  //      Fix: scroll KEDUA setelah jeda kecil (150ms), setelah FlashList
  //      pasti sudah re-measure & content-size ikut bertambah.
  const handleExpandOrder = useCallback((orderId) => {
    const scrollToOrder = () => {
      const item = visible.find((o) => o.id === orderId);
      if (item) listRef.current?.scrollToItem({ item, animated: true, viewPosition: 0 });
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToOrder);
    });
    setTimeout(scrollToOrder, 150);
  }, [visible]);

  function handleEndReached() {
    setVisibleCount((v) => Math.min(v + PAGE_SIZE, filtered.length));
  }

  const handleDeleted = useCallback((orderId) => {
    setOrders((list) => list.filter((o) => o.id !== orderId));
  }, []);

  // OrderFormModal onUpdated tidak mengirim data (cuma sinyal) — refetch
  // seluruh daftar adalah cara paling sederhana yang TETAP BENAR (bukan
  // patch manual field-per-field yang mudah lupa satu field baru nanti).
  const handleUpdated = useCallback(() => { load(true); }, [load]);
  const handleQuickRefresh = useCallback(() => { load(true); }, [load]);

  const renderItem = useCallback(({ item }) => (
    <OrderRow
      order={item} tokens={tokens} styles={styles}
      onRefresh={handleQuickRefresh}
      onDeleted={handleDeleted}
      onEdit={setEditingOrder}
      onExpand={() => handleExpandOrder(item.id)}
    />
  ), [tokens, styles, handleQuickRefresh, handleDeleted, handleExpandOrder]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Order</Text>
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={tokens.color.textMuted} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Cari ID order, nama, nomor…"
          placeholderTextColor={tokens.color.textMuted}
          value={searchInput}
          onChangeText={handleSearchChange}
        />
        {/* Filter per Sales (fitur baru) — sama pola dgn ikon di header
            Inbox (ChatListScreen.js), ditaruh di search bar di sini karena
            layar ini tidak punya header icon row terpisah. */}
        <PressableScale onPress={() => setSalesModalVisible(true)} style={styles.searchIconBtn}>
          <Users size={18} color={salesFilter ? tokens.color.accent : tokens.color.textMuted} strokeWidth={2} />
        </PressableScale>
      </View>

      {salesFilter && (
        <View style={styles.salesFilterChipRow}>
          <View style={styles.salesFilterChip}>
            <Users size={13} color={tokens.color.accent} strokeWidth={2.2} />
            <Text style={styles.salesFilterChipText} numberOfLines={1}>Sales: {salesFilter.name}</Text>
            <PressableScale onPress={() => setSalesFilter(null)} hitSlop={8}>
              <X size={14} color={tokens.color.accent} strokeWidth={2.4} />
            </PressableScale>
          </View>
        </View>
      )}

      {/* Ringkasan singkat — bukan 4 kartu KPI seperti web (ruang HP
          terbatas), cukup 1 baris supaya sales tetap tahu skala tanpa
          menggeser fokus dari daftar itu sendiri. */}
      {!loading && summary && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {summary.total} order · {formatRupiahShort(summary.value)}
          </Text>
          <PressableScale
            style={[styles.mandekPill, hanyaMandek && { backgroundColor: tokens.color.warning + "22", borderColor: tokens.color.warning }]}
            onPress={() => setHanyaMandek((v) => !v)}
          >
            <AlertTriangle size={11} color={hanyaMandek ? tokens.color.warning : tokens.color.textMuted} strokeWidth={2.2} />
            <Text style={[styles.mandekPillText, hanyaMandek && { color: tokens.color.warning }]}>
              {mandekCount} mandek
            </Text>
          </PressableScale>
        </View>
      )}

      {!loading && truncated && (
        <Text style={styles.truncatedNotice}>
          Menampilkan {summary?.total ?? 0} order terbaru (dibatasi demi kecepatan). Pakai
          pencarian atau filter untuk mempersempit.
        </Text>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsWrap}
        contentContainerStyle={styles.tabsContent}
      >
        {STATUS_TABS.map((t) => {
          const active = statusFilter === t.key;
          return (
            <PressableScale
              key={t.key || "ALL"}
              style={[styles.statusChip, active && { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent }]}
              onPress={() => setStatusFilter(t.key)}
            >
              <Text style={[styles.statusChipText, active && { color: tokens.color.accent }]}>{t.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={{ paddingHorizontal: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} tokens={tokens} styles={styles} />)}
        </View>
      ) : errorMsg ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Gagal memuat order: {errorMsg}</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Package size={36} color={tokens.color.textMuted} strokeWidth={1.6} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>
            {search || statusFilter || hanyaMandek || salesFilter ? "Tidak ada order yang cocok" : "Belum ada order"}
          </Text>
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={visible}
          keyExtractor={(o) => o.id}
          renderItem={renderItem}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[tokens.color.accent]} />
          }
          ListFooterComponent={
            visibleCount < filtered.length ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={tokens.color.accent} />
            ) : null
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 420 }}
        />
      )}

      <SalesFilterModal
        visible={salesModalVisible}
        selectedId={salesFilter?.id}
        filterRole="SALES"
        onClose={() => setSalesModalVisible(false)}
        onSelect={(u) => setSalesFilter(u ? { id: u.id, name: u.name } : null)}
      />

      {editingOrder && (
        <OrderFormModal
          visible
          order={editingOrder}
          customerId={editingOrder.customerId}
          onClose={() => setEditingOrder(null)}
          onUpdated={() => { setEditingOrder(null); handleUpdated(); }}
          onDeleted={(id) => { setEditingOrder(null); handleDeleted(id); }}
        />
      )}
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
    searchWrap: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginHorizontal: 16, marginBottom: 8, backgroundColor: tokens.color.card,
      borderRadius: tokens.radius.pill, paddingHorizontal: 14, paddingVertical: 10,
      ...tokens.shadow.soft, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    },
    searchInput: { flex: 1, fontSize: 14, color: tokens.color.textPrimary },
    searchIconBtn: { padding: 2 },
    salesFilterChipRow: { marginHorizontal: 16, marginBottom: 8 },
    salesFilterChip: {
      flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6,
      backgroundColor: tokens.color.accentSoft, borderRadius: tokens.radius.chip,
      paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%",
    },
    salesFilterChipText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent, flexShrink: 1 },
    summaryRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 16, marginBottom: 8,
    },
    summaryText: { fontSize: 12.5, color: tokens.color.textSecondary, fontWeight: "600" },
    truncatedNotice: {
      fontSize: 11, color: tokens.color.textMuted,
      marginHorizontal: 16, marginBottom: 8, lineHeight: 15,
    },
    mandekPill: {
      flexDirection: "row", alignItems: "center", gap: 4,
      paddingHorizontal: 9, paddingVertical: 4, borderRadius: tokens.radius.chip,
      borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card,
    },
    mandekPillText: { fontSize: 11, fontWeight: "700", color: tokens.color.textMuted },
    tabsWrap: { flexGrow: 0, marginBottom: 8 },
    tabsContent: { paddingHorizontal: 16, gap: 8 },
    statusChip: {
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border,
    },
    statusChipText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
    card: {
      backgroundColor: tokens.color.card, borderRadius: tokens.radius.card, padding: 10,
      marginBottom: 10, ...tokens.shadow.soft,
    },
    customerHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8, paddingHorizontal: 2 },
    customerName: { fontSize: 13.5, fontWeight: "700", color: tokens.color.textPrimary },
    daysText: { fontSize: 11, color: tokens.color.textMuted, marginTop: 1 },
    chatBtn: {
      width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
      backgroundColor: tokens.color.accentSoft, marginLeft: 8,
    },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 80, paddingHorizontal: 24 },
    emptyText: { color: tokens.color.textMuted, fontSize: 14, textAlign: "center" },
    skeletonAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: tokens.color.subtle },
    skeletonBar: { height: 11, borderRadius: 6, backgroundColor: tokens.color.subtle },
  });
}
