import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ringkasRute, routeStatusInfo } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useSession } from "../SessionContext";
import { useMuat } from "../useMuat";
import { tanggalWIB } from "../format";
import { elevation, radius, type, useTheme } from "../theme";
import { Avatar, Btn, Chip, ProgressBar, StateView } from "../ui";

// Riwayat rute satu orang: GET /armada/routes?driverId=&take= (server mencocokkan driver ATAU helper).
const PER = 30;

export default function KruDetailScreen({ route, navigation }) {
  const t = useTheme();
  const { id, name } = route.params;
  const { modules } = useSession();
  const q = useMuat(() => operasionalApi.rute({ driverId: id, take: PER }), [id], navigation);
  const rute = q.data?.routes || [];
  const selesai = rute.filter((r) => r.status === "COMPLETED").length;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <FlatList
        data={q.status === "siap" ? rute : []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={[s.head, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 1)]}>
            <Avatar name={name} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={[type.title, { color: t.ink }]} numberOfLines={1}>{name}</Text>
              <Text style={{ color: t.ink2, fontSize: 13 }}>{q.status === "siap" ? `${rute.length} rute terakhir · ${selesai} selesai` : "Memuat riwayat…"}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={q.status === "memuat" ? <StateView loading /> : q.status === "gagal" ? (
          <StateView icon="alert" tone="red" title="Riwayat belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : <StateView icon="route" title="Belum ada riwayat rute" />}
        renderItem={({ item: r }) => {
          const info = routeStatusInfo(r.status);
          const rk = ringkasRute(r);
          const peran = r.driverId === id ? "Driver" : "Helper";
          return (
            <Pressable disabled={!modules.routes} onPress={() => navigation.navigate("RuteDetail", { id: r.id })} accessibilityRole="button"
              style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.9 : 1 }, elevation(t, 1)]}>
              <View style={s.row}>
                <Text style={[type.label, { color: t.ink, fontSize: 15, flex: 1 }]}>{r.code}</Text>
                <Chip label={info.label} tone={info.tone} size="sm" />
              </View>
              <Text style={{ color: t.ink2, fontSize: 12 }}>{tanggalWIB(r.date)} · {peran} · {rk.selesai}/{rk.stop} stop{rk.gagal ? ` · ${rk.gagal} gagal` : ""}</Text>
              <ProgressBar value={rk.stop ? (rk.selesai / rk.stop) * 100 : 0} height={6} />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 18, gap: 10, paddingBottom: 32 },
  head: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.xl, borderWidth: 1, marginBottom: 4 },
  item: { gap: 6, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
