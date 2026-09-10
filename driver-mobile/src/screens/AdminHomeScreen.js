// Beranda admin/dispatcher (10 Sep 2026, permintaan owner: "tambahkan
// tampilan untuk login admin, yang menampilkan status driver"). Login
// dengan role ADMIN/DISPATCHER mendarat di sini, bukan Job Saya (lihat
// lib/roles.js#isAdminView, App.js). Baca-saja v1 — SEMUA data lewat
// endpoint yang SUDAH dipakai dispatcher web (GET /armada/jobs,
// /armada/tracking, /armada/issues), nol perubahan backend. Aksi lanjut
// (reschedule, edit rute, dst) tetap di web untuk sekarang — app ini
// jawab "gimana progress hari ini" cepat dari HP, bukan menggantikan
// Route Planner.
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Truck, Route, CheckCircle2, XCircle, Clock } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useAdminToday } from "../hooks/useAdminToday";
import { relatifWaktu } from "../lib/jobHelpers";

const NAVY = "#0A0D16";
const SURFACE = "#171B2E";
const INK = "#F5F5F7";
const INK2 = "rgba(245,245,247,0.62)";
const INK3 = "rgba(245,245,247,0.40)";
const ACCENT = "#4C8DFF";
const GREEN = "#30D158";
const RED = "#FF453A";
const ORANGE = "#FF9F0A";

const TABS = [
  { key: "hari-ini", label: "Hari Ini" },
  { key: "driver", label: "Driver" },
  { key: "masalah", label: "Masalah" },
];

function ringkasHariIni(jobs) {
  const counts = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  const sisa = (counts.ASSIGNED || 0) + (counts.SCHEDULED || 0) + (counts.UNSCHEDULED || 0);

  const routeMap = new Map();
  for (const j of jobs) {
    if (!j.route) continue;
    let r = routeMap.get(j.route.id);
    if (!r) { r = { id: j.route.id, code: j.route.code, total: 0, selesai: 0, gagal: 0 }; routeMap.set(j.route.id, r); }
    r.total += 1;
    if (j.status === "COMPLETED") r.selesai += 1;
    if (j.status === "FAILED") r.gagal += 1;
  }

  return {
    total: jobs.length,
    selesai: counts.COMPLETED || 0,
    jalan: (counts.EN_ROUTE || 0) + (counts.ARRIVED || 0),
    gagal: counts.FAILED || 0,
    sisa,
    routes: [...routeMap.values()],
  };
}

function ringkasDriver(jobs, tracking) {
  const driverMap = new Map();
  for (const j of jobs) {
    if (!j.driver) continue;
    let d = driverMap.get(j.driver.id);
    if (!d) d = { id: j.driver.id, name: j.driver.name, total: 0, selesai: 0, gagal: 0, jalan: 0, sisa: 0, lastSeen: null };
    d.total += 1;
    if (j.status === "COMPLETED") d.selesai += 1;
    else if (j.status === "FAILED") d.gagal += 1;
    else if (j.status === "EN_ROUTE" || j.status === "ARRIVED") d.jalan += 1;
    else d.sisa += 1;
    driverMap.set(j.driver.id, d);
  }
  const jobIdToDriverId = new Map(jobs.filter((j) => j.driver).map((j) => [j.id, j.driver.id]));
  for (const t of tracking) {
    const driverId = jobIdToDriverId.get(t.jobId);
    const d = driverId && driverMap.get(driverId);
    if (d && t.lastPosition?.recordedAt) d.lastSeen = t.lastPosition.recordedAt;
  }
  return [...driverMap.values()].sort((a, b) => b.jalan - a.jalan || b.total - a.total);
}

export default function AdminHomeScreen() {
  const { user, logout } = useAuth();
  const { data, isLoading, error, refetch, isRefetching } = useAdminToday();
  const [tab, setTab] = useState("hari-ini");

  const jobs = data?.jobs || [];
  const issues = data?.issues || [];
  const tracking = data?.tracking || [];

  const ringkasan = useMemo(() => ringkasHariIni(jobs), [jobs]);
  const drivers = useMemo(() => ringkasDriver(jobs, tracking), [jobs, tracking]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Delivery Hari Ini</Text>
          <Text style={styles.subtitle}>Halo, {user?.name || "Admin"}</Text>
        </View>
        <Pressable onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Keluar</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}{t.key === "masalah" && issues.length > 0 ? ` (${issues.length})` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={ACCENT} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>Gagal memuat: {error.message}</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={ACCENT} />}
        >
          {tab === "hari-ini" && <HariIniView ringkasan={ringkasan} />}
          {tab === "driver" && <DriverView drivers={drivers} />}
          {tab === "masalah" && <MasalahView issues={issues} />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Kpi({ label, value, color }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, color && { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function HariIniView({ ringkasan }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.kpiGrid}>
        <Kpi label="Total Job" value={ringkasan.total} />
        <Kpi label="Selesai" value={ringkasan.selesai} color={GREEN} />
        <Kpi label="Jalan" value={ringkasan.jalan} color={ACCENT} />
        <Kpi label="Gagal" value={ringkasan.gagal} color={RED} />
        <Kpi label="Sisa" value={ringkasan.sisa} color={INK2} />
      </View>

      <Text style={styles.sectionTitle}>Rute Hari Ini ({ringkasan.routes.length})</Text>
      {ringkasan.routes.length === 0 ? (
        <Text style={styles.emptyText}>Belum ada rute untuk hari ini.</Text>
      ) : (
        ringkasan.routes.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Route size={14} color={ACCENT} />
                <Text style={styles.cardTitle}>{r.code}</Text>
              </View>
              <Text style={styles.cardMeta}>{r.selesai}/{r.total} selesai{r.gagal > 0 ? ` · ${r.gagal} gagal` : ""}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${r.total ? Math.round((r.selesai / r.total) * 100) : 0}%` }]} />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function DriverView({ drivers }) {
  if (drivers.length === 0) return <Text style={styles.emptyText}>Belum ada driver bertugas hari ini.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {drivers.map((d) => (
        <View key={d.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{d.name}</Text>
            {d.jalan > 0 ? (
              <View style={styles.liveBadge}>
                <Truck size={11} color={ACCENT} />
                <Text style={styles.liveBadgeText}>Di jalan</Text>
              </View>
            ) : (
              <Text style={styles.cardMeta}>Tidak sedang jalan</Text>
            )}
          </View>
          <View style={styles.driverStatsRow}>
            <Text style={styles.driverStat}><Text style={{ color: GREEN }}>{d.selesai}</Text> selesai</Text>
            <Text style={styles.driverStat}><Text style={{ color: ACCENT }}>{d.jalan}</Text> jalan</Text>
            <Text style={styles.driverStat}><Text style={{ color: d.gagal > 0 ? RED : INK2 }}>{d.gagal}</Text> gagal</Text>
            <Text style={styles.driverStat}><Text style={{ color: INK2 }}>{d.sisa}</Text> sisa</Text>
          </View>
          {d.lastSeen && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
              <Clock size={11} color={INK3} />
              <Text style={styles.lastSeenText}>Posisi terakhir {relatifWaktu(d.lastSeen)}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function MasalahView({ issues }) {
  if (issues.length === 0) {
    return (
      <View style={styles.center}>
        <CheckCircle2 size={28} color={GREEN} />
        <Text style={[styles.emptyText, { marginTop: 8 }]}>Tidak ada masalah terbuka.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {issues.map((j) => (
        <View key={j.id} style={[styles.card, { borderColor: "rgba(255,69,58,0.3)", borderWidth: 1 }]}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <XCircle size={14} color={RED} />
              <Text style={styles.cardTitle}>{j.order?.customer?.name || "Tanpa nama"}</Text>
            </View>
            <Text style={styles.cardMeta}>{relatifWaktu(j.updatedAt)}</Text>
          </View>
          <Text style={styles.issueReason}>{j.failureReason || j.rescheduleReason || "Tidak ada alasan tercatat"}</Text>
          <Text style={styles.cardMeta}>
            {j.order?.orderNumber || "—"} · {j.driver?.name || "Belum ada driver"} · {j.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: "800", color: INK },
  subtitle: { fontSize: 12.5, color: INK2, marginTop: 2 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  logoutText: { color: ACCENT, fontWeight: "700", fontSize: 12.5 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 100 },
  tabActive: { backgroundColor: "rgba(76,141,255,0.16)" },
  tabText: { color: INK2, fontSize: 12.5, fontWeight: "600" },
  tabTextActive: { color: ACCENT },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: 40 },
  errorText: { color: RED, fontSize: 13, textAlign: "center" },
  emptyText: { color: INK2, fontSize: 13, textAlign: "center" },
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kpi: { flexBasis: "31%", flexGrow: 1, backgroundColor: SURFACE, borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  kpiValue: { color: INK, fontSize: 20, fontWeight: "800" },
  kpiLabel: { color: INK2, fontSize: 10.5, marginTop: 2, fontWeight: "600" },
  sectionTitle: { color: INK, fontSize: 14, fontWeight: "700", marginTop: 4 },
  card: { backgroundColor: SURFACE, borderRadius: 14, padding: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { color: INK, fontSize: 13.5, fontWeight: "700" },
  cardMeta: { color: INK2, fontSize: 11, marginTop: 1 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 8, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: ACCENT },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(76,141,255,0.14)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  liveBadgeText: { color: ACCENT, fontSize: 10.5, fontWeight: "700" },
  driverStatsRow: { flexDirection: "row", gap: 14, marginTop: 8 },
  driverStat: { color: INK2, fontSize: 11.5, fontWeight: "600" },
  lastSeenText: { color: INK3, fontSize: 10.5 },
  issueReason: { color: ORANGE, fontSize: 12, fontWeight: "600", marginTop: 6 },
});
