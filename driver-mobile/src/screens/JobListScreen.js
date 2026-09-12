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
import GradientCard from "../components/GradientCard";

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
      {/* Hero card gradasi (12 Sep 2026, fase 3 redesign — referensi
          Gojek/DelTrack) — gabungan sapaan + toggle Online/Offline yang
          dulunya 2 elemen terpisah (header polos + kotak status). Toggle
          MURNI status, BUKAN "terima order" (order di sini sudah
          ditentukan PIC-nya dispatcher) — kegunaannya gerbang GPS
          tracking, lihat useDriverTracking.js. */}
      <GradientCard colors={theme.GRADIENT} style={styles.hero}>
        <View style={styles.heroTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroGreeting}>Halo, {user?.name || "Driver"}</Text>
            <Text style={styles.heroSubtitle}>Semoga perjalanan hari ini lancar</Text>
          </View>
          <Pressable onPress={logout} style={styles.heroLogoutBtn}>
            <Text style={styles.heroLogoutText}>Keluar</Text>
          </Pressable>
        </View>

        <View style={styles.heroOnlineRow}>
          <View style={[styles.onlineDot, { backgroundColor: isOnline ? "#3DDC84" : "rgba(255,255,255,0.45)" }]} />
          <Text style={styles.heroOnlineText}>{isOnline ? "Online" : "Offline"}</Text>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            disabled={togglingOnline}
            trackColor={{ false: "rgba(255,255,255,0.25)", true: "rgba(61,220,132,0.55)" }}
            thumbColor={isOnline ? "#3DDC84" : "#FFFFFF"}
            style={{ marginLeft: "auto" }}
          />
        </View>
      </GradientCard>

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
    hero: {
      marginHorizontal: 16, marginTop: 8, marginBottom: 14,
      shadowColor: t.ACCENT, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6,
    },
    heroTopRow: { flexDirection: "row", alignItems: "flex-start" },
    heroGreeting: { fontSize: 19, fontWeight: "800", color: "#FFFFFF" },
    heroSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
    heroLogoutBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
    heroLogoutText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },
    heroOnlineRow: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)",
    },
    heroOnlineText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
    onlineDot: { width: 8, height: 8, borderRadius: 4 },
    // paddingBottom 96 (bukan 24) — ruang buat BottomNavBar melayang
    // (fase 2 redesign, lihat BottomNavBar.js) supaya card terakhir tidak
    // ketutupan bar.
    list: { paddingHorizontal: 16, paddingBottom: 96 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 80 },
    errorText: { color: t.RED, fontSize: 13, textAlign: "center" },
    emptyText: { color: t.INK2, fontSize: 13, textAlign: "center" },
  });
}
