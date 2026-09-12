// Beranda admin/dispatcher (10 Sep 2026, permintaan owner: "tambahkan
// tampilan untuk login admin, yang menampilkan status driver"). Login
// dengan role ADMIN/DISPATCHER mendarat di sini, bukan Job Saya (lihat
// lib/roles.js#isAdminView, App.js). Baca-saja v1 — SEMUA data lewat
// endpoint yang SUDAH dipakai dispatcher web (GET /armada/jobs,
// /armada/tracking, /armada/issues), nol perubahan backend. Aksi lanjut
// (reschedule, edit rute, dst) tetap di web untuk sekarang — app ini
// jawab "gimana progress hari ini" cepat dari HP, bukan menggantikan
// Route Planner. Light/dark ikut sistem HP (lihat src/theme.js).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Truck, Route, CheckCircle2, XCircle, Clock, Award } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { useAdminToday } from "../hooks/useAdminToday";
import { useRouteIncentiveSummary } from "../hooks/useRouteIncentiveSummary";
import { relatifWaktu } from "../lib/jobHelpers";

const TABS = [
  { key: "hari-ini", label: "Hari Ini" },
  { key: "driver", label: "Driver" },
  { key: "masalah", label: "Masalah" },
  { key: "performa", label: "Performa" },
];

// Preset rentang tanggal utk tab Performa (12 Sep 2026) — default "Bulan
// Ini" (backend juga default ke ini kalau from/to kosong, lihat
// armada.js#incentive-summary), owner tidak menegaskan kebutuhan custom
// date picker jadi cukup 3 preset umum dulu.
const PERIODE_PRESET = [
  { key: "bulan-ini", label: "Bulan Ini" },
  { key: "minggu-ini", label: "Minggu Ini" },
  { key: "bulan-lalu", label: "Bulan Lalu" },
];

function rentangPeriode(preset) {
  const now = new Date(Date.now() + 7 * 3600_000); // WIB
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const toISO = (d) => d.toISOString().slice(0, 10);
  if (preset === "minggu-ini") {
    const dow = now.getUTCDay() || 7; // Senin=1..Minggu=7
    const senin = new Date(Date.UTC(y, m, now.getUTCDate() - dow + 1));
    return { from: toISO(senin), to: toISO(now) };
  }
  if (preset === "bulan-lalu") {
    const awal = new Date(Date.UTC(y, m - 1, 1));
    const akhir = new Date(Date.UTC(y, m, 0));
    return { from: toISO(awal), to: toISO(akhir) };
  }
  // bulan-ini (default)
  const awal = new Date(Date.UTC(y, m, 1));
  return { from: toISO(awal), to: toISO(now) };
}

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
    if (!d) {
      d = {
        id: j.driver.id, name: j.driver.name, total: 0, selesai: 0, gagal: 0, jalan: 0, sisa: 0, lastSeen: null,
        // Status Online/Offline (12 Sep 2026) — data sama utk baris driver
        // ini di semua job-nya, cukup ambil sekali dari job pertama yang
        // ditemukan.
        isOnline: !!j.driver.isOnline, onlineSince: j.driver.onlineSince || null,
      };
    }
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
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { data, isLoading, error, refetch, isRefetching } = useAdminToday();
  const [tab, setTab] = useState("hari-ini");
  const [periode, setPeriode] = useState("bulan-ini");

  const jobs = data?.jobs || [];
  const issues = data?.issues || [];
  const tracking = data?.tracking || [];

  const ringkasan = useMemo(() => ringkasHariIni(jobs), [jobs]);
  const drivers = useMemo(() => ringkasDriver(jobs, tracking), [jobs, tracking]);

  const { from, to } = useMemo(() => rentangPeriode(periode), [periode]);
  const performa = useRouteIncentiveSummary(from, to);

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

      {tab === "performa" ? (
        <PerformaView
          performa={performa}
          periode={periode}
          setPeriode={setPeriode}
          theme={theme}
          styles={styles}
        />
      ) : isLoading ? (
        <View style={styles.center}><ActivityIndicator color={theme.ACCENT} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>Gagal memuat: {error.message}</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.ACCENT} />}
        >
          {tab === "hari-ini" && <HariIniView ringkasan={ringkasan} theme={theme} styles={styles} />}
          {tab === "driver" && <DriverView drivers={drivers} theme={theme} styles={styles} />}
          {tab === "masalah" && <MasalahView issues={issues} theme={theme} styles={styles} />}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Kpi({ label, value, color, styles }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, color && { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function HariIniView({ ringkasan, theme: t, styles }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.kpiGrid}>
        <Kpi label="Total Job" value={ringkasan.total} styles={styles} />
        <Kpi label="Selesai" value={ringkasan.selesai} color={t.GREEN} styles={styles} />
        <Kpi label="Jalan" value={ringkasan.jalan} color={t.ACCENT} styles={styles} />
        <Kpi label="Gagal" value={ringkasan.gagal} color={t.RED} styles={styles} />
        <Kpi label="Sisa" value={ringkasan.sisa} color={t.INK2} styles={styles} />
      </View>

      <Text style={styles.sectionTitle}>Rute Hari Ini ({ringkasan.routes.length})</Text>
      {ringkasan.routes.length === 0 ? (
        <Text style={styles.emptyText}>Belum ada rute untuk hari ini.</Text>
      ) : (
        ringkasan.routes.map((r) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Route size={14} color={t.ACCENT} />
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

function DriverView({ drivers, theme: t, styles }) {
  if (drivers.length === 0) return <Text style={styles.emptyText}>Belum ada driver bertugas hari ini.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {drivers.map((d) => (
        <View key={d.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {/* Titik Online/Offline (12 Sep 2026) — BUKAN "sedang jalan"
                  (badge "Di jalan" di sebelah kanan sudah pakai itu), ini
                  murni toggle manual driver di app-nya. */}
              <View style={[styles.onlineDot, { backgroundColor: d.isOnline ? t.GREEN : t.INK3 }]} />
              <Text style={styles.cardTitle}>{d.name}</Text>
            </View>
            {d.jalan > 0 ? (
              <View style={styles.liveBadge}>
                <Truck size={11} color={t.ACCENT} />
                <Text style={styles.liveBadgeText}>Di jalan</Text>
              </View>
            ) : (
              <Text style={styles.cardMeta}>Tidak sedang jalan</Text>
            )}
          </View>
          <View style={styles.driverStatsRow}>
            <Text style={styles.driverStat}><Text style={{ color: t.GREEN }}>{d.selesai}</Text> selesai</Text>
            <Text style={styles.driverStat}><Text style={{ color: t.ACCENT }}>{d.jalan}</Text> jalan</Text>
            <Text style={styles.driverStat}><Text style={{ color: d.gagal > 0 ? t.RED : t.INK2 }}>{d.gagal}</Text> gagal</Text>
            <Text style={styles.driverStat}><Text style={{ color: t.INK2 }}>{d.sisa}</Text> sisa</Text>
          </View>
          {d.lastSeen && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
              <Clock size={11} color={t.INK3} />
              <Text style={styles.lastSeenText}>Posisi terakhir {relatifWaktu(d.lastSeen)}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function MasalahView({ issues, theme: t, styles }) {
  if (issues.length === 0) {
    return (
      <View style={styles.center}>
        <CheckCircle2 size={28} color={t.GREEN} />
        <Text style={[styles.emptyText, { marginTop: 8 }]}>Tidak ada masalah terbuka.</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {issues.map((j) => (
        <View key={j.id} style={[styles.card, { borderColor: t.RED + "4D", borderWidth: 1 }]}>
          <View style={styles.rowBetween}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <XCircle size={14} color={t.RED} />
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

// Tab Performa (12 Sep 2026, permintaan owner: "insentif sistem kita
// menghitung nya per jalur, jadi boleh ada status masing-masing driver/
// helper ada status sudah berapa jalur mereka, dan bisa disetting
// tanggal"). "Jalur" = Route selesai, dipisah asDriver/asHelper (satu
// orang bisa dua peran). Query terpisah dari useAdminToday (rentang
// tanggalnya beda, bukan "hari ini") — lihat useRouteIncentiveSummary.js.
function PerformaView({ performa, periode, setPeriode, theme: t, styles }) {
  const { data, isLoading, error, refetch, isRefetching } = performa;
  const orang = data?.orang || [];
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.ACCENT} />}
    >
      <View style={styles.periodeRow}>
        {PERIODE_PRESET.map((p) => (
          <Pressable
            key={p.key}
            style={[styles.periodeChip, periode === p.key && styles.periodeChipActive]}
            onPress={() => setPeriode(p.key)}
          >
            <Text style={[styles.periodeChipText, periode === p.key && styles.periodeChipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={t.ACCENT} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.errorText}>Gagal memuat: {error.message}</Text></View>
      ) : orang.length === 0 ? (
        <Text style={styles.emptyText}>Belum ada rute selesai di periode ini.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {orang.map((o, i) => (
            <View key={o.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Award size={14} color={i === 0 ? t.ORANGE : t.INK3} />
                  <Text style={styles.cardTitle}>{o.name}</Text>
                </View>
                <Text style={[styles.kpiValue, { fontSize: 16 }]}>{o.total} <Text style={styles.cardMeta}>jalur</Text></Text>
              </View>
              <View style={styles.driverStatsRow}>
                <Text style={styles.driverStat}>Sebagai driver: <Text style={{ color: t.ACCENT }}>{o.asDriver}</Text></Text>
                <Text style={styles.driverStat}>Sebagai helper: <Text style={{ color: t.ACCENT }}>{o.asHelper}</Text></Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.NAVY },
    header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    title: { fontSize: 22, fontWeight: "800", color: t.INK },
    subtitle: { fontSize: 12.5, color: t.INK2, marginTop: 2 },
    logoutBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: t.BORDER },
    logoutText: { color: t.ACCENT, fontWeight: "700", fontSize: 12.5 },
    tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
    tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 100 },
    tabActive: { backgroundColor: t.ACCENT_BG },
    tabText: { color: t.INK2, fontSize: 12.5, fontWeight: "600" },
    tabTextActive: { color: t.ACCENT },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: 40 },
    errorText: { color: t.RED, fontSize: 13, textAlign: "center" },
    emptyText: { color: t.INK2, fontSize: 13, textAlign: "center" },
    body: { paddingHorizontal: 16, paddingBottom: 24 },
    kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    kpi: { flexBasis: "31%", flexGrow: 1, backgroundColor: t.SURFACE, borderRadius: 14, paddingVertical: 12, alignItems: "center" },
    kpiValue: { color: t.INK, fontSize: 20, fontWeight: "800" },
    kpiLabel: { color: t.INK2, fontSize: 10.5, marginTop: 2, fontWeight: "600" },
    sectionTitle: { color: t.INK, fontSize: 14, fontWeight: "700", marginTop: 4 },
    card: { backgroundColor: t.SURFACE, borderRadius: 14, padding: 12 },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { color: t.INK, fontSize: 13.5, fontWeight: "700" },
    cardMeta: { color: t.INK2, fontSize: 11, marginTop: 1 },
    progressTrack: { height: 5, borderRadius: 3, backgroundColor: t.TRACK_BG, marginTop: 8, overflow: "hidden" },
    progressFill: { height: 5, borderRadius: 3, backgroundColor: t.ACCENT },
    liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: t.ACCENT_BG, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
    liveBadgeText: { color: t.ACCENT, fontSize: 10.5, fontWeight: "700" },
    driverStatsRow: { flexDirection: "row", gap: 14, marginTop: 8 },
    driverStat: { color: t.INK2, fontSize: 11.5, fontWeight: "600" },
    lastSeenText: { color: t.INK3, fontSize: 10.5 },
    issueReason: { color: t.ORANGE, fontSize: 12, fontWeight: "600", marginTop: 6 },
    onlineDot: { width: 8, height: 8, borderRadius: 4 },
    periodeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
    periodeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1, borderColor: t.BORDER },
    periodeChipActive: { backgroundColor: t.ACCENT_BG, borderColor: t.ACCENT },
    periodeChipText: { color: t.INK2, fontSize: 12, fontWeight: "600" },
    periodeChipTextActive: { color: t.ACCENT },
  });
}
