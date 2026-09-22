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
import { Home, History, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { useMyJobs } from "../hooks/useMyJobs";
import { useIssues } from "../hooks/useIssues";
import { useDriverTracking } from "../hooks/useDriverTracking";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import JobCard from "../components/JobCard";
import RouteStartCard from "../components/RouteStartCard";
import BottomNavBar from "../components/BottomNavBar";
import GradientCard from "../components/GradientCard";
import Avatar from "../components/Avatar";
import { customerOf, orderNumberOf, relatifWaktu, ISSUE_STATUS } from "../lib/jobHelpers";
import { deriveJobList } from "../lib/jobListDerive";

// Nav bawah (12 Sep 2026, fase 2 redesign) — menggantikan tab pill yang
// dulu di atas konten, lihat BottomNavBar.js. Tab "Masalah" (17 September
// 2026, laporan owner: "tab/section masalah tampilkan juga untuk driver")
// — port POLA yang SAMA dengan AdminHomeScreen.js (MasalahView di sana),
// TAPI dibatasi ke job milik driver sendiri di backend (GET /armada/issues
// sekarang menerima JOB_OWN_READ juga, lihat catatan panjang di
// backend/src/routes/armada.js). Read-only murni — driver TIDAK bisa
// menjadwalkan ulang dari sini, itu tetap dispatcher-only.
const NAV_ITEMS = [
  { key: "aktif", label: "Aktif", icon: Home },
  { key: "riwayat", label: "Riwayat", icon: History },
  { key: "masalah", label: "Masalah", icon: AlertTriangle },
];

export default function JobListScreen({ navigation }) {
  const { user, logout, isOnline, setOnline } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { data: jobs, isLoading, error, refetch, isRefetching, dataUpdatedAt, isFetching } = useMyJobs();
  const { data: issues, isLoading: issuesLoading, error: issuesError, refetch: refetchIssues, isRefetching: issuesRefetching } = useIssues();
  // Nama SENGAJA beda dari `isOnline` (status toggle Online/Offline driver,
  // dari useAuth di bawah) — dua konsep beda: ini status KONEKSI HP (NetInfo),
  // itu status KERJA driver (manual toggle). Ketimpa nama yang sama akan
  // membisukan salah satunya tanpa error (JS shadowing diam-diam).
  const hasConnection = useNetworkStatus();
  const [tab, setTab] = useState("aktif"); // "aktif" | "riwayat" | "masalah"
  const showHistory = tab === "riwayat";
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

  const { activeJobs, listData, rutes } = deriveJobList(jobs, { showHistory });

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
          {/* Tap avatar/nama → layar Akun (18 September 2026, foto profil +
              cek update — permintaan owner). Bukan tombol Keluar (itu tetap
              di heroLogoutBtn, jangan digabung — Keluar butuh akses cepat
              satu tap, jangan disembunyikan di balik layar lain). */}
          <Pressable style={styles.heroIdentityRow} onPress={() => navigation.navigate("Account")}>
            <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroGreeting}>Halo, {user?.name || "Driver"}</Text>
              <Text style={styles.heroSubtitle}>Semoga perjalanan hari ini lancar</Text>
            </View>
          </Pressable>
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

      {/* Strip status sinkron (22 September 2026, bug Agung/Difa — QA minta
          "indikator jika data berasal dari cache/offline") — SEBELUM ini
          tidak ada petunjuk sama sekali kenapa daftar job tidak
          berubah-ubah kalau sinyal HP hilang di lapangan, driver cuma bisa
          menebak. Ditampilkan di SEMUA tab (bukan cuma Aktif) supaya juga
          kelihatan saat driver sedang lihat Riwayat/Masalah. */}
      {tab !== "masalah" && (!hasConnection || (error && jobs)) ? (
        <View style={[styles.syncBar, { backgroundColor: (hasConnection ? theme.ORANGE : theme.RED) + "26" }]}>
          <Text style={[styles.syncBarText, { color: hasConnection ? theme.ORANGE : theme.RED }]}>
            {!hasConnection
              ? "Offline — menampilkan data tersimpan terakhir"
              : "Gagal sinkron data terbaru — mungkin belum terkini"}
            {dataUpdatedAt ? ` · diperbarui ${relatifWaktu(dataUpdatedAt)}` : ""}
          </Text>
          <Pressable onPress={() => refetch()} disabled={isFetching}>
            <Text style={[styles.syncBarRetry, { color: hasConnection ? theme.ORANGE : theme.RED }]}>
              {isFetching ? "Mencoba…" : "Coba Lagi"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {tab === "masalah" ? (
        <MasalahView
          issues={issues} isLoading={issuesLoading} error={issuesError}
          refetch={refetchIssues} isRefetching={issuesRefetching}
          theme={theme} styles={styles}
        />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.ACCENT} />
        </View>
      ) : error && !jobs ? (
        // Belum PERNAH berhasil memuat sama sekali (gagal di percobaan
        // pertama, tidak ada cache apa pun untuk ditampilkan) — satu-satunya
        // kondisi yang layak layar error PENUH (kalau sudah pernah ada data,
        // kegagalan refetch berikutnya cukup lewat syncBar di atas, daftar
        // lama TETAP tampil, lihat cabang FlashList di bawah).
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {!hasConnection ? "Anda sedang offline. Sambungkan internet lalu coba lagi." : `Gagal memuat: ${error.message}`}
          </Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Coba Lagi</Text>
          </Pressable>
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
        active={tab}
        onChange={setTab}
        theme={theme}
        badge={{ aktif: activeJobs.length, masalah: (issues || []).length }}
      />
    </SafeAreaView>
  );
}

// MasalahView (17 September 2026) — port dari MasalahView di
// AdminHomeScreen.js, TAPI datanya sudah dibatasi ke job milik driver
// sendiri di backend (bukan filter ulang di sini — satu sumber kebenaran
// dengan GET /armada/issues). BEDA dari versi admin: badge status
// (OPEN/RESCHEDULED, dari ISSUE_STATUS) ditambahkan supaya driver tahu
// apakah kendalanya SUDAH ditindaklanjuti dispatcher atau masih menunggu
// — admin tidak butuh ini karena mereka yang menindaklanjuti.
function MasalahView({ issues, isLoading, error, refetch, isRefetching, theme: t, styles }) {
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.ACCENT} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Gagal memuat: {error.message}</Text>
      </View>
    );
  }
  if (!issues || issues.length === 0) {
    return (
      <View style={styles.center}>
        <CheckCircle2 size={28} color={t.GREEN} />
        <Text style={[styles.emptyText, { marginTop: 8 }]}>Tidak ada masalah terbuka.</Text>
      </View>
    );
  }
  return (
    <FlashList
      data={issues}
      keyExtractor={(j) => j.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.ACCENT} />}
      renderItem={({ item: j }) => {
        const info = ISSUE_STATUS[j.issueStatus];
        return (
          <View style={[styles.issueCard, { borderColor: t.RED + "4D" }]}>
            <View style={styles.issueHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                <XCircle size={14} color={t.RED} />
                <Text style={styles.issueTitle}>{customerOf(j) || "Tanpa nama"}</Text>
              </View>
              <Text style={styles.issueMeta}>{relatifWaktu(j.updatedAt)}</Text>
            </View>
            {info && (
              <View style={[styles.issueStatusBadge, { backgroundColor: t[info.color] + "26" }]}>
                <Text style={[styles.issueStatusBadgeText, { color: t[info.color] }]}>{info.label}</Text>
              </View>
            )}
            <Text style={styles.issueReason}>{j.failureReason || j.rescheduleReason || "Tidak ada alasan tercatat"}</Text>
            <Text style={styles.issueMeta}>
              {orderNumberOf(j) || "—"} · {j.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
            </Text>
          </View>
        );
      }}
    />
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
    heroIdentityRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
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
    // Strip status sinkron (22 September 2026) — pita tipis, BUKAN modal/
    // alert (tidak boleh menghalangi driver kerja), cuma info pasif +
    // satu tombol retry kecil.
    syncBar: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: 10,
    },
    syncBarText: { flex: 1, fontSize: 11.5, fontWeight: "600" },
    syncBarRetry: { fontSize: 11.5, fontWeight: "800", marginLeft: 10 },
    retryBtn: {
      marginTop: 14, backgroundColor: t.ACCENT, borderRadius: 12,
      paddingVertical: 11, paddingHorizontal: 22,
    },
    retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    // Kartu tab Masalah (17 September 2026) — pola sama dengan styles.card
    // AdminHomeScreen.js (bg SURFACE, border tipis), warna border merah
    // muda konsisten dgn MasalahView versi admin.
    issueCard: { backgroundColor: t.SURFACE, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 10 },
    issueHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    issueTitle: { color: t.INK, fontSize: 14, fontWeight: "700" },
    issueMeta: { color: t.INK2, fontSize: 11, marginTop: 2 },
    issueStatusBadge: { alignSelf: "flex-start", borderRadius: 100, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
    issueStatusBadgeText: { fontSize: 10.5, fontWeight: "700" },
    issueReason: { color: t.INK, fontSize: 12.5, marginTop: 6, lineHeight: 17 },
  });
}
