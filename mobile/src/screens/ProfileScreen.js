// ProfileScreen (M-push, design M1) — card user, pengaturan notifikasi
// (master toggle + jam aktif), versi app + cek update, logout.
//
// ⚠️ Preferensi notifikasi (master toggle + jam aktif) BELUM ada endpoint
// backend (cek backend/src/routes/users.js — tidak ada field/route utk ini
// di User model). Disimpan LOKAL ke AsyncStorage utk sekarang — kalau
// endpoint sudah ada di masa depan, ganti persistensinya ke situ (interface
// getNotifPrefs/saveNotifPrefs di bawah sengaja dipisah supaya gampang
// diswap tanpa ubah UI).
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, Modal, ScrollView, Alert, Platform,
} from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { tokens } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import Avatar from "../components/Avatar";

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
  const { user, logout } = useAuth();
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [hourPicker, setHourPicker] = useState(null); // "start" | "end" | null
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    getNotifPrefs().then((p) => { setPrefs(p); setPrefsLoaded(true); });
  }, []);

  function updatePrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveNotifPrefs(next).catch(() => {}); // fire-and-forget, ini preferensi lokal saja
  }

  async function handleCheckUpdate() {
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
      Alert.alert("Gagal cek update", err.message);
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
          <Avatar name={user?.name} size={64} />
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
          <TouchableOpacity style={styles.updateBtn} onPress={handleCheckUpdate} disabled={checkingUpdate}>
            <Text style={styles.updateBtnText}>{checkingUpdate ? "Mengecek…" : "Cek Update"}</Text>
          </TouchableOpacity>
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

const styles = StyleSheet.create({
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
