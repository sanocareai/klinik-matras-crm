import React, { useEffect, useMemo, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View } from "react-native";
import { PEGAS, useKurangiGerak } from "@/design/gerak";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, CalendarPlus, LayoutGrid, Package, PackageX, Pause, Play, Target, UserCog, X, type LucideIcon } from "lucide-react-native";
import { useLayout, useWorkerQueue } from "@/api/production";
import { susunAntrean } from "@/features/model";
import { IconOrb, PressableScale, T } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { C, F, G } from "@/design/tokens";

// AKSI CEPAT (tombol + di navbar): lembar bawah berisi jalan pintas sesuai peran. Unit yang SEDANG dikerjakan diambil dari antrean
// Meja/Corner milik akun ini (endpoint yang sama dengan tab Kerja). Tidak ada aksi baru — semuanya membuka layar yang sudah ada.

type Aksi = { key: string; label: string; Icon: LucideIcon; ke: () => void; oranye?: boolean };

export default function AksiCepat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const l = useLayout();
  const meja = useWorkerQueue("table", l.lane);
  const corner = useWorkerQueue("corner", l.lane);
  const aktif = useMemo(() => susunAntrean(meja.data?.items ?? [], []).aktif ?? susunAntrean(corner.data?.items ?? [], []).aktif, [meja.data, corner.data]);

  // Lembar bawah ala iOS: meluncur naik dengan pegas, latar meredup, bisa digeser turun untuk menutup. transform/opacity saja (native driver).
  const kurangi = useKurangiGerak();
  const [y] = useState(() => new Animated.Value(kurangi ? 0 : 600));
  const [redup] = useState(() => new Animated.Value(kurangi ? 1 : 0));
  useEffect(() => {
    if (kurangi) return;
    Animated.parallel([
      Animated.spring(y, { toValue: 0, ...PEGAS }),
      Animated.timing(redup, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [y, redup, kurangi]);
  const tutup = (lalu?: () => void) => {
    const selesai = () => { router.back(); lalu?.(); };
    if (kurangi) { selesai(); return; }
    Animated.parallel([
      Animated.timing(y, { toValue: 600, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(redup, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(selesai);
  };
  const geser = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 110 || g.vy > 0.9) tutup();
      else Animated.spring(y, { toValue: 0, ...PEGAS }).start();
    },
  }), [y]); // eslint-disable-line react-hooks/exhaustive-deps
  const buka = (path: string, params?: Record<string, string>) => () => { haptic.ringan(); tutup(() => router.push((params ? { pathname: path, params } : path) as never)); };

  const unit: Aksi[] = aktif?.runId ? [
    { key: "lanjut", label: "Lanjutkan unit", Icon: Play, ke: buka("/unit/[runId]", { runId: aktif.runId }) },
    { key: "media", label: "Foto & video", Icon: Camera, ke: buka("/media/[runId]", { runId: aktif.runId }) },
    { key: "kurang", label: "Lapor kurang bahan", Icon: PackageX, ke: buka("/kurang-bahan/[runId]", { runId: aktif.runId }), oranye: true },
    { key: "tunda", label: "Tunda unit", Icon: Pause, ke: buka("/tunda/[runId]", { runId: aktif.runId }) },
  ] : [];
  const umum: Aksi[] = [
    ...(l.qc || l.docs ? [{ key: "bahan", label: "Catat bahan", Icon: Package, ke: buka("/(tabs)/bahan") }] : []),
    ...(l.admin ? [
      { key: "jadwal", label: "Jadwalkan unit", Icon: CalendarPlus, ke: buka("/jadwal") },
      { key: "pic", label: "PIC bawaan meja", Icon: UserCog, ke: buka("/pic-meja") },
      { key: "target", label: "Target & urutan", Icon: Target, ke: buka("/(tabs)/target") },
    ] : []),
    { key: "papan", label: "Papan live", Icon: LayoutGrid, ke: buka("/(tabs)/papan") },
  ];

  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,27,63,0.38)", opacity: redup }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tutup aksi cepat" onPress={() => tutup()} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View style={{ backgroundColor: "rgba(247,250,254,0.98)", borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: G.stroke, paddingHorizontal: 18, paddingTop: 10, paddingBottom: insets.bottom + 18, gap: 16, transform: [{ translateY: y }] }}>
        <View {...geser.panHandlers} style={{ alignSelf: "stretch", alignItems: "center", paddingVertical: 4 }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(11,27,63,0.18)" }} />
        </View>
        <View {...geser.panHandlers} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T.Title>Aksi cepat</T.Title>
            <T.Sub numberOfLines={1}>{aktif ? `Unit yang sedang dikerjakan: ${aktif.kodePendek} · ${aktif.customer}` : "Pilih jalan pintas"}</T.Sub>
          </View>
          <PressableScale accessibilityRole="button" accessibilityLabel="Tutup" onPress={() => tutup()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: G.stroke }}>
            <X size={22} color={C.ink} />
          </PressableScale>
        </View>
        {unit.length ? <Grid items={unit} /> : null}
        <Grid items={umum} />
      </Animated.View>
    </View>
  );
}

function Grid({ items }: { items: Aksi[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((a) => (
        <PressableScale key={a.key} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.ke}
          style={{ width: "31%", flexGrow: 1, alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 6, borderRadius: 22, backgroundColor: C.white, borderWidth: 1, borderColor: G.stroke }}>
          <IconOrb size={46} nada={a.oranye ? "orbOranye" : "orb"}><a.Icon size={22} color={C.white} strokeWidth={2.2} /></IconOrb>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 13, color: C.ink, textAlign: "center" }}>{a.label}</Text>
        </PressableScale>
      ))}
    </View>
  );
}
