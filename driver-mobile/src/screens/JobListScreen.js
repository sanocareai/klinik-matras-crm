// Job list sungguhan — milestone 2 (lihat plan driver-mobile). Job
// terkonfirmasi (start/arrive/complete/fail, foto wajib) SUDAH jalan
// lewat backend yang SAMA dipakai PWA/APK Capacitor driver-app/. Light/
// dark ikut sistem HP (10 Sep 2026, lihat src/theme.js/useTheme.js).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Switch, Alert } from "react-native";
// SafeAreaView BAWAAN react-native TIDAK menghormati status bar di Android
// (cuma efektif utk notch iOS) — akar bug "layout ketutupan icon
// notifikasi" (laporan owner 10 Sep 2026). Ganti ke react-native-safe-
// area-context (SUDAH ada, dipakai SafeAreaProvider di App.js) yang
// benar-benar mengukur inset status bar di kedua platform.
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Home, History } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { useMyJobs } from "../hooks/useMyJobs";
import { useDriverTracking } from "../hooks/useDriverTracking";
import JobCard from "../components/JobCard";
import RouteStartCard from "../components/RouteStartCard";
import BottomNavBar from "../components/BottomNavBar";

const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE", "ARRIVED"];

// Nav bawah (12 Sep 2026, fase 2 redesign) — menggantikan tab pill yang
// dulu di atas konten, lihat BottomNavBar.js.
const NAV_ITEMS = [
  { key: "aktif", label: "Aktif", icon: Home },
  { key: "riwayat", label: "Riwayat", icon: History },
];

export default function JobListScreen() {
  const { user, logout, isOnline, setOnline } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { data: jobs, isLoading, error, refetch, isRefetching } = useMyJobs();
  const [showHistory, setShowHistory] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);

  // D-034 — kirim ping GPS selama ADA job EN_ROUTE, DAN Online (12 Sep
  // 2026 — gerbang isOnline ditambahkan di hook, lihat catatan panjang di
  // sana). Tidak melakukan apa pun (tidak minta izin lokasi sekalipun)
  // kalau Offline atau tidak ada job yang sedang berjalan.
  useDriverTracking(jobs, isOnline);

  // Toggle Online/Offline (12 Sep 2026, referensi Gojek/Grab, semi-
  // otomatis) — Offline WAJIB konfirmasi dulu (kalau ada job EN_ROUTE,
  // ditegaskan lagi supaya driver tidak tidak sengaja mematikan
  // tracking di tengah perjalanan), Online langsung tanpa konfirmasi
  // (tidak ada downside).
  async function toggleOnline(next) {
    if (togglingOnline) return;
    if (!next) {
      const adaJobJalan = (jobs || []).some((j) => j.status === "EN_ROUTE");
      const lanjut = await new Promise((resolve) => {
        Alert.alert(
          "Jadi Offline?",
          adaJobJalan
            ? "Masih ada job yang sedang dalam perjalanan. Kalau Offline, posisi Anda BERHENTI dilacak sampai Online lagi."
            : "Anda tidak akan terlacak sampai Online lagi.",
          [
            { text: "Batal", style: "cancel", onPress: () => resolve(false) },
            { text: "Ya, Offline", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      });
      if (!lanjut) return;
    }
    setTogglingOnline(true);
    try {
      await setOnline(next);
    } catch (e) {
      Alert.alert("Gagal", e.message || "Coba lagi.");
    } finally {
      setTogglingOnline(false);
    }
  }

  const activeJobs = (jobs || []).filter((j) => ACTIVE_STATUSES.includes(j.status));
  const doneJobs = (jobs || []).filter((j) => j.status === "COMPLETED" || j.status === "FAILED");
  const listData = showHistory ? doneJobs : activeJobs;

  // Rute hari ini — kartu "Mulai Perjalanan sekali" + "Buka Rute di Maps"
  // di atas daftar (tab Aktif saja). Satu kartu per rute yang masih punya
  // job belum selesai.
  const rutes = [];
  if (!showHistory) {
    const byId = new Map();
    for (const j of jobs || []) {
      if (!j.route || j.status === "COMPLETED" || j.status === "FAILED") continue;
      let r = byId.get(j.route.id);
      if (!r) {
        r = { route: j.route, assignedCount: 0, sampleJobId: null };
        byId.set(j.route.id, r);
      }
      if (j.status === "ASSIGNED") {
        r.assignedCount += 1;
        if (!r.sampleJobId) r.sampleJobId = j.id;
      }
    }
    rutes.push(...byId.values());
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Job Saya</Text>
          <Text style={styles.subtitle}>Halo, {user?.name || "Driver"}</Text>
        </View>
        <Pressable onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Keluar</Text>
        </Pressable>
      </View>

      {/* Online/Offline (12 Sep 2026, referensi Gojek/Grab driver app) —
          MURNI status, BUKAN "terima order" (order di sini sudah
          ditentukan PIC-nya dispatcher). Kegunaan: gerbang GPS tracking,
          lihat useDriverTracking.js. */}
      <View style={styles.onlineRow}>
        <View style={[styles.onlineDot, { backgroundColor: isOnline ? theme.GREEN : theme.INK3 }]} />
        <Text style={styles.onlineText}>{isOnline ? "Online" : "Offline"}</Text>
        <Switch
          value={isOnline}
          onValueChange={toggleOnline}
          disabled={togglingOnline}
          trackColor={{ false: theme.BORDER, true: theme.GREEN + "66" }}
          thumbColor={isOnline ? theme.GREEN : theme.INK3}
          style={{ marginLeft: "auto" }}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.ACCENT} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Gagal memuat: {error.message}</Text>
        </View>
      ) : listData.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {showHistory ? "Belum ada riwayat hari ini." : "Tidak ada job aktif sekarang."}
          </Text>
        </View>
      ) : (
        <FlashList
          data={listData}
          keyExtractor={(j) => j.id}
          renderItem={({ item }) => <JobCard job={item} onChanged={refetch} />}
          ListHeaderComponent={
            rutes.length > 0 ? (
              <View>
                {rutes.map((r) => (
                  <RouteStartCard
                    key={r.route.id}
                    route={r.route}
                    assignedCount={r.assignedCount}
                    sampleJobId={r.sampleJobId}
                    onChanged={refetch}
                  />
                ))}
              </View>
            ) : null
          }
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.ACCENT} />}
        />
      )}

      <BottomNavBar
        items={NAV_ITEMS}
        active={showHistory ? "riwayat" : "aktif"}
        onChange={(key) => setShowHistory(key === "riwayat")}
        theme={theme}
        badge={{ aktif: activeJobs.length }}
      />
    </SafeAreaView>
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
    onlineRow: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 9,
      borderRadius: 12, backgroundColor: t.SURFACE,
    },
    onlineDot: { width: 8, height: 8, borderRadius: 4 },
    onlineText: { color: t.INK, fontWeight: "700", fontSize: 13 },
    // paddingBottom 96 (bukan 24) — ruang buat BottomNavBar melayang
    // (fase 2 redesign, lihat BottomNavBar.js) supaya card terakhir tidak
    // ketutupan bar.
    list: { paddingHorizontal: 16, paddingBottom: 96 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 80 },
    errorText: { color: t.RED, fontSize: 13, textAlign: "center" },
    emptyText: { color: t.INK2, fontSize: 13, textAlign: "center" },
  });
}
