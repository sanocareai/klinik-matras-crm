// ProfileScreen (M-push, design M1) — card user, pengaturan notifikasi
// (master toggle + jam aktif), versi app + cek update, logout.
//
// ⚠️ Preferensi notifikasi (master toggle + jam aktif) BELUM ada endpoint
// backend (cek backend/src/routes/users.js — tidak ada field/route utk ini
// di User model). Disimpan LOKAL ke AsyncStorage utk sekarang — kalau
// endpoint sudah ada di masa depan, ganti persistensinya ke situ (interface
// getNotifPrefs/saveNotifPrefs di bawah sengaja dipisah supaya gampang
// diswap tanpa ubah UI).
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, Modal, ScrollView, Alert, Platform, ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Camera } from "lucide-react-native";
import { useTokens } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import Avatar from "../components/Avatar";

// Revisi 28 Jul 2026: expo-updates SEKARANG dikonfigurasi (app.json
// "updates"/"runtimeVersion" + channel per profil di eas.json, lihat
// `eas update:configure`) dan ter-link mulai versionCode 7 (v3.0.0) — jadi
// blok require() ini SEHARUSNYA selalu berhasil di build APK/EAS mulai
// sekarang. Tetap dibungkus try/catch (bukan import statis) sebagai
// pertahanan berlapis: kalau suatu saat dijalankan di Expo Go / dev client
// yang belum linking modulnya, app tidak crash total saat file ini
// dievaluasi — tombol "Cek Update" otomatis disabled dgn keterangan kecil,
// bukan seluruh layar Profil ikut mati.
let Updates = null;
try {
  Updates = require("expo-updates");
} catch (err) {
  console.warn("[ProfileScreen] expo-updates native module belum tersedia:", err.message);
  Updates = null;
}

const NOTIF_PREFS_KEY = "notifPrefs";
const DEFAULT_PREFS = { enabled: true, startHour: 8, endHour: 21 };
const HOURS = Array.from({ length: 24 }, (_, i) => i);

async function getNotifPrefs() {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

async function saveNotifPrefs(prefs) {
  await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

function fmtHour(h) {
  return `${String(h).padStart(2, "0")}.00`;
}

const ROLE_LABEL = { ADMIN: "Admin", SALES: "Sales" };

export default function ProfileScreen({ navigation }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { user, logout, updateUser } = useAuth();
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [hourPicker, setHourPicker] = useState(null); // "start" | "end" | null
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Tap avatar → pilih dari galeri (expo-image-picker, sudah dipakai di
  // AttachComposer.js) → upload lewat uploadFile() (pola sama dengan kirim
  // media chat) → backend kompres ke ~256px, balikin avatarUrl terbaru →
  // update AuthContext supaya langsung tampil di sini & Home tanpa reload.
  async function handlePickAvatar() {
    if (uploadingAvatar) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Izin diperlukan", "Aktifkan izin akses galeri untuk mengganti foto profil.");
      return;
    }
    // BUG (fix): allowsEditing:true dulu memanggil native crop Activity
    // Android terpisah — Activity itu berat (load bitmap resolusi penuh),
    // cukup sering bikin OS mematikan proses app ini di background karena
    // tekanan memori. Begitu proses mati, seluruh JS runtime (termasuk
    // Promise yang sedang nge-await launchImageLibraryAsync di bawah ini)
    // ikut hilang — app "cold start" ulang begitu user selesai crop &
    // kembali, mendarat di tab default (Home), upload TIDAK PERNAH jalan
    // sama sekali (bukan gagal, cuma tidak sempat mulai). Aman dihapus:
    // backend/src/routes/users.js #POST /me/avatar SUDAH crop persegi
    // sendiri (sharp .resize(256,256,{fit:"cover"})) apa pun aspect rasio
    // sumbernya — cropping di klien murni redundant. AttachComposer.js
    // (picker foto chat) juga TIDAK pernah pakai allowsEditing, ini
    // satu-satunya tempat yang beda sendiri.
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
      await updateUser({ avatarUrl: updated.avatarUrl });
    } catch (err) {
      Alert.alert("Gagal unggah foto", err.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    getNotifPrefs().then((p) => { setPrefs(p); setPrefsLoaded(true); });
  }, []);

  function updatePrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveNotifPrefs(next).catch(() => {}); // fire-and-forget, ini preferensi lokal saja
  }

  // Revisi 28 Jul 2026: app SEKARANG juga cek update OTOMATIS sekali tiap
  // dibuka (lib/autoUpdate.js, dipanggil dari App.js#Root) — tombol ini
  // jadi JALUR CADANGAN manual, bukan satu-satunya cara. Beda sengaja dari
  // versi otomatis: yang manual TAMPILKAN alert (sukses/gagal/sudah
  // terbaru) karena user MEMINTA aksi ini secara eksplisit, sedangkan versi
  // otomatis diam-diam total (lihat komentar di autoUpdate.js) supaya tidak
  // mengganggu di setiap app dibuka.
  async function handleCheckUpdate() {
    // Jaga-jaga ganda — tombol sudah disabled (lihat prop disabled di JSX)
    // kalau native module belum tersedia, tapi dicek lagi di sini supaya
    // fungsi ini aman dipanggil dari mana saja.
    if (!Updates) {
      Alert.alert("Cek Update", "Fitur ini belum tersedia di build sekarang — akan aktif di build berikutnya.");
      return;
    }
    if (isDevBuild()) {
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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Card user */}
        <View style={styles.card}>
          <TouchableOpacity style={styles.avatarWrap} onPress={handlePickAvatar} disabled={uploadingAvatar}>
            <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={64} />
            <View style={styles.avatarBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Camera size={13} color="#fff" strokeWidth={2.4} />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{ROLE_LABEL[user?.role] || user?.role}</Text>
          </View>
        </View>

        {/* Pengaturan notifikasi */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Notifikasi</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Aktifkan notifikasi</Text>
              <Text style={styles.rowHint}>Pesan masuk & ambil alih percakapan</Text>
            </View>
            <Switch
              value={prefs.enabled}
              onValueChange={(v) => updatePrefs({ enabled: v })}
              trackColor={{ false: tokens.color.border, true: tokens.color.accentSoft }}
              thumbColor={prefs.enabled ? tokens.color.accent : "#f4f3f4"}
              disabled={!prefsLoaded}
            />
          </View>

          <View style={[styles.row, !prefs.enabled && styles.rowDisabled]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Jam aktif</Text>
              <Text style={styles.rowHint}>Notifikasi hanya bunyi di jam ini</Text>
            </View>
            <View style={styles.hourRangeWrap}>
              <TouchableOpacity
                style={styles.hourBtn}
                disabled={!prefs.enabled}
                onPress={() => setHourPicker("start")}
              >
                <Text style={styles.hourBtnText}>{fmtHour(prefs.startHour)}</Text>
              </TouchableOpacity>
              <Text style={styles.hourSep}>–</Text>
              <TouchableOpacity
                style={styles.hourBtn}
                disabled={!prefs.enabled}
                onPress={() => setHourPicker("end")}
              >
                <Text style={styles.hourBtnText}>{fmtHour(prefs.endHour)}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.prefsNote}>
            Pengaturan ini tersimpan di HP ini saja (belum sinkron ke server).
          </Text>
        </View>

        {/* Versi app */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Tentang Aplikasi</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Versi</Text>
            <Text style={styles.rowValue}>{appVersion}{buildNumber ? ` (${buildNumber})` : ""}</Text>
          </View>
          <TouchableOpacity
            style={[styles.updateBtn, !Updates && styles.updateBtnDisabled]}
            onPress={handleCheckUpdate}
            disabled={checkingUpdate || !Updates}
          >
            <Text style={[styles.updateBtnText, !Updates && styles.updateBtnTextDisabled]}>
              {checkingUpdate ? "Mengecek…" : "Cek Update"}
            </Text>
          </TouchableOpacity>
          {!Updates && (
            <Text style={styles.updateUnavailableNote}>Tersedia di build berikutnya</Text>
          )}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Keluar</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Sheet pilih jam sederhana */}
      <Modal visible={!!hourPicker} transparent animationType="fade" onRequestClose={() => setHourPicker(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setHourPicker(null)}>
          <View style={styles.hourSheet}>
            <Text style={styles.sheetTitle}>
              {hourPicker === "start" ? "Jam Mulai" : "Jam Selesai"}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {HOURS.map((h) => (
                <TouchableOpacity
                  key={h}
                  style={styles.hourOption}
                  onPress={() => {
                    updatePrefs(hourPicker === "start" ? { startHour: h } : { endHour: h });
                    setHourPicker(null);
                  }}
                >
                  <Text style={styles.hourOptionText}>{fmtHour(h)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Cek update TIDAK BOLEH dipanggil di Expo Go / dev mode — checkForUpdateAsync
// dkk. me-reject promise-nya (lihat docs expo-updates). __DEV__ global
// disediakan Metro bundler, aman dipakai di mana saja.
function isDevBuild() {
  return __DEV__;
}

// GAP (fix): dulu err.message mentah ditampilkan apa adanya — untuk
// checkForUpdateAsync() ini SERING cuma bungkus native generik ("Call to
// function 'ExpoUpdates.checkForUpdateAsync' has been rejected → Caused by:
// Failed to check for update") yang TIDAK menjelaskan sebab sebenarnya ke
// user, bikin laporan bug sulit ditindaklanjuti (pesan yang dilaporkan cuma
// judul generik ini, bukan penyebab asli). Kategorikan pola yang DIKETAHUI,
// tapi TETAP sertakan pesan asli di detail — supaya kalau kategorinya salah
// tebak, info aslinya tidak hilang.
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
  // Bungkus generik native ("Call to function ... has been rejected → Caused
  // by: Failed to check for update") — dikonfirmasi 28 Jul 2026 ini pesan
  // paling sering muncul di lapangan. TIDAK menyebut sebab spesifik sama
  // sekali di level JS, jadi paling mungkin: internet putus/lemah SAAT itu,
  // server update (u.expo.dev) sedang tidak terjangkau, atau memang belum
  // pernah ada `eas update` dipublikasikan ke channel build ini (bukan bug).
  if (lower.includes("failed to check for update") || lower.includes("has been rejected")) {
    return "Gagal menghubungi server update saat ini. Kemungkinan: koneksi internet sedang lemah/putus, atau server update sedang tidak terjangkau. Coba lagi sebentar lagi — kalau terus gagal padahal internet lancar, laporkan ke admin.";
  }
  return null; // tidak dikenali — tampilkan pesan asli apa adanya
}

function createStyles(tokens) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: tokens.color.border,
  },
  backBtn: { paddingHorizontal: 8, width: 40 },
  backIcon: { color: tokens.color.textPrimary, fontSize: 30, lineHeight: 32 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 14 },
  card: {
    backgroundColor: tokens.color.card, borderRadius: tokens.radius.card, padding: 18,
    borderWidth: 1, borderColor: tokens.color.border, alignItems: "center",
  },
  avatarWrap: { width: 64, height: 64 },
  avatarBadge: {
    position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: tokens.color.accent, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: tokens.color.card,
  },
  userName: { marginTop: 10, fontSize: 17, fontWeight: "700", color: tokens.color.textPrimary },
  userEmail: { marginTop: 2, fontSize: 13, color: tokens.color.textSecondary },
  roleBadge: {
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12,
    backgroundColor: tokens.color.accentSoft,
  },
  roleBadgeText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent },
  sectionTitle: {
    alignSelf: "flex-start", fontSize: 13, fontWeight: "700", color: tokens.color.textSecondary,
    marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    width: "100%", paddingVertical: 10,
  },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { fontSize: 14, color: tokens.color.textPrimary, fontWeight: "600" },
  rowHint: { fontSize: 12, color: tokens.color.textMuted, marginTop: 2 },
  rowValue: { fontSize: 14, color: tokens.color.textSecondary },
  hourRangeWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  hourBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    backgroundColor: tokens.color.subtle, borderWidth: 1, borderColor: tokens.color.border,
  },
  hourBtnText: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary },
  hourSep: { color: tokens.color.textMuted },
  prefsNote: { alignSelf: "flex-start", fontSize: 11, color: tokens.color.textMuted, marginTop: 4 },
  updateBtn: {
    marginTop: 4, alignSelf: "stretch", backgroundColor: tokens.color.accentSoft,
    borderRadius: tokens.radius.control, paddingVertical: 10, alignItems: "center",
  },
  updateBtnText: { color: tokens.color.accent, fontWeight: "700", fontSize: 13 },
  updateBtnDisabled: { backgroundColor: tokens.color.subtle },
  updateBtnTextDisabled: { color: tokens.color.textMuted },
  updateUnavailableNote: { alignSelf: "center", fontSize: 11, color: tokens.color.textMuted, marginTop: 6 },
  logoutBtn: {
    backgroundColor: tokens.color.danger, borderRadius: tokens.radius.control,
    paddingVertical: 14, alignItems: "center",
  },
  logoutBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  hourSheet: {
    backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16,
  },
  sheetTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  hourOption: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  hourOptionText: { fontSize: 14, color: tokens.color.textPrimary, textAlign: "center" },
  });
}
