import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { gabungKru, routeStatusInfo, tanggalWIBPlus } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, StateView } from "../ui";

// Driver & Helper: GET /armada/drivers + /armada/helpers (job:write), digabung per orang, plus penugasan rute
// hari ini dari GET /armada/routes?date=hari-ini. Status online dari rute (routeInclude) bila bertugas hari ini.
export default function KruScreen({ navigation }) {
  const t = useTheme();
  const [cari, setCari] = useState("");
  const hariIni = tanggalWIBPlus(0);
  const q = useMuat(async () => {
    const [drivers, helpers, rute] = await Promise.all([operasionalApi.driver(), operasionalApi.helper(), operasionalApi.rute({ date: hariIni })]);
    const tugas = new Map();
    for (const r of rute.routes || []) {
      if (r.driverId) tugas.set(r.driverId, { rute: r, sebagai: "Driver", online: r.driver?.isOnline });
      if (r.helperId) tugas.set(r.helperId, { rute: r, sebagai: "Helper", online: r.helper?.isOnline });
    }
    return gabungKru(drivers || [], helpers || []).map((k) => ({ ...k, tugas: tugas.get(k.id) || null }));
  }, [hariIni], navigation);

  const daftar = useMemo(() => {
    const x = cari.trim().toLowerCase();
    return (q.data || []).filter((k) => !x || String(k.name).toLowerCase().includes(x));
  }, [q.data, cari]);
  const bertugas = (q.data || []).filter((k) => k.tugas).length;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <FlatList
        data={q.status === "siap" ? daftar : []}
        keyExtractor={(k) => k.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={[s.cari, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Icon name="users" size={18} color={t.ink3} />
              <TextInput value={cari} onChangeText={setCari} placeholder="Cari nama driver atau helper" placeholderTextColor={t.ink3} style={{ flex: 1, color: t.ink, fontSize: 15, paddingVertical: 10 }} />
            </View>
            {q.status === "siap" && <Text style={[type.caption, { color: t.ink3 }]}>{(q.data || []).length} orang · {bertugas} bertugas hari ini</Text>}
          </View>
        }
        ListEmptyComponent={q.status === "memuat" ? <StateView loading title="Memuat daftar kru…" /> : q.status === "gagal" ? (
          <StateView icon="alert" tone="red" title="Daftar kru belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : <StateView icon="users" title={cari ? "Tidak ada yang cocok" : "Belum ada driver/helper"} />}
        renderItem={({ item: k }) => (
          <Pressable onPress={() => navigation.navigate("KruDetail", { id: k.id, name: k.name })} accessibilityRole="button" accessibilityLabel={k.name}
            style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.9 : 1 }, elevation(t, 1)]}>
            <Avatar name={k.name} size={44} online={k.tugas ? !!k.tugas.online : undefined} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[type.label, { color: t.ink, fontSize: 15 }]} numberOfLines={1}>{k.name}</Text>
              <View style={s.badges}>
                {k.peran.map((p) => <Chip key={p} label={p} tone="accent" size="sm" />)}
                {k.hasSim && <Chip label="SIM" tone="green" size="sm" />}
                {k.isFreelance && <Chip label="Freelance" tone="neutral" size="sm" />}
                {k.isExternalCourier && <Chip label="Kurir eksternal" tone="orange" size="sm" />}
              </View>
              <Text style={{ color: k.tugas ? t.ink2 : t.ink3, fontSize: 12 }} numberOfLines={1}>
                {k.tugas ? `${k.tugas.sebagai} di ${k.tugas.rute.code} · ${routeStatusInfo(k.tugas.rute.status).label}` : "Tidak bertugas hari ini"}
              </Text>
            </View>
            <Icon name="chevronRight" size={18} color={t.ink3} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 18, gap: 10, paddingBottom: 32 },
  cari: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 14 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
