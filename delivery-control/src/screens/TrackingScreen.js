import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { JOB_TYPE, tautanPeta, trackingPhaseInfo } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { jamWIB } from "../format";
import { WARNA_MARKER, batasPeta, bentukArmada, umurLabel } from "../lib/liveTracking";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Avatar, Btn, Chip, ProgressBar, StateView } from "../ui";

// LIVE TRACKING: posisi GPS terakhir yang DIKIRIM app Driver ke server (GET /armada/tracking), digabung dengan kendaraan dari
// GET /armada/routes?date=hari-ini. Control TIDAK membaca lokasi HP, TIDAK meminta izin lokasi, dan TIDAK memakai showsUserLocation.
// Diperbarui otomatis tiap 30 detik selama layar terbuka & terfokus. Daftar adalah fallback bila peta tidak tersedia.
const SEGARKAN_MS = 30_000;
const JAKARTA = { latitude: -6.2, longitude: 106.8, latitudeDelta: 0.35, longitudeDelta: 0.35 };
const GAYA_GELAP = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
];

function inisial(nama) {
  return String(nama || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";
}

function Penanda({ a, terpilih }) {
  const warna = WARNA_MARKER[a.segar.kode];
  return (
    <View style={[s.pin, { borderColor: warna, transform: [{ scale: terpilih ? 1.15 : 1 }] }]}>
      <Text style={{ color: "#0B1B36", fontWeight: "800", fontSize: 12 }}>{inisial(a.driver)}</Text>
      <View style={[s.pinDot, { backgroundColor: warna }]} />
    </View>
  );
}

export default function TrackingScreen({ navigation }) {
  const t = useTheme();
  const [mode, setMode] = useState("peta"); // peta | daftar
  const [pilih, setPilih] = useState(null);
  const [tracks, setTracks] = useState(true);
  const petaRef = useRef(null);
  const terakhirOk = useRef(null);
  const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  const q = useMuat(async () => {
    const [tracking, rute] = await Promise.all([operasionalApi.tracking(), operasionalApi.rute({ date: hariIni }).catch(() => ({ routes: [] }))]);
    terakhirOk.current = Date.now();
    return bentukArmada(tracking, rute.routes || [], Date.now());
  }, [hariIni], navigation);

  useEffect(() => {
    let id = null;
    const mulai = () => { if (!id) id = setInterval(() => q.muat({ diam: true }), SEGARKAN_MS); };
    const henti = () => { if (id) { clearInterval(id); id = null; } };
    mulai();
    const a = navigation.addListener("focus", mulai);
    const b = navigation.addListener("blur", henti);
    return () => { henti(); a(); b(); };
  }, [navigation, q.muat]); // eslint-disable-line react-hooks/exhaustive-deps

  const armada = q.data || [];
  const bermarker = useMemo(() => armada.filter((a) => a.marker), [armada]);
  const wilayah = useMemo(() => batasPeta(armada), [armada]);
  const terpilih = armada.find((a) => a.key === pilih) || null;
  const offline = q.status === "siap" && !!q.error; // pemuatan ulang gagal, data lama tetap ditampilkan

  // Marker kustom perlu dirender ulang saat data berubah; matikan setelahnya agar hemat baterai.
  useEffect(() => { setTracks(true); const id = setTimeout(() => setTracks(false), 800); return () => clearTimeout(id); }, [armada, pilih]);
  useEffect(() => { if (pilih && !armada.some((a) => a.key === pilih)) setPilih(null); }, [armada, pilih]);

  const pusatkan = () => {
    const m = bermarker.map((a) => ({ latitude: a.marker.lat, longitude: a.marker.lng }));
    if (m.length && petaRef.current) petaRef.current.fitToCoordinates(m, { edgePadding: { top: 90, right: 60, bottom: 260, left: 60 }, animated: true });
  };

  const info = (
    <View style={[s.info, { backgroundColor: offline ? t.orangeBg : t.accentBg }]}>
      <Icon name={offline ? "cloudOff" : "shield"} size={16} color={offline ? t.orange : t.accent} />
      <Text style={{ color: offline ? t.orange : t.accent, fontSize: 12, flex: 1 }}>
        {offline
          ? `Offline — menampilkan data terakhir${terakhirOk.current ? ` (${jamWIB(terakhirOk.current)} WIB)` : ""}. Mencoba lagi otomatis.`
          : `Posisi dari aplikasi driver, diperbarui tiap 30 detik${terakhirOk.current ? ` · terakhir ${jamWIB(terakhirOk.current)} WIB` : ""}. Aplikasi ini tidak memakai lokasi HP Anda.`}
      </Text>
    </View>
  );

  const kartu = (a, ringkas) => {
    const fase = trackingPhaseInfo(a.fase);
    const peta = a.marker ? tautanPeta(a.marker.lat, a.marker.lng) : null;
    return (
      <Pressable
        onPress={() => (ringkas ? (a.routeId ? navigation.navigate("RuteDetail", { id: a.routeId }) : null) : (a.marker && mode === "daftar" ? (setPilih(a.key), setMode("peta")) : a.routeId && navigation.navigate("RuteDetail", { id: a.routeId })))}
        accessibilityRole="button" accessibilityLabel={`${a.driver || "Tanpa driver"}, ${a.segar.label}`}
        style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.92 : 1 }, elevation(t, ringkas ? 2 : 1)]}
      >
        <View style={s.row}>
          <Avatar name={a.driver} size={42} online={a.online} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: t.ink, fontSize: 15 }]} numberOfLines={1}>{a.driver || "Tanpa driver"}{a.helper ? ` + ${a.helper}` : ""}</Text>
            <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={1}>{a.kodeRute || `Job lepas · ${a.order || "-"}`}{a.kendaraan ? ` · ${a.kendaraan}` : ""}</Text>
          </View>
          <Chip label={fase.label} tone={fase.tone} size="sm" />
        </View>
        {a.kind === "route" ? (
          <View style={{ gap: 6 }}>
            <ProgressBar value={a.stopTotal ? (a.stopSelesai / a.stopTotal) * 100 : 0} height={6} tone="cyan" />
            <Text style={{ color: t.ink2, fontSize: 12 }}>{a.stopSelesai}/{a.stopTotal} stop selesai{a.berikutnya ? ` · berikutnya: ${a.berikutnya}` : ""}</Text>
          </View>
        ) : (
          <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={2}>{JOB_TYPE[a.tipe] || "Job"} · {a.berikutnya || "-"}{a.order ? ` · ${a.order}` : ""}</Text>
        )}
        <View style={[s.row, s.foot, { borderColor: t.border }]}>
          <View style={[s.dot, { backgroundColor: WARNA_MARKER[a.segar.kode] }]} />
          <Text style={{ color: t.ink2, fontSize: 12, flex: 1 }}>
            {a.segar.label}{a.menit != null ? ` · ${umurLabel(a.menit)} (${jamWIB(a.dataTerakhir)} WIB)` : ""}
          </Text>
          {!!peta && (
            <Pressable onPress={() => Linking.openURL(peta)} accessibilityRole="link" hitSlop={8}>
              <Text style={{ color: t.accent, fontWeight: "700", fontSize: 12 }}>Buka di peta</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  };

  const kosong = q.status === "siap" && armada.length === 0;
  const belumAda = q.status === "memuat" && !q.data;
  const gagal = q.status === "gagal" && !q.data;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <View style={s.top}>
        <View style={[s.seg, { backgroundColor: t.neutralBg }]}>
          {[["peta", "Peta", "mapPin"], ["daftar", "Daftar", "note"]].map(([k, label, ic]) => {
            const aktif = mode === k;
            return (
              <Pressable key={k} onPress={() => setMode(k)} accessibilityRole="tab" accessibilityState={{ selected: aktif }} style={[s.segItem, aktif && { backgroundColor: t.surface }, aktif && elevation(t, 1)]}>
                <Icon name={ic} size={15} color={aktif ? t.accent : t.ink3} />
                <Text style={{ color: aktif ? t.ink : t.ink3, fontWeight: "700", fontSize: 13 }}>{label}{k === "peta" ? ` (${bermarker.length})` : ` (${armada.length})`}</Text>
              </Pressable>
            );
          })}
        </View>
        {info}
      </View>

      {belumAda ? <StateView loading title="Memuat posisi armada…" /> : gagal ? (
        <StateView icon="cloudOff" tone="red" title="Tracking belum dapat dimuat" message={`${q.error}. Periksa koneksi, lalu coba lagi.`} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
      ) : kosong ? (
        <StateView icon="mapPin" title="Tidak ada armada berjalan" message="Belum ada rute terbit/berjalan hari ini atau job yang sedang menuju lokasi." action={<Btn title="Muat ulang" icon="refresh" kind="ghost" onPress={() => q.muat()} />} />
      ) : mode === "peta" ? (
        <View style={{ flex: 1 }}>
          <MapView
            ref={petaRef} style={StyleSheet.absoluteFill} provider={PROVIDER_GOOGLE}
            initialRegion={wilayah || JAKARTA} customMapStyle={t.scheme === "dark" ? GAYA_GELAP : undefined}
            showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} rotateEnabled={false}
            onMapReady={pusatkan} onPress={() => setPilih(null)}
          >
            {bermarker.map((a) => (
              <Marker key={a.key} coordinate={{ latitude: a.marker.lat, longitude: a.marker.lng }} onPress={() => setPilih(a.key)} tracksViewChanges={tracks} anchor={{ x: 0.5, y: 0.5 }}>
                <Penanda a={a} terpilih={pilih === a.key} />
              </Marker>
            ))}
          </MapView>
          {bermarker.length === 0 && (
            <View style={[s.kosongPeta, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 2)]}>
              <Icon name="alert" size={16} color={t.orange} />
              <Text style={{ color: t.ink2, fontSize: 13, flex: 1 }}>Belum ada driver yang mengirim posisi GPS. Lihat tab Daftar untuk status armada.</Text>
            </View>
          )}
          <View style={s.fabWrap} pointerEvents="box-none">
            <Pressable onPress={pusatkan} accessibilityRole="button" accessibilityLabel="Pusatkan semua armada" style={[s.fab, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 2)]}>
              <Icon name="mapPin" size={20} color={t.accent} />
            </Pressable>
            <Pressable onPress={() => q.muat({ diam: true })} accessibilityRole="button" accessibilityLabel="Muat ulang" style={[s.fab, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 2)]}>
              <Icon name="refresh" size={20} color={t.accent} />
            </Pressable>
          </View>
          {terpilih ? <View style={s.sheet}>{kartu(terpilih, true)}</View> : (
            <View style={[s.legend, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 1)]}>
              {[["SEGAR", "≤5 mnt"], ["LAMBAT", "≤15 mnt"], ["LAMA", ">15 mnt"]].map(([k, l]) => (
                <View key={k} style={s.row}><View style={[s.dot, { backgroundColor: WARNA_MARKER[k] }]} /><Text style={{ color: t.ink2, fontSize: 11 }}>{l}</Text></View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <FlatList
          data={armada} keyExtractor={(x) => x.key} contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
          renderItem={({ item }) => kartu(item, false)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { paddingHorizontal: 18, paddingTop: 8, gap: 10, paddingBottom: 8 },
  seg: { flexDirection: "row", borderRadius: radius.pill, padding: 4 },
  segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: radius.pill },
  info: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.md, padding: 10 },
  list: { padding: 18, gap: 10, paddingBottom: 32 },
  item: { gap: 10, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pin: { minWidth: 38, height: 38, borderRadius: 19, borderWidth: 3, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  pinDot: { position: "absolute", right: -2, bottom: -2, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: "#FFFFFF" },
  fabWrap: { position: "absolute", right: 14, top: 12, gap: 10 },
  fab: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  sheet: { position: "absolute", left: 14, right: 14, bottom: 14 },
  legend: { position: "absolute", left: 14, bottom: 14, flexDirection: "row", gap: 12, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  kosongPeta: { position: "absolute", left: 14, right: 74, top: 12, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.md, borderWidth: 1, padding: 10 },
});
