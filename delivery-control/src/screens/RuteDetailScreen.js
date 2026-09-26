import React from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { JOB_TYPE, jobStatusInfo, ringkasRute, routeStatusInfo, tautanPeta } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { tanggalWIB, waktuWIB } from "../format";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, ProgressBar, Row, Section, StateView } from "../ui";

// Detail rute: GET /armada/routes/:id. Baca-saja. Peta dibuka di aplikasi peta HP lewat tautan (tanpa izin lokasi).
export default function RuteDetailScreen({ route, navigation }) {
  const t = useTheme();
  const q = useMuat(() => operasionalApi.detailRute(route.params.id), [route.params.id], navigation);
  const r = q.data;

  if (!r) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
        {q.status === "gagal" ? <StateView icon="alert" tone="red" title="Rute belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} /> : <StateView loading title="Memuat rute…" />}
      </SafeAreaView>
    );
  }
  const info = routeStatusInfo(r.status);
  const rk = ringkasRute(r);
  const jobs = [...(r.jobs || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}>
        <View style={[s.hero, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 1)]}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={[type.overline, { color: t.ink3 }]}>RUTE · {tanggalWIB(r.date)}</Text>
              <Text style={[type.title, { color: t.ink }]}>{r.code}</Text>
            </View>
            <Chip label={info.label} tone={info.tone} />
          </View>
          <ProgressBar value={rk.stop ? (rk.selesai / rk.stop) * 100 : 0} />
          <Text style={{ color: t.ink2, fontSize: 13 }}>{rk.selesai} selesai · {rk.gagal} gagal · {rk.sisa} tersisa dari {rk.stop} stop</Text>
        </View>

        <Section title="Kru & kendaraan" icon="users">
          <View>
            <Row icon="user" label="Driver" value={r.driver?.name || "Belum ada"} />
            <Row icon="users" label="Helper" value={r.helper?.name || "-"} />
            <Row icon="truck" label="Kendaraan" value={r.vehicle?.plateNumber || "-"} />
            <Row icon="clock" label="Terbit" value={r.publishedAt ? waktuWIB(r.publishedAt) : "-"} />
            <Row icon="refresh" label="Sinkron app driver" value={r.driver?.lastAppSyncAt ? waktuWIB(r.driver.lastAppSyncAt) : "-"} last />
          </View>
        </Section>

        <Section title={`Stop (${jobs.length})`} icon="mapPin">
          {jobs.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13 }}>Rute ini belum punya stop.</Text> : jobs.map((j, i) => {
            const js = jobStatusInfo(j.status);
            const peta = tautanPeta(j.lat, j.lng);
            return (
              <View key={j.id} style={[s.stop, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
                <View style={[s.seq, { backgroundColor: t.accentBg }]}><Text style={{ color: t.accent, fontWeight: "800" }}>{i + 1}</Text></View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.row}>
                    <Text style={[type.label, { color: t.ink, flex: 1 }]} numberOfLines={1}>{j.order?.customer?.name || j.order?.orderNumber || "Job"}</Text>
                    <Chip label={js.label} tone={js.tone} size="sm" />
                  </View>
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{JOB_TYPE[j.type] || j.type} · {j.order?.orderNumber || "-"}{j.timeWindow ? ` · ${j.timeWindow}` : ""}</Text>
                  {!!j.addressText && <Text style={{ color: t.ink3, fontSize: 12 }} numberOfLines={2}>{j.addressText}</Text>}
                  {!!j.completedAt && <Text style={{ color: t.green, fontSize: 12 }}>Selesai {waktuWIB(j.completedAt)}</Text>}
                  {j.status === "FAILED" && !!j.failureReason && <Text style={{ color: t.red, fontSize: 12 }}>Gagal: {j.failureReason}</Text>}
                  {!!peta && (
                    <Pressable onPress={() => Linking.openURL(peta)} accessibilityRole="link" hitSlop={6} style={s.row}>
                      <Icon name="mapPin" size={13} color={t.accent} />
                      <Text style={{ color: t.accent, fontSize: 12, fontWeight: "700" }}>Buka di peta</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 18, gap: 14, paddingBottom: 32 },
  hero: { gap: 10, padding: 18, borderRadius: radius.xl, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  stop: { flexDirection: "row", gap: 12, paddingVertical: 12 },
  seq: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
