// Job list sungguhan — milestone 2 (lihat plan driver-mobile). Job
// terkonfirmasi (start/arrive/complete/fail, foto wajib) SUDAH jalan
// lewat backend yang SAMA dipakai PWA/APK Capacitor driver-app/. Light/
// dark ikut sistem HP (10 Sep 2026, lihat src/theme.js/useTheme.js).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from "react-native";
// SafeAreaView BAWAAN react-native TIDAK menghormati status bar di Android
// (cuma efektif utk notch iOS) — akar bug "layout ketutupan icon
// notifikasi" (laporan owner 10 Sep 2026). Ganti ke react-native-safe-
// area-context (SUDAH ada, dipakai SafeAreaProvider di App.js) yang
// benar-benar mengukur inset status bar di kedua platform.
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { useMyJobs } from "../hooks/useMyJobs";
import { useDriverTracking } from "../hooks/useDriverTracking";
import JobCard from "../components/JobCard";
import RouteStartCard from "../components/RouteStartCard";

const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE", "ARRIVED"];

export default function JobListScreen() {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { data: jobs, isLoading, error, refetch, isRefetching } = useMyJobs();
  const [showHistory, setShowHistory] = useState(false);

  // D-034 — kirim ping GPS selama ADA job EN_ROUTE. Tidak melakukan apa pun
  // (tidak minta izin lokasi sekalipun) kalau tidak ada job yang sedang
  // berjalan — lihat catatan di hook.
  useDriverTracking(jobs);

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

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, !showHistory && styles.tabActive]} onPress={() => setShowHistory(false)}>
          <Text style={[styles.tabText, !showHistory && styles.tabTextActive]}>Aktif ({activeJobs.length})</Text>
        </Pressable>
        <Pressable style={[styles.tab, showHistory && styles.tabActive]} onPress={() => setShowHistory(true)}>
          <Text style={[styles.tabText, showHistory && styles.tabTextActive]}>Riwayat ({doneJobs.length})</Text>
        </Pressable>
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
    tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
    tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 100 },
    tabActive: { backgroundColor: t.ACCENT_BG },
    tabText: { color: t.INK2, fontSize: 12.5, fontWeight: "600" },
    tabTextActive: { color: t.ACCENT },
    list: { paddingHorizontal: 16, paddingBottom: 24 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
    errorText: { color: t.RED, fontSize: 13, textAlign: "center" },
    emptyText: { color: t.INK2, fontSize: 13, textAlign: "center" },
  });
}
