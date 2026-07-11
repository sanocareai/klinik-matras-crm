// Tab Home — ringkasan hari ini (Fase M5.5-B). Data dari endpoint existing
// (tidak ada endpoint baru dibuat di backend untuk tab ini):
// - Target bulanan: GET /analytics/sales-performance (SAMA yang dipakai
//   halaman Laporan web) — cari entry milik user login sendiri by userId.
// - Belum Dibalas: GET /conversations/unread-count (SAMA badge lonceng).
// - Percakapan Saya: GET /conversations/counts (field milikSaya).
// - Order Bulan Ini: totalOrderValue dari entry sales-performance yang sama.
// - Perlu Ditindak: GET /conversations (list biasa, limit default 100)
//   sudah balikin isUnanswered + unansweredMinutes per item (lihat backend/
//   src/routes/conversations.js) — difilter & diurutkan CLIENT-SIDE di sini
//   (tidak ada endpoint khusus "top unanswered" di backend).
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator,
} from "react-native";
import { Bell, CheckCircle2 } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { formatRupiah } from "../utils/format";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";
import { navigateToChat } from "../lib/navigationRef";

function fmtWaitDuration(mins) {
  if (mins == null) return "";
  if (mins < 60) return `${mins} mnt`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam`;
  return `${Math.floor(hours / 24)} hari`;
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [target, setTarget] = useState(null); // { target, totalOrderValue, percentToTarget } | null
  const [unreadCount, setUnreadCount] = useState(0);
  const [myConvCount, setMyConvCount] = useState(0);
  const [needsAction, setNeedsAction] = useState([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const now = new Date();
      const [perf, unread, counts, convRes] = await Promise.all([
        api.getSalesPerformance(now.getFullYear(), now.getMonth() + 1).catch(() => []),
        api.getUnreadCount().catch(() => ({ count: 0 })),
        api.getConversationCounts().catch(() => ({})),
        api.getConversations({}).catch(() => ({ data: [] })),
      ]);
      setTarget((perf || []).find((p) => p.userId === user?.id) || null);
      setUnreadCount(unread?.count || 0);
      setMyConvCount(counts?.milikSaya || 0);

      const top = (convRes?.data || [])
        .filter((c) => c.isUnanswered)
        .sort((a, b) => (b.unansweredMinutes || 0) - (a.unansweredMinutes || 0))
        .slice(0, 5);
      setNeedsAction(top);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    load(true);
  }

  function openConversation(c) {
    const isGroup = c.type === "GROUP";
    navigateToChat({
      conversationId: c.id,
      name: isGroup ? (c.groupName || "Grup WhatsApp") : (c.customer?.name || c.customer?.phone || "Pelanggan"),
      isGroup,
      customerId: c.customerId,
    });
  }

  const hasTarget = !!target && target.target > 0;
  const percent = hasTarget ? Math.max(0, Math.min(100, target.percentToTarget ?? 0)) : 0;

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 60 }} color={tokens.color.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[tokens.color.accent]} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Avatar name={user?.name} size={44} />
        <Text style={styles.greeting} numberOfLines={1}>Halo, {user?.name?.split(" ")[0] || "Sales"}</Text>
        <TouchableOpacity style={styles.bellBtn} onPress={() => navigation.navigate("Chats")}>
          <Bell size={22} color={tokens.color.textPrimary} strokeWidth={2} />
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Gagal memuat sebagian data: {errorMsg}</Text>
        </View>
      )}

      {/* Hero target card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Target Bulan Ini</Text>
        {hasTarget ? (
          <>
            <Text style={styles.heroPercent}>{percent}%</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percent}%` }]} />
            </View>
            <Text style={styles.heroSub}>
              {formatRupiah(target.totalOrderValue)} dari {formatRupiah(target.target)}
            </Text>
          </>
        ) : (
          <Text style={styles.heroSub}>
            Target belum diatur — atur lewat CRM web (menu Laporan/Pengaturan).
          </Text>
        )}
      </View>

      {/* Quick stats */}
      <View style={styles.statsRow}>
        <PressableScale style={styles.statCard} onPress={() => navigation.navigate("Chats")}>
          <Text style={styles.statValue}>{unreadCount}</Text>
          <Text style={styles.statLabel}>Belum Dibalas</Text>
        </PressableScale>
        <PressableScale style={styles.statCard} onPress={() => navigation.navigate("Chats")}>
          <Text style={styles.statValue}>{myConvCount}</Text>
          <Text style={styles.statLabel}>Percakapan Saya</Text>
        </PressableScale>
        <View style={styles.statCard}>
          <Text style={styles.statValue} numberOfLines={1}>
            {hasTarget ? formatRupiah(target.totalOrderValue) : "-"}
          </Text>
          <Text style={styles.statLabel}>Order Bulan Ini</Text>
        </View>
      </View>

      {/* Perlu Ditindak */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Perlu Ditindak</Text>
        {needsAction.length === 0 ? (
          <View style={styles.emptyHintRow}>
            <CheckCircle2 size={16} color={tokens.color.success} strokeWidth={2} style={{ marginRight: 6 }} />
            <Text style={styles.emptyHint}>Semua percakapan sudah dibalas</Text>
          </View>
        ) : (
          needsAction.map((c) => {
            const isGroup = c.type === "GROUP";
            const name = isGroup ? (c.groupName || "Grup WhatsApp") : (c.customer?.name || c.customer?.phone || "Pelanggan");
            return (
              <PressableScale key={c.id} style={styles.actionRow} onPress={() => openConversation(c)}>
                <Avatar name={name} isGroup={isGroup} size={40} />
                <View style={styles.actionBody}>
                  <Text style={styles.actionName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.actionMeta}>Belum dibalas {fmtWaitDuration(c.unansweredMinutes)}</Text>
                </View>
              </PressableScale>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  greeting: { flex: 1, fontSize: 18, fontWeight: "700", color: tokens.color.textPrimary },
  bellBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  bellBadge: {
    position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: tokens.color.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  bellBadgeText: { color: "#fff", fontSize: 9, fontWeight: "700" },
  errorBanner: { backgroundColor: "#fef3c7", borderRadius: 10, padding: 10 },
  errorText: { color: "#92400e", fontSize: 12 },
  heroCard: {
    backgroundColor: tokens.color.accent, borderRadius: tokens.radius.card, padding: 20,
  },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  heroPercent: { color: "#fff", fontSize: 36, fontWeight: "800" },
  progressTrack: {
    height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.25)", marginTop: 10, overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: "#fff" },
  heroSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, marginTop: 10 },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1, backgroundColor: tokens.color.card, borderRadius: tokens.radius.card,
    padding: 14, ...tokens.shadow.soft,
  },
  statValue: { fontSize: 18, fontWeight: "700", color: tokens.color.textPrimary },
  statLabel: { fontSize: 11, color: tokens.color.textSecondary, marginTop: 4 },
  section: {
    backgroundColor: tokens.color.card, borderRadius: tokens.radius.card, padding: 16, ...tokens.shadow.soft,
  },
  sectionTitle: {
    fontSize: 13, fontWeight: "700", color: tokens.color.textSecondary, marginBottom: 10,
    textTransform: "uppercase", letterSpacing: 0.4,
  },
  emptyHintRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  emptyHint: { fontSize: 13, color: tokens.color.textMuted },
  actionRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.subtle,
  },
  actionBody: { flex: 1, marginLeft: 10 },
  actionName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
  actionMeta: { fontSize: 12, color: tokens.color.danger, marginTop: 2 },
});
