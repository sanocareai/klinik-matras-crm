import React, { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ringkasRute, routeStatusInfo, tanggalWIBPlus } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, DateNav, ProgressBar, StateView } from "../ui";

// Rute per tanggal (histori): GET /armada/routes?date=. Baca-saja; penyusunan rute tetap di Route Planner web.
export default function RuteScreen({ route, navigation }) {
  const t = useTheme();
  const hariIni = tanggalWIBPlus(0);
  const [tanggal, setTanggal] = useState(route?.params?.tanggal || hariIni);
  const q = useMuat(() => operasionalApi.rute({ date: tanggal }), [tanggal], navigation);
  const rute = q.data?.routes || [];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <FlatList
        data={q.status === "siap" ? rute : []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <DateNav value={tanggal} onChange={setTanggal} today={hariIni} />
            {q.status === "siap" && <Text style={[type.caption, { color: t.ink3 }]}>{rute.length} rute</Text>}
          </View>
        }
        ListEmptyComponent={q.status === "memuat" ? <StateView loading title="Memuat rute…" /> : q.status === "gagal" ? (
          <StateView icon="alert" tone="red" title="Rute belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : <StateView icon="route" title="Belum ada rute" message="Tidak ada rute pada tanggal ini. Rute disusun di Route Planner web." />}
        renderItem={({ item: r }) => {
          const info = routeStatusInfo(r.status);
          const rk = ringkasRute(r);
          return (
            <Pressable onPress={() => navigation.navigate("RuteDetail", { id: r.id })} accessibilityRole="button" accessibilityLabel={`Rute ${r.code}`}
              style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.9 : 1 }, elevation(t, 1)]}>
              <View style={s.row}>
                <Text style={[type.heading, { color: t.ink, flex: 1 }]}>{r.code}</Text>
                <Chip label={info.label} tone={info.tone} size="sm" />
              </View>
              <View style={s.row}>
                <Avatar name={r.driver?.name} size={30} online={r.driver ? !!r.driver.isOnline : undefined} />
                <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }} numberOfLines={1}>{r.driver?.name || "Belum ada driver"}{r.helper?.name ? ` + ${r.helper.name}` : ""}</Text>
                {!!r.vehicle?.plateNumber && <Text style={{ color: t.ink3, fontSize: 12 }}>{r.vehicle.plateNumber}</Text>}
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}><ProgressBar value={rk.stop ? (rk.selesai / rk.stop) * 100 : 0} height={6} /></View>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: "700" }}>{rk.selesai}/{rk.stop} stop</Text>
                {rk.gagal > 0 && <View style={s.row}><Icon name="alert" size={13} color={t.red} /><Text style={{ color: t.red, fontSize: 12, fontWeight: "700" }}>{rk.gagal}</Text></View>}
              </View>
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
  item: { gap: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
