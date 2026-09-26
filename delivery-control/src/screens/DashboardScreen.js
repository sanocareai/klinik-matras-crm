import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ringkasPapan, ringkasRute, routeStatusInfo, tanggalWIBPlus } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useSession } from "../SessionContext";
import { useMuat } from "../useMuat";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Box, Btn, Card, Chip, DateNav, IconBox, ProgressBar, Section, StateView, StatTile } from "../ui";

// Dashboard operasional: papan job (GET /armada/board, dua tipe), rute tanggal itu (GET /armada/routes?date=),
// dan jumlah masalah terbuka (GET /armada/issues?status=OPEN). Semua baca-saja.
export default function DashboardScreen({ navigation }) {
  const t = useTheme();
  const { modules } = useSession();
  const hariIni = tanggalWIBPlus(0);
  const [tanggal, setTanggal] = useState(hariIni);

  const q = useMuat(async () => {
    const [kirim, ambil, rute, masalah] = await Promise.all([
      operasionalApi.papan(tanggal, "DELIVERY"),
      operasionalApi.papan(tanggal, "PICKUP"),
      operasionalApi.rute({ date: tanggal }),
      modules.issues ? operasionalApi.masalah("OPEN").catch(() => null) : Promise.resolve(null),
    ]);
    // Job tanpa tanggal (UNSCHEDULED) ikut dikembalikan server di tanggal mana pun — dihitung terpisah.
    const semua = [...(kirim.jobs || []), ...(ambil.jobs || [])];
    const terjadwal = semua.filter((j) => j.scheduledDate);
    return {
      papan: ringkasPapan(terjadwal),
      tanpaTanggal: semua.length - terjadwal.length,
      rute: rute.routes || [],
      masalahTerbuka: masalah ? (masalah.jobs || []).length : null,
    };
  }, [tanggal, modules.issues], navigation);

  const d = q.data;
  const p = d?.papan;
  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}>
        <DateNav value={tanggal} onChange={setTanggal} today={hariIni} />

        {q.status === "memuat" && !d ? <StateView loading title="Memuat papan operasional…" /> : q.status === "gagal" && !d ? (
          <StateView icon="alert" tone="red" title="Dashboard belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : d && (
          <>
            {!!q.error && <Box tone="orange" icon="refresh">Gagal memperbarui: {q.error}</Box>}
            <Card style={{ gap: 12 }} level={2}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <IconBox name="truck" tone="accent" size={46} solid />
                <View style={{ flex: 1 }}>
                  <Text style={[type.overline, { color: t.ink3 }]}>JOB TERJADWAL</Text>
                  <Text style={[type.title, { color: t.ink }]}>{p.total} job</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: t.green, fontSize: 24, fontWeight: "800" }}>{p.persenSelesai}%</Text>
                  <Text style={{ color: t.ink3, fontSize: 12 }}>selesai</Text>
                </View>
              </View>
              <ProgressBar value={p.persenSelesai} />
              <Text style={{ color: t.ink2, fontSize: 12 }}>{p.delivery} pengiriman · {p.pickup} pengambilan{d.tanpaTanggal ? ` · ${d.tanpaTanggal} job belum bertanggal` : ""}</Text>
            </Card>

            <View style={s.grid}>
              <StatTile icon="checkCircle" tone="green" value={p.selesai} label="Selesai" />
              <StatTile icon="mapPin" tone="cyan" value={p.berjalan} label="Sedang berjalan" onPress={modules.tracking && tanggal === hariIni ? () => navigation.navigate("Tracking") : undefined} />
              <StatTile icon="clock" tone="accent" value={p.menunggu} label="Menunggu" />
              <StatTile icon="alert" tone="red" value={p.gagal} label="Gagal" onPress={modules.issues ? () => navigation.navigate("Masalah") : undefined} />
            </View>
            {p.belumDriver > 0 && <Box tone="orange" icon="users">{p.belumDriver} job aktif belum punya driver. Penugasan dilakukan di Route Planner web.</Box>}
            {d.masalahTerbuka != null && d.masalahTerbuka > 0 && (
              <Pressable onPress={() => navigation.navigate("Masalah")} accessibilityRole="button">
                <Box tone="red" icon="alert" action={<Icon name="chevronRight" size={18} color={t.red} />}>{d.masalahTerbuka} job gagal menunggu dijadwalkan ulang</Box>
              </Pressable>
            )}

            <Section title={`Rute ${tanggal === hariIni ? "hari ini" : "tanggal ini"}`} icon="route"
              right={modules.routes ? <Pressable onPress={() => navigation.navigate("Rute", { tanggal })} hitSlop={8}><Text style={{ color: t.accent, fontWeight: "700", fontSize: 13 }}>Lihat semua</Text></Pressable> : null}>
              {d.rute.length === 0 ? <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada rute pada tanggal ini.</Text> : d.rute.slice(0, 6).map((r) => {
                const info = routeStatusInfo(r.status);
                const rk = ringkasRute(r);
                return (
                  <Pressable key={r.id} disabled={!modules.routes} onPress={() => navigation.navigate("RuteDetail", { id: r.id })} style={[s.rute, { borderColor: t.border }]} accessibilityRole="button">
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[type.label, { color: t.ink }]}>{r.code}</Text>
                      <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={1}>{r.driver?.name || "Belum ada driver"}{r.helper?.name ? ` + ${r.helper.name}` : ""} · {rk.selesai}/{rk.stop} stop</Text>
                    </View>
                    <Chip label={info.label} tone={info.tone} size="sm" />
                  </Pressable>
                );
              })}
            </Section>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 18, gap: 14, paddingBottom: 32 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  rute: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
