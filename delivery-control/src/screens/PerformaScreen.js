import React, { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatRupiah, periodeBulanIni, tanggalWIBPlus } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { tanggalWIB } from "../format";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, Gradient, StateView } from "../ui";

// Performa & estimasi insentif: GET /armada/incentive-summary?from&to — dihitung MESIN INSENTIF SERVER
// (alamat selesai per orang x tarif per alamat, tarif beda untuk pemegang SIM; freelance & kurir eksternal
// tidak dihitung). Aplikasi TIDAK menghitung ulang; angka ini estimasi, pembayaran resmi lewat Snapshot/Payout.
function periodeBulanLalu() {
  const awalIni = periodeBulanIni().from;
  const akhirLalu = new Date(`${awalIni}T00:00:00Z`);
  akhirLalu.setUTCDate(0);
  const to = akhirLalu.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 7)}-01`, to };
}
const PERIODE = [
  { k: "ini", label: "Bulan ini", ambil: periodeBulanIni },
  { k: "7", label: "7 hari", ambil: () => ({ from: tanggalWIBPlus(-6), to: tanggalWIBPlus(0) }) },
  { k: "lalu", label: "Bulan lalu", ambil: periodeBulanLalu },
];

export default function PerformaScreen({ navigation }) {
  const t = useTheme();
  const [pk, setPk] = useState("ini");
  const per = PERIODE.find((p) => p.k === pk).ambil();
  const q = useMuat(() => operasionalApi.insentif(per.from, per.to), [per.from, per.to], navigation);
  const orang = q.data?.orang || [];
  const totalAlamat = orang.reduce((n, o) => n + (o.totalAlamat || 0), 0);
  const totalInsentif = orang.reduce((n, o) => n + (o.totalInsentif || 0), 0);
  const tarif = q.data?.ratePerAlamat;
  const maks = Math.max(1, ...orang.map((o) => o.totalAlamat || 0));

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <FlatList
        data={q.status === "siap" ? orang : []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={s.tabs}>
              {PERIODE.map((p) => {
                const aktif = pk === p.k;
                return (
                  <Pressable key={p.k} onPress={() => setPk(p.k)} accessibilityRole="tab" accessibilityState={{ selected: aktif }}
                    style={[s.tab, { backgroundColor: aktif ? t.tabActive : t.surface, borderColor: aktif ? t.tabActive : t.border }]}>
                    <Text style={{ color: aktif ? t.tabActiveInk : t.ink2, fontWeight: "700", fontSize: 13 }}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Gradient colors={t.hero} radius={radius.xl} style={[s.hero, elevation(t, 2)]}>
              <Text style={{ color: t.heroInk2, fontSize: 12, fontWeight: "700", letterSpacing: 0.8 }}>ESTIMASI INSENTIF · {tanggalWIB(per.from)} – {tanggalWIB(per.to)}</Text>
              <Text style={{ color: "#FFFFFF", fontSize: 30, fontWeight: "800", letterSpacing: -0.6 }}>{q.status === "siap" ? formatRupiah(totalInsentif) : "–"}</Text>
              <Text style={{ color: t.heroInk2, fontSize: 13 }}>{totalAlamat} alamat selesai · {orang.length} orang</Text>
              {!!tarif && <Text style={{ color: t.heroInk2, fontSize: 12 }}>Tarif per alamat: {formatRupiah(tarif.withSim)} (ber-SIM) · {formatRupiah(tarif.withoutSim)} (tanpa SIM)</Text>}
            </Gradient>
            <View style={s.note}>
              <Icon name="info" size={14} color={t.ink3} />
              <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>Dihitung server dari job selesai. Pembayaran resmi melalui Snapshot & Pembayaran Insentif di web.</Text>
            </View>
          </View>
        }
        ListEmptyComponent={q.status === "memuat" ? <StateView loading title="Menghitung performa…" /> : q.status === "gagal" ? (
          <StateView icon="alert" tone="red" title="Performa belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : <StateView icon="chart" title="Belum ada alamat selesai" message="Belum ada job selesai pada periode ini." />}
        renderItem={({ item: o, index }) => (
          <View style={[s.item, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 1)]}>
            <Text style={{ color: index < 3 ? t.accent : t.ink3, fontWeight: "800", width: 22 }}>{index + 1}</Text>
            <Avatar name={o.name} size={40} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={s.row}>
                <Text style={[type.label, { color: t.ink, fontSize: 15, flex: 1 }]} numberOfLines={1}>{o.name}</Text>
                <Text style={[type.amount, { color: t.ink, fontSize: 15 }]}>{formatRupiah(o.totalInsentif)}</Text>
              </View>
              <View style={[s.bar, { backgroundColor: t.neutralBg }]}><View style={{ width: `${(o.totalAlamat / maks) * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.accent }} /></View>
              <View style={s.row}>
                <Text style={{ color: t.ink2, fontSize: 12, flex: 1 }}>{o.totalAlamat} alamat · {o.asDriver} sbg driver · {o.asHelper} sbg helper</Text>
                <Chip label={o.hasSim ? "SIM" : "Tanpa SIM"} tone={o.hasSim ? "green" : "neutral"} size="sm" />
              </View>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 18, gap: 10, paddingBottom: 32 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1 },
  hero: { padding: 20, gap: 4 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
});
