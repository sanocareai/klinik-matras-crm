// Tab Home — ringkasan hari ini (Fase M5.5-B, diperluas M5.5-C: target +
// performa sales per-role). SEMUA data dari endpoint existing (SUDAH dicek
// dulu — TIDAK ada endpoint backend baru dibuat untuk layar ini):
// - Target bulanan: GET /analytics/sales-performance (SAMA yang dipakai
//   Laporan.jsx & TargetSalesWidget.jsx web) — per user: target,
//   totalOrderValue, percentToTarget. Role SALES: cari entry milik sendiri.
//   Role ADMIN: agregat SEMUA baris client-side (total target, total
//   achieved) — PERSIS pola yang sama dengan TargetSalesWidget.jsx web
//   (frontend/src/features/dashboard/components/TargetSalesWidget.jsx),
//   supaya angka tim konsisten & tidak duplikat logic.
// - Performa Sales (chat ditangani + conversion): GET /analytics/cs-performance
//   (SAMA yang dipakai Laporan.jsx web) — per user: totalConversations,
//   closingRate. closingRate = RESOLVED/total conversation yang ditangani —
//   ini DEFINISI "conversion rate" yang sudah dipakai web (bukan
//   order-based; sudah dicek dulu di Laporan.jsx/backend sebelum dipakai
//   di sini, supaya tidak beda definisi dengan dashboard web).
// - Belum Dibalas: GET /conversations/unread-count.
// - Percakapan Saya: GET /conversations/counts (field milikSaya).
// - Perlu Ditindak: GET /conversations (list biasa) sudah balikin
//   isUnanswered + unansweredMinutes per item — difilter/diurutkan
//   client-side (tidak ada endpoint khusus "top unanswered" di backend).
import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Bell, CheckCircle2, ArrowUpDown } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { formatRupiah } from "../utils/format";
import Avatar from "../components/Avatar";
import PressableScale from "../components/PressableScale";
import SanoAssistant from "../components/SanoAssistant";
import { navigateToChat } from "../lib/navigationRef";

function fmtWaitDuration(mins) {
  if (mins == null) return "";
  if (mins < 60) return `${mins} mnt`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam`;
  return `${Math.floor(hours / 24)} hari`;
}

function monthRangeStrings() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [perf, setPerf] = useState([]); // sales-performance rows (target/achieved), semua sales
  const [csPerf, setCsPerf] = useState([]); // cs-performance rows (chat/conversion), semua sales
  const [csSortAsc, setCsSortAsc] = useState(false); // default: conversion tertinggi dulu
  const [unreadCount, setUnreadCount] = useState(0);
  const [myConvCount, setMyConvCount] = useState(0);
  const [needsAction, setNeedsAction] = useState([]);
  const [sessionDist, setSessionDist] = useState([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const now = new Date();
      const { from, to } = monthRangeStrings();
      const [perfRows, csRows, unread, counts, convRes, sessionRows] = await Promise.all([
        api.getSalesPerformance(now.getFullYear(), now.getMonth() + 1).catch(() => []),
        api.getCsPerformance(from, to).catch(() => []),
        api.getUnreadCount().catch(() => ({ count: 0 })),
        api.getConversationCounts().catch(() => ({})),
        api.getConversations({}).catch(() => ({ data: [] })),
        api.getSessionDistribution("today").catch(() => []),
      ]);
      setPerf(perfRows || []);
      setCsPerf(csRows || []);
      setUnreadCount(unread?.count || 0);
      setMyConvCount(counts?.milikSaya || 0);
      setSessionDist(sessionRows || []);

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
  }, []);

  // BUG (fix): dulu cuma useEffect biasa (load() sekali pas mount) — tab
  // Home di bottom-tabs TIDAK unmount saat pindah ke tab lain (perilaku
  // baku React Navigation), jadi begitu tab ini pertama dibuka, data
  // (termasuk Target Bulanan dari SalesTarget) MACET di nilai lama sampai
  // app di-restart total — pindah tab lalu balik lagi TIDAK cukup. Kalau
  // Gilang ubah target sales di CRM web, sales yang app-nya sudah kebuka
  // dari tadi tidak pernah lihat angka barunya tanpa restart app, kelihatan
  // seperti "tidak sinkron" padahal datanya SAMA-SAMA dari GET
  // /analytics/sales-performance (endpoint tunggal, sudah benar). useFocusEffect
  // (pola sama dengan ChatListScreen.js) bikin load() jalan ulang tiap kali
  // tab Home ini di-fokus (termasuk balik dari tab lain), bukan cuma sekali.
  useFocusEffect(
    useCallback(() => { load(); }, [load])
  );

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

  // Target pribadi (role SALES) — entry milik user login sendiri.
  const myTarget = useMemo(() => perf.find((p) => p.userId === user?.id) || null, [perf, user?.id]);
  const hasMyTarget = !!myTarget && myTarget.target > 0;
  const myPercent = hasMyTarget ? Math.max(0, Math.min(100, myTarget.percentToTarget ?? 0)) : 0;

  // Total tim (role ADMIN) — agregat client-side, PERSIS pola
  // TargetSalesWidget.jsx web (bukan hitungan baru/beda definisi).
  const teamTotals = useMemo(() => {
    const totalTarget = perf.reduce((sum, r) => sum + (r.target || 0), 0);
    const totalAchieved = perf.reduce((sum, r) => sum + (r.totalOrderValue || 0), 0);
    const percent = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0;
    return { totalTarget, totalAchieved, percent };
  }, [perf]);
  const hasTeamTarget = teamTotals.totalTarget > 0;

  // Baris Performa Sales yang ditampilkan — SALES cuma lihat baris sendiri,
  // ADMIN lihat semua + sortable by conversion (closingRate).
  const csRowsToShow = useMemo(() => {
    if (!isAdmin) return csPerf.filter((r) => r.userId === user?.id);
    const sorted = [...csPerf].sort((a, b) =>
      csSortAsc ? a.closingRate - b.closingRate : b.closingRate - a.closingRate
    );
    return sorted;
  }, [csPerf, isAdmin, user?.id, csSortAsc]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: 60 }} color={tokens.color.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[tokens.color.accent]} />
        }
      >
      {/* Header */}
      <View style={styles.header}>
        <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={44} />
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

      {/* Hero target — beda per role */}
      {isAdmin ? (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Target Tim Bulan Ini</Text>
            {hasTeamTarget ? (
              <>
                <Text style={styles.heroPercent}>{teamTotals.percent}%</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(teamTotals.percent, 100)}%` }]} />
                </View>
                <Text style={styles.heroSub}>
                  {formatRupiah(teamTotals.totalAchieved)} dari {formatRupiah(teamTotals.totalTarget)}
                </Text>
              </>
            ) : (
              <Text style={styles.heroSub}>
                Target bulan ini belum diatur untuk Sales manapun — atur lewat CRM web (menu Laporan/Pengaturan).
              </Text>
            )}
          </View>

          {perf.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Progress per Sales</Text>
              {perf.map((r) => {
                const pct = r.target > 0 ? Math.max(0, Math.min(100, Math.round((r.totalOrderValue / r.target) * 100))) : 0;
                return (
                  <View key={r.userId} style={styles.personRow}>
                    <Avatar name={r.name} avatarUrl={r.avatarUrl} size={28} />
                    <View style={styles.personBody}>
                      <Text style={styles.personName} numberOfLines={1}>{r.name}</Text>
                      {r.target > 0 ? (
                        <View style={styles.personTrack}>
                          <View style={[styles.personFill, { width: `${pct}%` }]} />
                        </View>
                      ) : (
                        <Text style={styles.personNoTarget}>Belum ada target</Text>
                      )}
                    </View>
                    {r.target > 0 && <Text style={styles.personPct}>{pct}%</Text>}
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Target Bulan Ini</Text>
          {hasMyTarget ? (
            <>
              <Text style={styles.heroPercent}>{myPercent}%</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${myPercent}%` }]} />
              </View>
              <Text style={styles.heroSub}>
                {formatRupiah(myTarget.totalOrderValue)} dari {formatRupiah(myTarget.target)}
              </Text>
            </>
          ) : (
            <Text style={styles.heroSub}>
              Target belum diatur — atur lewat CRM web (menu Laporan/Pengaturan).
            </Text>
          )}
        </View>
      )}

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
            {hasMyTarget ? formatRupiah(myTarget.totalOrderValue) : "-"}
          </Text>
          <Text style={styles.statLabel}>Order Bulan Ini</Text>
        </View>
      </View>

      {/* Distribusi Chat CS-1 vs CS-2 — read-only, sama endpoint dashboard web */}
      {sessionDist.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Distribusi Chat CS-1 vs CS-2</Text>
          <View style={styles.sessionRow}>
            {sessionDist.map((s) => (
              <View key={s.session} style={styles.sessionCard}>
                <Text style={styles.sessionLabel}>{s.session}</Text>
                <Text style={styles.sessionValue}>{s.newLeads}</Text>
                <Text style={styles.sessionValueCaption}>Lead Baru</Text>
                <Text style={styles.sessionSub}>{s.totalActive} percakapan aktif</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Performa Sales — chat ditangani + conversion (closingRate) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Performa Sales</Text>
          {isAdmin && csPerf.length > 1 && (
            <TouchableOpacity style={styles.sortBtn} onPress={() => setCsSortAsc((v) => !v)}>
              <ArrowUpDown size={12} color={tokens.color.accent} strokeWidth={2.2} style={{ marginRight: 4 }} />
              <Text style={styles.sortBtnText}>Conversion {csSortAsc ? "Terendah" : "Tertinggi"}</Text>
            </TouchableOpacity>
          )}
        </View>
        {csRowsToShow.length === 0 ? (
          <Text style={styles.emptyHint}>Belum ada data percakapan bulan ini</Text>
        ) : (
          csRowsToShow.map((r) => (
            <View key={r.userId} style={styles.perfRow}>
              <Avatar name={r.name} avatarUrl={r.avatarUrl} size={32} />
              <View style={styles.perfBody}>
                <Text style={styles.perfName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.perfMeta}>{r.totalConversations} chat ditangani</Text>
              </View>
              <View style={styles.perfBadge}>
                <Text style={styles.perfBadgeText}>{r.closingRate}%</Text>
              </View>
            </View>
          ))
        )}
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
      {/* "Tanya Sano" FAB — TANPA context (Home bukan konteks percakapan
          tertentu, lihat spec: konteks cuma relevan dari ChatRoom). */}
      <SanoAssistant bottomOffset={16} />
    </View>
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
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: {
    fontSize: 13, fontWeight: "700", color: tokens.color.textSecondary,
    textTransform: "uppercase", letterSpacing: 0.4,
  },
  sortBtn: { flexDirection: "row", alignItems: "center" },
  sortBtnText: { fontSize: 11, fontWeight: "700", color: tokens.color.accent },
  emptyHintRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  emptyHint: { fontSize: 13, color: tokens.color.textMuted },
  actionRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.subtle,
  },
  actionBody: { flex: 1, marginLeft: 10 },
  actionName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
  actionMeta: { fontSize: 12, color: tokens.color.danger, marginTop: 2 },
  personRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.subtle,
  },
  personBody: { flex: 1, marginLeft: 10 },
  personName: { fontSize: 13, fontWeight: "600", color: tokens.color.textPrimary, marginBottom: 4 },
  personTrack: { height: 5, borderRadius: 3, backgroundColor: tokens.color.subtle, overflow: "hidden" },
  personFill: { height: "100%", borderRadius: 3, backgroundColor: tokens.color.accent },
  personNoTarget: { fontSize: 11, color: tokens.color.textMuted },
  personPct: { fontSize: 12, fontWeight: "700", color: tokens.color.textPrimary, marginLeft: 10 },
  perfRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.subtle,
  },
  perfBody: { flex: 1, marginLeft: 10 },
  perfName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
  perfMeta: { fontSize: 12, color: tokens.color.textSecondary, marginTop: 1 },
  perfBadge: {
    backgroundColor: tokens.color.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
  },
  perfBadgeText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent },
  sessionRow: { flexDirection: "row", gap: 10 },
  sessionCard: {
    flex: 1, backgroundColor: tokens.color.accentSoft, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: "#DBEAFE",
  },
  sessionLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.accent, letterSpacing: 0.3 },
  sessionValue: { fontSize: 24, fontWeight: "700", color: tokens.color.textPrimary, marginTop: 6 },
  sessionValueCaption: { fontSize: 11, color: tokens.color.textSecondary, marginTop: 1 },
  sessionSub: {
    fontSize: 11, color: tokens.color.textMuted, marginTop: 8, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#DBEAFE",
  },
});
