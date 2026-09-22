// Layar Akun (18 September 2026, permintaan owner: "tambah foto profil
// yang bisa diganti-ganti + fitur cek update") — port dari
// mobile/src/screens/ProfileScreen.js (Sano Messenger), TANPA section
// preferensi notifikasi (itu Messenger-specific, belum ada equivalennya di
// driver app). Dibuka dari hero card JobListScreen (tap nama/avatar), BUKAN
// tab bottom-nav baru — 3 tab yang ada (Aktif/Riwayat/Masalah) sudah pas
// untuk kerja harian, Akun cuma dibuka sesekali.
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronRight, Award } from "lucide-react-native";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../context/AuthContext";
import { api, getServerUrl } from "../api";
import { useMyJobs } from "../hooks/useMyJobs";
import Avatar from "../components/Avatar";
import { relatifWaktu } from "../lib/jobHelpers";

// Samarkan ID (22 September 2026, diagnostics Akun) — CUID/UUID penuh
// (mis. "cmt2ynjxeaqhk7ywbnb7axcww") tetap CUKUP UNIK utk dicocokkan visual
// dgn database lewat 6 karakter depan + 4 belakang, tanpa menampilkan
// seluruh ID mentah di layar (permintaan eksplisit: "tersamarkan").
function samarkanId(id) {
  if (!id) return "-";
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

// Sama alasan dengan lib/autoUpdate.js/mobile ProfileScreen.js — require()
// dibungkus try/catch (bukan import statis) supaya evaluasi file ini tidak
// crash kalau native module expo-updates belum ter-link di build tertentu
// (mis. dev client lama); tombol "Cek Update" otomatis disabled saja.
let Updates = null;
try {
  Updates = require("expo-updates");
} catch (err) {
  console.warn("[AccountScreen] expo-updates native module belum tersedia:", err.message);
  Updates = null;
}

const ROLE_LABEL = { DRIVER: "Driver", HELPER: "Helper", LEADER_DRIVER: "Leader Driver", ADMIN: "Admin", DISPATCHER: "Dispatcher" };

function rolesOf(user) {
  if (Array.isArray(user?.roles) && user.roles.length > 0) return user.roles;
  return user?.role ? [user.role] : [];
}

export default function AccountScreen({ navigation }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { user, logout, updateUser } = useAuth();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const queryClient = useQueryClient();
  // Diagnostics (22 September 2026) — pakai CACHE useMyJobs yang SAMA
  // dengan JobListScreen (query key sama persis, lihat hooks/useMyJobs.js),
  // BUKAN fetch baru — buka layar Akun tidak boleh menambah trafik/baterai
  // di luar polling normal.
  const { data: myJobsData, dataUpdatedAt, refetch: refetchMyJobs, isFetching: myJobsFetching } = useMyJobs();
  const routesSnapshot = myJobsData?.routes || [];
  const jobsSnapshot = myJobsData?.jobs || [];

  // Tap avatar → pilih dari galeri → upload → backend kompres ke ~256px,
  // balikin avatarUrl terbaru → sinkron ke AuthContext supaya langsung
  // tampil di sini & hero card JobListScreen tanpa perlu logout/login.
  async function handlePickAvatar() {
    if (uploadingAvatar) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Izin diperlukan", "Aktifkan izin akses galeri untuk mengganti foto profil.");
      return;
    }
    // Sengaja TANPA allowsEditing:true — backend SUDAH crop persegi sendiri
    // (sharp .resize(256,256,{fit:"cover"})), cropping di klien redundant
    // dan pernah terbukti bikin crash memori Android di mobile/ (lihat
    // catatan panjang di ProfileScreen.js versi Messenger).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const updated = await api.uploadAvatar({
        uri: asset.uri,
        name: "avatar.jpg",
        type: asset.mimeType || "image/jpeg",
      });
      updateUser({ avatarUrl: updated.avatarUrl });
    } catch (err) {
      Alert.alert("Gagal unggah foto", err.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  // Beda dari checkForUpdateOnLaunch() (autoUpdate.js) yang diam-diam total
  // — tombol ini dipicu MANUAL, jadi wajib kasih feedback Alert supaya
  // driver tahu hasilnya (sukses/gagal/sudah terbaru).
  async function handleCheckUpdate() {
    if (!Updates) {
      Alert.alert("Cek Update", "Fitur ini belum tersedia di build sekarang — akan aktif di build berikutnya.");
      return;
    }
    if (__DEV__) {
      Alert.alert("Cek Update", "Fitur ini hanya aktif di APK hasil build (EAS), bukan di mode development.");
      return;
    }
    setCheckingUpdate(true);
    try {
      if (!Updates.isEnabled) {
        Alert.alert("Cek Update", "Fitur update otomatis belum aktif untuk build ini.");
        return;
      }
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert("Cek Update", "Aplikasi sudah versi terbaru.");
        return;
      }
      Alert.alert(
        "Update Tersedia",
        "Ada versi baru aplikasi. Unduh & pasang sekarang? App akan restart otomatis.",
        [
          { text: "Nanti", style: "cancel" },
          {
            text: "Update Sekarang",
            onPress: async () => {
              try {
                await Updates.fetchUpdateAsync();
                await Updates.reloadAsync();
              } catch (err) {
                Alert.alert("Gagal update", err.message);
              }
            },
          },
        ]
      );
    } catch (err) {
      const friendly = describeUpdateError(err);
      Alert.alert(
        "Gagal cek update",
        friendly ? `${friendly}\n\nDetail teknis: ${err.message}` : (err.message || "Error tidak diketahui")
      );
    } finally {
      setCheckingUpdate(false);
    }
  }

  // Hapus cache rute (22 September 2026, diagnostics — permintaan eksplisit
  // "tombol refresh serta hapus cache rute dengan konfirmasi") — beda dari
  // pull-to-refresh biasa (yang cuma refetch, data LAMA tetap tampil
  // sampai yang baru datang): ini BUANG dulu snapshot yang tersimpan di
  // memori (removeQueries), BARU refetch — kalau ada kecurigaan app
  // "nyangkut" nampilkan campuran data lama+baru yang aneh (harusnya
  // tidak pernah terjadi lagi setelah fix 22 Sep, tapi tombol ini jaring
  // pengaman manual buat driver/tim teknis tanpa perlu uninstall app).
  function handleClearRouteCache() {
    Alert.alert(
      "Hapus Cache Rute?",
      "Data rute & job yang tersimpan di HP ini akan dihapus, lalu diambil ulang dari server. Tidak menghapus akun/login Anda.",
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus & Ambil Ulang",
          onPress: async () => {
            queryClient.removeQueries({ queryKey: ["armada", "my-jobs"] });
            await refetchMyJobs();
          },
        },
      ]
    );
  }

  function handleLogout() {
    Alert.alert("Keluar", "Yakin ingin keluar dari akun ini?", [
      { text: "Batal", style: "cancel" },
      { text: "Keluar", style: "destructive", onPress: () => logout() },
    ]);
  }

  const appVersion = Constants.expoConfig?.version || "-";
  const buildNumber = Platform.OS === "android"
    ? Constants.expoConfig?.android?.versionCode
    : Constants.expoConfig?.ios?.buildNumber;
  const roleLabel = rolesOf(user).map((r) => ROLE_LABEL[r] || r).join(" / ") || "-";

  // Info runtime/OTA (22 September 2026, audit QA produksi — permintaan
  // eksplisit: "tambahkan tampilan versi app, runtime, dan update ID di
  // halaman Profil/Tentang agar mudah dicek"). AKAR MASALAHNYA yang mau
  // dijawab: dispatcher/tim teknis sebelum ini TIDAK PUNYA cara memastikan
  // dari HP driver sendiri apakah JS bundle yang berjalan itu sungguhan
  // update TERBARU (OTA) atau masih bundel LAMA yang dibundel ke APK saat
  // build (mis. kalau OTA gagal diterapkan diam-diam) — cuma bisa menebak
  // dari gejala di lapangan. Field-field ini API bawaan expo-updates,
  // BUKAN dari server kami:
  //   - isEmbeddedLaunch: true = jalan dari bundel BAWAAN APK (belum pernah
  //     ambil OTA sejak install/App baru dibuka pertama kali sesi ini),
  //     false = jalan dari update OTA yang sudah pernah berhasil diambil.
  //   - updateId/createdAt: identitas OTA yang SEDANG berjalan (null kalau
  //     isEmbeddedLaunch true).
  //   - channel/runtimeVersion: HARUS "preview"/"1.0.0" untuk build yang
  //     sekarang aktif di HP pilot (lihat catatan eas.json) — kalau beda,
  //     berarti HP ini pasang APK dari channel/runtime lain.
  const updateInfo = Updates
    ? {
        channel: Updates.channel || "-",
        runtimeVersion: Updates.runtimeVersion || "-",
        isEmbeddedLaunch: Updates.isEmbeddedLaunch,
        updateId: Updates.updateId || null,
        createdAt: Updates.createdAt || null,
      }
    : null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Akun</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Pressable style={styles.avatarWrap} onPress={handlePickAvatar} disabled={uploadingAvatar}>
            <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={64} />
            <View style={styles.avatarBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Camera size={13} color="#fff" strokeWidth={2.4} />
              )}
            </View>
          </Pressable>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleLabel}</Text>
          </View>
        </View>

        <Pressable style={styles.navCard} onPress={() => navigation.navigate("Performa")}>
          <View style={styles.navCardIcon}>
            <Award size={18} color={theme.ACCENT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navCardTitle}>Performa Saya</Text>
            <Text style={styles.navCardHint}>Lihat insentif & alamat yang sudah diselesaikan</Text>
          </View>
          <ChevronRight size={18} color={theme.INK3} />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tentang Aplikasi</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Versi</Text>
            <Text style={styles.rowValue}>{appVersion}{buildNumber ? ` (${buildNumber})` : ""}</Text>
          </View>
          {updateInfo && (
            <>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Channel</Text>
                <Text style={styles.rowValue} selectable>{updateInfo.channel}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Runtime</Text>
                <Text style={styles.rowValue} selectable>{updateInfo.runtimeVersion}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Sumber JS</Text>
                <Text style={styles.rowValue}>{updateInfo.isEmbeddedLaunch ? "Bawaan APK (belum ambil OTA)" : "Update OTA"}</Text>
              </View>
              {!updateInfo.isEmbeddedLaunch && (
                <>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Update ID</Text>
                    {/* selectable — supaya bisa di-copy-paste ke chat tim
                        teknis kalau perlu cocokkan dengan `eas update:list`,
                        bukan cuma dibaca sekilas. Dipotong ke 8 karakter
                        pertama (cukup unik utk dicocokkan visual, ID penuh
                        tetap ada via selectable+long-press). */}
                    <Text style={styles.rowValue} selectable>{updateInfo.updateId?.slice(0, 8) || "-"}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Update diambil</Text>
                    <Text style={styles.rowValue}>{updateInfo.createdAt ? relatifWaktu(updateInfo.createdAt) : "-"}</Text>
                  </View>
                </>
              )}
            </>
          )}
          <Pressable
            style={[styles.updateBtn, !Updates && styles.updateBtnDisabled]}
            onPress={handleCheckUpdate}
            disabled={checkingUpdate || !Updates}
          >
            <Text style={[styles.updateBtnText, !Updates && styles.updateBtnTextDisabled]}>
              {checkingUpdate ? "Mengecek…" : "Cek Update"}
            </Text>
          </Pressable>
          {!Updates && (
            <Text style={styles.updateUnavailableNote}>Tersedia di build berikutnya</Text>
          )}
        </View>

        {/* Diagnostics (22 September 2026, audit QA "Route Planner dan app
            harus identik") — supaya dispatcher/tim teknis bisa minta driver
            screenshot layar ini dan langsung cocokkan angka dengan Route
            Planner/database, tanpa perlu akses device driver sama sekali. */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Diagnostik</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>User ID</Text>
            <Text style={styles.rowValue} selectable>{samarkanId(user?.id)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Server</Text>
            <Text style={styles.rowValue} selectable>{getServerUrl()}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Terakhir ambil data</Text>
            {/* "Terakhir ambil data", BUKAN "tersinkron"/"diterima" — lihat
                catatan panjang di frontend/src/features/armada/components/
                RouteCard.jsx soal koreksi copy yang SAMA: field ini cuma
                bukti fetch API berhasil, bukan bukti driver sudah lihat. */}
            <Text style={styles.rowValue}>{dataUpdatedAt ? relatifWaktu(dataUpdatedAt) : "belum pernah"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Total job aktif</Text>
            <Text style={styles.rowValue}>{jobsSnapshot.length}</Text>
          </View>
          {routesSnapshot.map((r) => {
            // Jumlah stop SERVER (r.stopCount, dihitung backend) vs jumlah
            // yang BENAR-BENAR ada di array jobs sisi app untuk rute ini —
            // dua angka ini SEHARUSNYA selalu sama (satu sumber snapshot).
            // Kalau beda, itu sinyal jelas ada bug baru, bukan cuma dugaan.
            const dirender = jobsSnapshot.filter((j) => j.route?.id === r.id).length;
            const cocok = dirender === r.stopCount;
            return (
              <View key={r.id} style={styles.routeDiagBlock}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Rute</Text>
                  <Text style={styles.rowValue} selectable>{r.code}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Stop (server / app)</Text>
                  <Text style={[styles.rowValue, !cocok && { color: theme.RED }]}>
                    {r.stopCount} / {dirender}{!cocok ? " ⚠" : ""}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Revision</Text>
                  <Text style={styles.rowValue} selectable>{r.revision}</Text>
                </View>
              </View>
            );
          })}
          <View style={styles.diagBtnRow}>
            <Pressable style={[styles.diagBtn, { flex: 1 }]} onPress={() => refetchMyJobs()} disabled={myJobsFetching}>
              <Text style={styles.diagBtnText}>{myJobsFetching ? "Memuat…" : "Refresh"}</Text>
            </Pressable>
            <Pressable style={[styles.diagBtn, styles.diagBtnDanger, { flex: 1 }]} onPress={handleClearRouteCache}>
              <Text style={[styles.diagBtnText, styles.diagBtnDangerText]}>Hapus Cache Rute</Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Keluar</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function describeUpdateError(err) {
  const msg = err?.message || "";
  const lower = msg.toLowerCase();
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("timed out") || lower.includes("fetch")) {
    return "Tidak bisa terhubung ke server update — cek koneksi internet, lalu coba lagi.";
  }
  if (lower.includes("no update manifest") || lower.includes("no compatible update")) {
    return "Belum ada versi baru yang dipublikasikan untuk build ini (normal kalau memang belum ada update dirilis).";
  }
  if (lower.includes("runtimeversion") || lower.includes("runtime version")) {
    return "Build ini tidak cocok dengan versi update yang tersedia — perlu pasang APK baru, bukan lewat update ini.";
  }
  if (lower.includes("channel")) {
    return "Channel update untuk build ini belum dikonfigurasi dengan benar — hubungi admin.";
  }
  if (lower.includes("failed to check for update") || lower.includes("has been rejected")) {
    return "Gagal menghubungi server update saat ini. Kemungkinan: koneksi internet sedang lemah/putus, atau server update sedang tidak terjangkau. Coba lagi sebentar lagi — kalau terus gagal padahal internet lancar, laporkan ke admin.";
  }
  return null;
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.NAVY },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.BORDER,
    },
    backBtn: { paddingHorizontal: 8, width: 40 },
    backIcon: { color: t.INK, fontSize: 30, lineHeight: 32 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: t.INK },
    scrollContent: { padding: 16, paddingBottom: 40, gap: 14 },
    card: {
      backgroundColor: t.SURFACE, borderRadius: 14, padding: 18,
      borderWidth: 1, borderColor: t.BORDER, alignItems: "center",
    },
    avatarWrap: { width: 64, height: 64 },
    avatarBadge: {
      position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
      backgroundColor: t.ACCENT, alignItems: "center", justifyContent: "center",
      borderWidth: 2, borderColor: t.SURFACE,
    },
    userName: { marginTop: 10, fontSize: 17, fontWeight: "700", color: t.INK },
    userEmail: { marginTop: 2, fontSize: 13, color: t.INK2 },
    roleBadge: {
      marginTop: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12,
      backgroundColor: t.ACCENT_BG,
    },
    roleBadgeText: { fontSize: 12, fontWeight: "700", color: t.ACCENT },
    navCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: t.SURFACE, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: t.BORDER,
    },
    navCardIcon: {
      width: 36, height: 36, borderRadius: 10, backgroundColor: t.ACCENT_BG,
      alignItems: "center", justifyContent: "center",
    },
    navCardTitle: { fontSize: 14, fontWeight: "700", color: t.INK },
    navCardHint: { fontSize: 11.5, color: t.INK2, marginTop: 2 },
    sectionTitle: {
      alignSelf: "flex-start", fontSize: 13, fontWeight: "700", color: t.INK2,
      marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4,
    },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      width: "100%", paddingVertical: 10,
    },
    rowLabel: { fontSize: 14, color: t.INK, fontWeight: "600" },
    rowValue: { fontSize: 14, color: t.INK2 },
    updateBtn: {
      marginTop: 4, alignSelf: "stretch", backgroundColor: t.ACCENT_BG,
      borderRadius: 12, paddingVertical: 10, alignItems: "center",
    },
    updateBtnText: { color: t.ACCENT, fontWeight: "700", fontSize: 13 },
    updateBtnDisabled: { backgroundColor: t.TRACK_BG },
    updateBtnTextDisabled: { color: t.INK3 },
    updateUnavailableNote: { alignSelf: "center", fontSize: 11, color: t.INK3, marginTop: 6 },
    routeDiagBlock: {
      alignSelf: "stretch", marginTop: 4, paddingTop: 6,
      borderTopWidth: 1, borderTopColor: t.BORDER,
    },
    diagBtnRow: { flexDirection: "row", gap: 8, marginTop: 8, alignSelf: "stretch" },
    diagBtn: {
      backgroundColor: t.ACCENT_BG, borderRadius: 12, paddingVertical: 10, alignItems: "center",
    },
    diagBtnText: { color: t.ACCENT, fontWeight: "700", fontSize: 12.5 },
    diagBtnDanger: { backgroundColor: t.RED + "1A" },
    diagBtnDangerText: { color: t.RED },
    logoutBtn: {
      backgroundColor: t.RED, borderRadius: 12,
      paddingVertical: 14, alignItems: "center",
    },
    logoutBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
