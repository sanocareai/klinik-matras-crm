import React, { useEffect } from "react";
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { JOB_TYPE, tautanPeta, trackingPhaseInfo, umurPosisiMenit } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, ProgressBar, StateView } from "../ui";

// Tracking: GET /armada/tracking (posisi GPS terakhir yang DIKIRIM app driver ke server). Aplikasi Control
// TIDAK membaca lokasi HP sendiri dan TIDAK meminta izin lokasi; peta dibuka di aplikasi peta lewat tautan.
const SEGARKAN_MS = 30_000;

function umurLabel(menit) {
  if (menit == null) return "Belum ada posisi GPS";
  if (menit < 1) return "Posisi baru saja";
  if (menit < 60) return `Posisi ${menit} menit lalu`;
  return `Posisi ${Math.floor(menit / 60)} jam lalu`;
}

export default function TrackingScreen({ navigation }) {
  const t = useTheme();
  const q = useMuat(() => operasionalApi.tracking(), [], navigation);

  // Perbarui otomatis selama layar terbuka & terfokus.
  useEffect(() => {
    let id = null;
    const mulai = () => { if (!id) id = setInterval(() => q.muat({ diam: true }), SEGARKAN_MS); };
    const henti = () => { if (id) { clearInterval(id); id = null; } };
    mulai();
    const a = navigation.addListener("focus", mulai);
    const b = navigation.addListener("blur", henti);
    return () => { henti(); a(); b(); };
  }, [navigation, q.muat]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = Array.isArray(q.data) ? q.data : [];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <FlatList
        data={q.status === "siap" ? items : []}
        keyExtractor={(x) => x.routeId || x.jobId}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={[s.info, { backgroundColor: t.accentBg }]}>
            <Icon name="shield" size={16} color={t.accent} />
            <Text style={{ color: t.accent, fontSize: 12, flex: 1 }}>Posisi dari aplikasi driver, diperbarui tiap 30 detik. Aplikasi ini tidak memakai lokasi HP Anda.</Text>
          </View>
        }
        ListEmptyComponent={q.status === "memuat" ? <StateView loading title="Memuat posisi armada…" /> : q.status === "gagal" ? (
          <StateView icon="alert" tone="red" title="Tracking belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : <StateView icon="mapPin" title="Tidak ada armada berjalan" message="Belum ada rute terbit/berjalan hari ini atau job yang sedang menuju lokasi." />}
        renderItem={({ item: x }) => {
          const rute = x.kind === "route";
          const fase = trackingPhaseInfo(rute ? x.phase : x.status);
          const menit = umurPosisiMenit(x.lastPosition);
          const basi = menit != null && menit > 15;
          const peta = x.lastPosition ? tautanPeta(x.lastPosition.lat, x.lastPosition.lng) : null;
          const stops = x.stops || [];
          const selesai = stops.filter((st) => st.status === "COMPLETED").length;
          const aktif = rute ? stops.find((st) => st.jobId === x.activeJobId) : null;
          return (
            <Pressable disabled={!rute} onPress={() => navigation.navigate("RuteDetail", { id: x.routeId })} accessibilityRole="button"
              style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.92 : 1 }, elevation(t, 1)]}>
              <View style={s.row}>
                <Avatar name={x.driverName} size={42} online={!!x.driverOnline} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: t.ink, fontSize: 15 }]} numberOfLines={1}>{x.driverName || "Tanpa driver"}{x.helperName ? ` + ${x.helperName}` : ""}</Text>
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{rute ? x.routeCode : `Job lepas · ${x.orderNumber || "-"}`}</Text>
                </View>
                <Chip label={fase.label} tone={fase.tone} size="sm" />
              </View>
              {rute && (
                <View style={{ gap: 6 }}>
                  <ProgressBar value={stops.length ? (selesai / stops.length) * 100 : 0} height={6} tone="cyan" />
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{selesai}/{stops.length} stop selesai{aktif ? ` · berikutnya: ${aktif.customerName || aktif.orderNumber || "-"}` : ""}</Text>
                </View>
              )}
              {!rute && <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={2}>{JOB_TYPE[x.type] || x.type} · {x.customerName || "-"} · {x.addressText || ""}</Text>}
              <View style={[s.row, s.foot, { borderColor: t.border }]}>
                <Icon name="mapPin" size={14} color={basi || menit == null ? t.orange : t.green} />
                <Text style={{ color: basi || menit == null ? t.orange : t.ink2, fontSize: 12, flex: 1 }}>{umurLabel(menit)}{basi ? " (sinyal lama)" : ""}</Text>
                {!!peta && (
                  <Pressable onPress={() => Linking.openURL(peta)} accessibilityRole="link" hitSlop={8}>
                    <Text style={{ color: t.accent, fontWeight: "700", fontSize: 12 }}>Buka di peta</Text>
                  </Pressable>
                )}
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
  info: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.md, padding: 10 },
  item: { gap: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
});
