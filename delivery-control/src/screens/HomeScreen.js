import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../SessionContext";
import { useTheme } from "../theme";

// Modul Delivery Control. Hanya Biaya Armada yang aktif di fondasi ini; sisanya
// ditandai "Berikutnya" apa adanya (jangan menampilkan layar palsu). Route Planner
// kompleks, aksi massal, master data, pengaturan, rekonsiliasi, laporan, dan
// ekspor besar SENGAJA tetap di web.
const MODULES = [
  { key: "biaya", title: "Biaya Armada", desc: "Input, verifikasi, persetujuan, dan histori biaya", ready: true },
  { key: "dashboard", title: "Dashboard operasional", desc: "Ringkasan job hari ini", ready: false },
  { key: "driver", title: "Driver", desc: "Daftar dan status driver/helper", ready: false },
  { key: "tracking", title: "Tracking", desc: "Posisi driver yang sedang jalan", ready: false },
  { key: "rute", title: "Rute", desc: "Status rute dan stop", ready: false },
  { key: "masalah", title: "Masalah", desc: "Kendala dan reschedule", ready: false },
  { key: "performa", title: "Performa", desc: "Alamat selesai dan estimasi insentif", ready: false },
  { key: "histori", title: "Histori & pencarian", desc: "Cari job, order, driver", ready: false },
  { key: "action", title: "Action Center", desc: "Hal yang perlu tindakan sekarang", ready: false },
];

export default function HomeScreen({ navigation }) {
  const t = useTheme();
  const { user, signOut, offline } = useSession();
  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={[s.hello, { color: t.ink2 }]}>Halo,</Text>
            <Text style={[s.name, { color: t.ink }]}>{user?.name || "Admin"}</Text>
          </View>
          <Pressable onPress={signOut}><Text style={{ color: t.accent, fontWeight: "700" }}>Keluar</Text></Pressable>
        </View>
        {offline && <View style={[s.note, { backgroundColor: t.orangeBg }]}><Text style={{ color: t.orange, fontSize: 13 }}>Server belum terjangkau. Menampilkan sesi terakhir.</Text></View>}
        {MODULES.map((m) => (
          <Pressable
            key={m.key} disabled={!m.ready} onPress={() => m.key === "biaya" && navigation.navigate("BiayaArmada")}
            style={[s.card, { backgroundColor: t.surface, borderColor: t.border, opacity: m.ready ? 1 : 0.6 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTitle, { color: t.ink }]}>{m.title}</Text>
              <Text style={{ color: t.ink2, fontSize: 13 }}>{m.desc}</Text>
            </View>
            <View style={[s.chip, { backgroundColor: m.ready ? t.greenBg : t.field }]}>
              <Text style={{ color: m.ready ? t.green : t.ink2, fontSize: 11, fontWeight: "700" }}>{m.ready ? "Aktif" : "Berikutnya"}</Text>
            </View>
          </Pressable>
        ))}
        <Text style={{ color: t.ink3, fontSize: 12, textAlign: "center", marginTop: 8 }}>
          Route Planner, aksi massal, master data, dan laporan tetap di web.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  hello: { fontSize: 13 },
  name: { fontSize: 22, fontWeight: "800" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 14 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  note: { borderRadius: 10, padding: 10 },
});
