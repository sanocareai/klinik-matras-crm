import React, { useEffect, useMemo, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View, useWindowDimensions } from "react-native";
import { PEGAS, useKurangiGerak } from "@/design/gerak";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, CalendarPlus, LayoutGrid, Package, PackageX, Pause, Play, Target, UserCog, X, type LucideIcon } from "lucide-react-native";
import { useLayout, useWorkerQueue } from "@/api/production";
import { susunAntrean } from "@/features/model";
import { PressableScale } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { C, F } from "@/design/tokens";

// AKSI CEPAT (tombol + di navbar): lembar bawah berisi jalan pintas sesuai peran. Unit yang SEDANG dikerjakan diambil dari antrean
// Meja/Corner milik akun ini (endpoint yang sama dengan tab Kerja). Tidak ada aksi baru — semuanya membuka layar yang sudah ada.

type Aksi = { key: string; label: string; Icon: LucideIcon; ke: () => void; warna: "biru" | "hijau" | "oranye" | "abu" };

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
    { key: "lanjut", label: "Lanjutkan unit", Icon: Play, ke: buka("/unit/[runId]", { runId: aktif.runId }), warna: "biru" },
    { key: "media", label: "Foto / video", Icon: Camera, ke: buka("/media/[runId]", { runId: aktif.runId }), warna: "biru" },
    { key: "kurang", label: "Lapor kurang bahan", Icon: PackageX, ke: buka("/kurang-bahan/[runId]", { runId: aktif.runId }), warna: "oranye" },
    { key: "tunda", label: "Tunda unit", Icon: Pause, ke: buka("/tunda/[runId]", { runId: aktif.runId }), warna: "abu" },
  ] : [];
  const umum: Aksi[] = [
    ...(l.qc || l.docs ? [{ key: "bahan", label: "Catat bahan", Icon: Package, ke: buka("/(tabs)/bahan"), warna: "hijau" as const }] : []),
    ...(l.admin ? [
      { key: "jadwal", label: "Jadwalkan unit", Icon: CalendarPlus, ke: buka("/jadwal"), warna: "biru" as const },
      { key: "pic", label: "PIC bawaan meja", Icon: UserCog, ke: buka("/pic-meja"), warna: "biru" as const },
      { key: "target", label: "Target & urutan", Icon: Target, ke: buka("/(tabs)/target"), warna: "biru" as const },
    ] : []),
    { key: "papan", label: "Papan live", Icon: LayoutGrid, ke: buka("/(tabs)/papan"), warna: "biru" },
  ];

  // Susunan PERSIS mockup "Aksi Cepat (+)": lembar #F7FAFE sudut 36, pegangan, judul 22/800 + keterangan 14,
  // grid 3 kolom ubin kaca (lingkaran ikon 48 berwarna tipis + label 13/600), lalu tombol "Tutup" gelap setinggi 54.
  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <StatusBar style="light" />
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,27,63,0.38)", opacity: redup }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Tutup aksi cepat" onPress={() => tutup()} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View style={{ backgroundColor: "#F7FAFE", borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom + 12, 30), gap: 16, boxShadow: "0 -10px 40px rgba(15,30,58,0.25)", transform: [{ translateY: y }] }}>
        <View {...geser.panHandlers} style={{ alignSelf: "stretch", alignItems: "center", paddingVertical: 4 }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: "#C5D3E6" }} />
        </View>
        <View {...geser.panHandlers} style={{ gap: 2, paddingHorizontal: 4 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ fontFamily: F.heavy, fontSize: 22, color: C.ink }}>Aksi cepat</Text>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.medium, fontSize: 14, color: C.ink3 }}>{aktif ? `Untuk unit yang sedang kamu kerjakan: ${aktif.kodePendek} · ${aktif.customer}` : "Pilih jalan pintas"}</Text>
        </View>
        <Grid items={[...unit, ...umum]} />
        <PressableScale accessibilityRole="button" accessibilityLabel="Tutup" onPress={() => tutup()}
          style={{ height: 54, borderRadius: 27, backgroundColor: C.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <X size={20} color={C.white} strokeWidth={2.2} />
          <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 16, color: C.white }}>Tutup</Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

// Warna lingkaran ikon — pasangan latar tipis + garis ikon dari mockup.
const WARNA = {
  biru: { bg: "#D8E9FF", fg: "#0056B3" },
  hijau: { bg: "#E3F7E8", fg: "#1F7A35" },
  oranye: { bg: "#FFE8DC", fg: "#C43D00" },
  abu: { bg: "#EBEBF0", fg: "#3A3A3C" },
} as const;

function Grid({ items }: { items: Aksi[] }) {
  // mockup: grid 3 kolom tetap (jarak 10) — ubin baris terakhir TIDAK melebar.
  const { width } = useWindowDimensions();
  const lebar = Math.floor((width - 40 - 20) / 3);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((a) => {
        const w = WARNA[a.warna];
        return (
          <PressableScale key={a.key} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.ke}
            style={{ width: lebar, alignItems: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 6, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.85)", boxShadow: "0 10px 28px rgba(20,60,140,0.10), inset 0 1px 0 #FFFFFF" }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: w.bg, alignItems: "center", justifyContent: "center" }}>
              <a.Icon size={24} color={w.fg} strokeWidth={1.9} />
            </View>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.semibold, fontSize: 13, color: C.ink, textAlign: "center" }}>{a.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
