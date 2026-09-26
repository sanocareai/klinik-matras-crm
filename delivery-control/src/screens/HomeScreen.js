import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../SessionContext";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { ActionModal, Box, Gradient, IconBox, IconButton } from "../ui";
import { BottomNav, NAV_SPACE } from "../BottomNav";
import { labelJumlah, useRingkasanBiaya } from "../ringkasan";

// Modul Delivery Control. Hanya Biaya Armada yang aktif; sisanya tampil tipis dengan label "Segera"
// (tidak bisa ditekan, tidak ada layar palsu). Route Planner kompleks, aksi massal, master data,
// pengaturan, rekonsiliasi, laporan, dan ekspor besar SENGAJA tetap di web.
const MODULES = [
  { key: "biaya", title: "Biaya Armada", icon: "wallet", ready: true },
  { key: "driver", title: "Driver", icon: "users", ready: false },
  { key: "rute", title: "Rute", icon: "route", ready: false },
  { key: "tracking", title: "Tracking", icon: "mapPin", ready: false },
  { key: "masalah", title: "Masalah", icon: "alert", ready: false },
  { key: "performa", title: "Performa", icon: "chart", ready: false },
];

const ROLE_LABEL = { OWNER: "Owner", ADMIN: "Admin", DISPATCHER: "Dispatcher", FINANCE: "Finance", ACCOUNTANT: "Akuntan", APPROVER: "Approver" };

function sapaan() {
  const jam = new Date(Date.now() + 7 * 3600_000).getUTCHours();
  if (jam < 11) return "Selamat pagi";
  if (jam < 15) return "Selamat siang";
  if (jam < 18) return "Selamat sore";
  return "Selamat malam";
}

function inisial(nama) {
  return String(nama || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";
}

export default function HomeScreen({ navigation }) {
  const t = useTheme();
  const { user, signOut, offline } = useSession();
  const ringkasan = useRingkasanBiaya(navigation);
  const [keluar, setKeluar] = useState(false);
  const [segar, setSegar] = useState(false);

  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const peran = roles.map((r) => ROLE_LABEL[r]).filter(Boolean)[0] || "Tim armada";
  const revisi = ringkasan.data.PERLU_REVISI;
  const perluTindakan = revisi?.n || 0;
  const bukaBiaya = (stage) => navigation.navigate("BiayaArmada", stage ? { stage } : undefined);
  const lainnya = MODULES.filter((m) => !m.ready);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: NAV_SPACE + 24 }]}
        refreshControl={<RefreshControl refreshing={segar} tintColor={t.accent} colors={[t.accent]} onRefresh={async () => { setSegar(true); await ringkasan.muat(); setSegar(false); }} />}
      >
        {/* Header: identitas + notifikasi + keluar (tidak dominan) */}
        <View style={s.head}>
          <Gradient colors={t.hero.slice(1)} radius={24} style={s.avatar}>
            <Text style={s.avatarTxt}>{inisial(user?.name)}</Text>
          </Gradient>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: t.ink2 }]}>{sapaan()},</Text>
            <Text style={[type.title, { color: t.ink }]} numberOfLines={1}>{user?.name || "Admin"}</Text>
            <View style={[s.rolePill, { backgroundColor: t.accentBg }]}>
              <Icon name="shield" size={12} color={t.accent} />
              <Text style={{ color: t.accent, fontSize: 11, fontWeight: "700" }}>{peran}</Text>
            </View>
          </View>
          <IconButton icon="bell" label={perluTindakan ? `${perluTindakan} pengajuan perlu revisi` : "Pengajuan yang menunggu"} badge={perluTindakan}
            onPress={() => bukaBiaya(perluTindakan ? "PERLU_REVISI" : "DIAJUKAN")} />
          <IconButton icon="logout" label="Keluar" onPress={() => setKeluar(true)} />
        </View>

        {offline && <Box tone="orange" icon="cloudOff">Server belum terjangkau. Menampilkan sesi terakhir.</Box>}

        {/* Hero Delivery Control */}
        <Gradient colors={t.hero} radius={radius.xl} style={[s.hero, elevation(t, 2)]}>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[s.pill, { right: -18, top: 22, width: 120 }]} />
            <View style={[s.pill, { right: 40, top: 70, width: 84, opacity: 0.1 }]} />
            <View style={[s.pill, { right: -30, top: 118, width: 150, opacity: 0.08 }]} />
          </View>
          <View style={s.heroTop}>
            <View style={[s.heroBadge]}>
              <Icon name="truck" size={14} color="#FFFFFF" />
              <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>DELIVERY CONTROL</Text>
            </View>
          </View>
          <Text style={[s.heroTitle, { color: t.heroInk }]}>Ringkasan biaya armada</Text>
          <Text style={{ color: t.heroInk2, fontSize: 13 }}>Pengajuan yang perlu diperhatikan tim hari ini.</Text>
          <View style={s.stats}>
            {[
              { k: "DIAJUKAN", label: "Menunggu" },
              { k: "PERLU_REVISI", label: "Perlu revisi" },
              { k: "DRAF", label: "Draf" },
            ].map((x, i) => (
              <Pressable key={x.k} onPress={() => bukaBiaya(x.k)} style={[s.stat, i > 0 && s.statSep]} accessibilityRole="button" accessibilityLabel={`${x.label}: ${labelJumlah(ringkasan.data[x.k])}`}>
                <Text style={s.statNum}>{ringkasan.status === "gagal" ? "!" : labelJumlah(ringkasan.data[x.k])}</Text>
                <Text style={{ color: t.heroInk2, fontSize: 12, fontWeight: "600" }}>{x.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => bukaBiaya()} accessibilityRole="button" style={({ pressed }) => [s.cta, { opacity: pressed ? 0.9 : 1 }]}>
            <Text style={{ color: t.navy, fontWeight: "800", fontSize: 15 }}>Buka Biaya Armada</Text>
            <View style={[s.ctaArrow, { backgroundColor: t.navy }]}><Icon name="arrowUpRight" size={16} color="#FFFFFF" /></View>
          </Pressable>
        </Gradient>
        {ringkasan.status === "gagal" && <Box tone="orange" icon="refresh">Ringkasan belum dapat dimuat. Tarik layar ke bawah untuk mencoba lagi.</Box>}

        {/* Modul */}
        <View style={s.sectionHead}>
          <Text style={[type.heading, { color: t.ink }]}>Modul</Text>
          <Text style={[type.caption, { color: t.ink3 }]}>Ketuk untuk membuka</Text>
        </View>

        {MODULES.filter((m) => m.ready).map((m) => (
          <Pressable
            key={m.key} disabled={!m.ready} onPress={() => m.key === "biaya" && bukaBiaya()} accessibilityRole="button" accessibilityLabel={m.title}
            style={({ pressed }) => [s.feature, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.9 : 1 }, elevation(t, 1)]}
          >
            <Gradient colors={[t.accentSoft, t.surface]} radius={radius.lg} style={StyleSheet.absoluteFill} />
            <IconBox name={m.icon} tone="accent" size={52} solid />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={[type.heading, { color: t.ink }]}>{m.title}</Text>
                <View style={[s.aktif, { backgroundColor: t.greenBg }]}><Text style={{ color: t.green, fontSize: 10, fontWeight: "800" }}>AKTIF</Text></View>
              </View>
              <Text style={{ color: t.ink2, fontSize: 13 }}>Catat, periksa, setujui, dan lacak biaya operasional armada.</Text>
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: "700", marginTop: 2 }}>
                {ringkasan.status === "siap" ? `${labelJumlah(ringkasan.data.DISETUJUI)} disetujui · ${labelJumlah(ringkasan.data.DIAJUKAN)} menunggu` : "Memuat ringkasan…"}
              </Text>
            </View>
            <View style={[s.arrow, { backgroundColor: t.accent }]}><Icon name="arrowUpRight" size={18} color={t.accentInk} /></View>
          </Pressable>
        ))}

        <View style={[s.soonCard, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={s.soonHead}>
            <Text style={[type.label, { color: t.ink2, flex: 1 }]}>Segera hadir di aplikasi</Text>
            <Text style={[type.caption, { color: t.ink3 }]}>Saat ini tersedia di web</Text>
          </View>
          <View style={s.soonGrid}>
            {lainnya.map((m) => (
              <Pressable key={m.key} disabled={!m.ready} accessibilityState={{ disabled: true }} accessibilityLabel={`${m.title}, segera`} style={s.soonItem}>
                <View style={[s.soonIcon, { backgroundColor: t.neutralBg }]}><Icon name={m.icon} size={20} color={t.ink3} /></View>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{m.title}</Text>
                <Text style={{ color: t.ink3, fontSize: 10, fontWeight: "700", letterSpacing: 0.4 }}>SEGERA</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.webNote}>
          <Icon name="info" size={14} color={t.ink3} />
          <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>Route Planner, aksi massal, master data, dan laporan tetap di web.</Text>
        </View>
      </ScrollView>

      <BottomNav navigation={navigation} current="Home" />

      <ActionModal
        visible={keluar} title="Keluar dari akun?" message="Anda perlu masuk lagi untuk membuka Delivery Control." icon="logout"
        confirmLabel="Keluar" danger onCancel={() => setKeluar(false)} onConfirm={() => { setKeluar(false); signOut(); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 18, paddingTop: 12, gap: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  avatarTxt: { color: "#FFFFFF", fontWeight: "800", fontSize: 17 },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  hero: { padding: 20, gap: 6 },
  pill: { position: "absolute", height: 36, borderRadius: 18, backgroundColor: "#FFFFFF", opacity: 0.12 },
  heroTop: { flexDirection: "row", marginBottom: 8 },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  heroTitle: { fontSize: 24, fontWeight: "800", letterSpacing: -0.4 },
  stats: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.lg, paddingVertical: 12, marginTop: 12 },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statSep: { borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  statNum: { color: "#FFFFFF", fontSize: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  cta: { marginTop: 14, backgroundColor: "#FFFFFF", borderRadius: radius.pill, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 6 },
  ctaArrow: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 },
  feature: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  aktif: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  arrow: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  soonCard: { borderRadius: radius.lg, borderWidth: 1, padding: 14, gap: 12 },
  soonHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  soonGrid: { flexDirection: "row", justifyContent: "space-between" },
  soonItem: { alignItems: "center", gap: 4, flex: 1, opacity: 0.85 },
  soonIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  webNote: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingHorizontal: 8 },
});
