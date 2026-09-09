// Placeholder milestone 1 ("slice tercepat" — lihat plan) — HANYA
// memverifikasi pipeline login+navigasi+build EAS jalan end-to-end.
// Job list/detail sungguhan (state machine start/arrive/complete/fail,
// foto wajib, offline queue, GPS) MENYUSUL milestone berikutnya, port
// dari DriverJobs.jsx (frontend/src/pages/DriverJobs.jsx).
import React from "react";
import { View, Text, Pressable, StyleSheet, SafeAreaView } from "react-native";
import { useAuth } from "../context/AuthContext";

const NAVY = "#0A0D16";
const INK = "#F5F5F7";
const INK2 = "rgba(245,245,247,0.62)";
const ACCENT = "#4C8DFF";

export default function JobListScreen() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Job Saya</Text>
        <Text style={styles.subtitle}>Halo, {user?.name || "Driver"}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.placeholder}>
          Daftar job akan tampil di sini — sedang dibangun.
        </Text>
      </View>
      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Keluar</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  title: { fontSize: 22, fontWeight: "800", color: INK },
  subtitle: { fontSize: 13, color: INK2, marginTop: 2 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  placeholder: { color: INK2, fontSize: 13, textAlign: "center" },
  logout: { margin: 20, paddingVertical: 12, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  logoutText: { color: ACCENT, fontWeight: "700", fontSize: 14 },
});
