import React, { useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useIsFocused } from "expo-router";
import Svg, { Circle } from "react-native-svg";
import { Search } from "lucide-react-native";
import { Latar, type NadaLatar } from "./Latar";
import { Denyut, Kilau, Muncul, PEGAS } from "./gerak";
import { useGlassTier } from "./glass";
import { C, F, KACA, ORB, R, S, TONE, TOUCH, type ToneKey } from "./tokens";

// KOMPONEN DASAR "Biru Kaca" — ukuran, warna, sudut & bayangan diambil PERSIS dari kanvas mockup "SANSS Produksi v2"
// (artboard 390×844). Semua teks lewat <T> supaya font Plus Jakarta Sans konsisten.

/**
 * Apakah teks sedang berada LANGSUNG di atas latar biru (bukan di dalam panel kaca / baris putih).
 * Screen & kartu utama menyalakannya, Panel/Card mematikannya → kepala layar otomatis putih, isi panel tetap gelap.
 * Gaya `color` eksplisit di pemanggil tetap menang.
 */
export const PadaLatarGelap = React.createContext(false);
export const usePadaLatarGelap = () => React.useContext(PadaLatarGelap);
/** Nada latar layar yang sedang tampil — kartu utama/ubin/bola memakai varian navy di Beranda QC (nilai mockup berbeda). */
const NadaLayar = React.createContext<NadaLatar>("biru");
/** true di dalam panel kaca → <Card> di dalamnya menjadi baris/kotak PUTIH solid (mockup: baris putih di dalam panel kaca). */
const DiPanel = React.createContext(false);

type TProps = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; accessibilityRole?: "header" | "text" };
const mk = (base: TextStyle, terang: string, nama: string) => {
  const diAtasBiru: TextStyle = { color: terang };
  const Teks = ({ children, style, numberOfLines, accessibilityRole }: TProps) => {
    const gelap = React.useContext(PadaLatarGelap);
    return (
      <Text style={[base, gelap && diAtasBiru, style]} numberOfLines={numberOfLines} accessibilityRole={accessibilityRole} maxFontSizeMultiplier={1.3}>{children}</Text>
    );
  };
  Teks.displayName = `T.${nama}`;
  return Teks;
};
// peringatan/galat/hidup: versi terang dari oranye/merah/hijau untuk teks yang berdiri langsung di atas gradasi biru.
export const TEKS_DI_BIRU = { ink: "#FFFFFF", ink2: "#EAF3FF", ink3: "#DCEBFF", peringatan: "#FFD9A8", galat: "#FFD0D4", hidup: "#C9F7D6" } as const;
// Skala huruf mockup: 34/800 judul layar · 21/800 sapaan · 16/800 judul panel · 15/700 label kartu · 14/800 judul baris ·
// 13/600 keterangan · 12/600 sub-baris.
export const T = {
  LargeTitle: mk({ fontFamily: F.heavy, fontSize: 34, letterSpacing: -0.8, color: C.ink }, TEKS_DI_BIRU.ink, "LargeTitle"),
  Title: mk({ fontFamily: F.heavy, fontSize: 21, letterSpacing: -0.4, color: C.ink }, TEKS_DI_BIRU.ink, "Title"),
  Headline: mk({ fontFamily: F.heavy, fontSize: 15, color: C.ink }, TEKS_DI_BIRU.ink, "Headline"),
  Body: mk({ fontFamily: F.regular, fontSize: 15, color: C.ink2 }, TEKS_DI_BIRU.ink2, "Body"),
  Sub: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink2 }, TEKS_DI_BIRU.ink2, "Sub"),
  Caption: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink3 }, TEKS_DI_BIRU.ink3, "Caption"),
  Eyebrow: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink3 }, TEKS_DI_BIRU.ink3, "Eyebrow"),
  /** Judul baris daftar (mockup: 14px/800). */
  Row: mk({ fontFamily: F.heavy, fontSize: 14, color: C.ink }, TEKS_DI_BIRU.ink, "Row"),
  /** Sub-judul baris daftar (mockup: 12px/600 #5A6B85). */
  RowSub: mk({ fontFamily: F.semibold, fontSize: 12, color: C.ink3 }, TEKS_DI_BIRU.ink3, "RowSub"),
};

/** Tombol yang sedikit mengecil saat ditekan (rasa iOS). */
export function PressableScale({ style, children, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const [s] = useState(() => new Animated.Value(1));
  // Tekan: menyusut cepat (110 ms). Lepas: kembali dengan pegas — rasa tombol iOS. Native driver: tidak membebani JS.
  const tekan = () => Animated.timing(s, { toValue: 0.96, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  const lepas = () => Animated.spring(s, { toValue: 1, ...PEGAS }).start();
  // Gaya (lebar, flex, latar) dipasang LANGSUNG di Pressable yang dianimasikan — dulu di View dalam, sehingga tombol di grid/navbar
  // tidak mendapat lebarnya dan menciut (bug "C…", "Ja d…" di Aksi Cepat, 14 Nov 2026).
  return (
    <AnimatedPressable {...rest} onPressIn={(e) => { tekan(); rest.onPressIn?.(e); }} onPressOut={(e) => { lepas(); rest.onPressOut?.(e); }} style={[style, { transform: [{ scale: s }] }]}>
      {children}
    </AnimatedPressable>
  );
}
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Anak layar diratakan menembus <>fragment</> supaya SETIAP bagian menjadi anak langsung ScrollView → jarak antar-bagian (16)
 * berlaku merata. Tanpa ini, isi yang dibungkus fragment (`{data ? <>…</> : null}`) dihitung satu anak dan kartunya menempel.
 */
function ratakan(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((c) =>
    React.isValidElement(c) && c.type === React.Fragment ? ratakan((c.props as { children?: React.ReactNode }).children) : [c]);
}

/** Layar bergulir di atas latar gradasi mockup, tarik-untuk-muat-ulang, dan ruang untuk navbar. */
export function Screen({ children, refreshing, onRefresh, bottomPad = 130, header, latar = "biru", lembar = false }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; bottomPad?: number; header?: React.ReactNode; latar?: NadaLatar;
  /**
   * Layar FORMULIR: seluruh isi ditaruh di satu lembar kaca (seperti lembar isi di mockup Detail Unit). Latar memudar dari biru
   * ke biru es, jadi label & isian tidak boleh berdiri langsung di atas latar — di dalam lembar semuanya memakai teks gelap,
   * kartu di dalamnya menjadi kotak putih, dan tombol utama biru pekat.
   */
  lembar?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // Hanya layar yang sedang tampil yang mengatur status bar (tab lain tetap terpasang di belakang).
  const fokus = useIsFocused();
  const [gulir] = useState(() => new Animated.Value(0)); // posisi gulir (native) → pelindung status bar muncul hanya setelah digulir
  const atas = latar === "navy" ? "#03195B" : "#0B4FE0";
  return (
    <NadaLayar.Provider value={latar}>
      <PadaLatarGelap.Provider value>
        <View style={{ flex: 1, backgroundColor: "#EAF3FF" }}>
          {fokus ? <StatusBar style="light" /> : null}
          <Latar nada={latar} />
          {header}
          <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: gulir } } }], { useNativeDriver: true })}
            // mockup: isi mulai 54px dari atas artboard (≈ status bar + 10), tepi 20, jarak antar-bagian 16
            contentContainerStyle={{ paddingTop: header ? 8 : insets.top + 10, paddingHorizontal: S.gutter, paddingBottom: bottomPad + insets.bottom, gap: S.gap }}
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.white} colors={[TONE.blue.fill]} /> : undefined}
          >
            {/* Muncul bertahap: tiap bagian naik & memudar masuk saat pertama tampil. Kunci posisi stabil → tidak diulang saat refetch. */}
            {lembar ? (
              <Muncul><Card style={{ gap: 14, padding: 16 }}>{ratakan(children)}</Card></Muncul>
            ) : ratakan(children).map((c, i) => (
              <Muncul key={i} urutan={i}>{c}</Muncul>
            ))}
          </Animated.ScrollView>
          {/* Pelindung status bar: memudar (tanpa tepi keras), muncul hanya setelah digulir → jam & ikon sistem tetap terbaca. */}
          {header ? null : (
            <Animated.View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + 18, opacity: gulir.interpolate({ inputRange: [0, 24], outputRange: [0, 1], extrapolate: "clamp" }) }}>
              <LinearGradient colors={[atas, atas, "transparent"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
            </Animated.View>
          )}
        </View>
      </PadaLatarGelap.Provider>
    </NadaLayar.Provider>
  );
}

/**
 * PANEL KACA (mockup: "Butuh perhatian", "Antrean berikutnya"): putih 45% + tepi putih + bayangan lembut, sudut 28, isi 14.
 * Di DALAM panel, <Card> berubah menjadi kotak PUTIH solid sudut 20 (baris daftar mockup). "Kurangi gerakan" → putih solid.
 */
export function Card({ children, style, padded = true, solid = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; solid?: boolean }) {
  const diPanel = React.useContext(DiPanel);
  const tier = useGlassTier();
  if (diPanel) {
    return <View style={[{ borderRadius: R.baris, backgroundColor: C.white, overflow: "hidden" }, padded && { padding: 12 }, style]}>{children}</View>;
  }
  const pekat = solid || tier === "MINIMAL";
  return (
    <View style={[styles.panel, { backgroundColor: pekat ? C.card : KACA.panel.bg }, tier === "MINIMAL" ? null : { boxShadow: KACA.panel.bayang }, padded && { padding: 14 }, style]}>
      <DiPanel.Provider value>
        <PadaLatarGelap.Provider value={false}>{children}</PadaLatarGelap.Provider>
      </DiPanel.Provider>
    </View>
  );
}

/** Panel kaca berjudul (mockup): judul 16/800 + keterangan kanan DI DALAM panel, lalu isi (baris putih) berjarak 8. */
export function Section({ title, right, children, style }: { title: string; right?: React.ReactNode; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Card style={[{ gap: 8 }, style]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4, gap: 8, minHeight: 22 }}>
        <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ flexShrink: 1, fontFamily: F.heavy, fontSize: 16, color: C.ink }}>{title}</Text>
        {right}
      </View>
      {children}
    </Card>
  );
}
/** Keterangan kecil di kanan judul panel (mockup: 12/700 #42526B). */
export function KeteranganPanel({ children }: { children: React.ReactNode }) {
  return <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 12, color: "#42526B" }}>{children}</Text>;
}

/** BARIS PUTIH di dalam panel (mockup: sudut 20, isi 10×12, jarak 10). `onPress` → bisa ditekan. */
export function Baris({ children, onPress, style, accessibilityLabel, disabled }: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; disabled?: boolean }) {
  const gaya: StyleProp<ViewStyle> = [{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: R.baris, backgroundColor: C.white, minHeight: 58 }, style];
  const isi = <PadaLatarGelap.Provider value={false}>{children}</PadaLatarGelap.Provider>;
  if (!onPress) return <View style={gaya}>{isi}</View>;
  return <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={gaya}>{isi}</PressableScale>;
}
/** Judul + sub-judul baris (mockup: 14/800 dan 12/600). */
export function TeksBaris({ judul, sub, baris = 1 }: { judul: string; sub?: string | null; baris?: number }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <T.Row numberOfLines={1}>{judul}</T.Row>
      {sub ? <T.RowSub numberOfLines={baris}>{sub}</T.RowSub> : null}
    </View>
  );
}

/**
 * KARTU UTAMA KACA (mockup "Produksi hari ini" / "Sedang dikerjakan" / "Menunggu Uji Berat Badan"): kaca bening bergradasi 150°
 * di atas latar biru, tepi putih, bayangan biru, kilau blur di sudut — teks di dalamnya putih.
 */
export function HeroCard({ children, style, radius = R.hero }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number; nada?: string }) {
  const navy = React.useContext(NadaLayar) === "navy";
  const tier = useGlassTier();
  const k = navy ? KACA.utamaNavy : KACA.utama;
  return (
    <View style={[{ borderRadius: radius, overflow: "hidden", borderWidth: 1, borderColor: k.tepi, experimental_backgroundImage: k.bg }, tier === "MINIMAL" ? null : { boxShadow: k.bayang }, style]}>
      {navy
        // BerandaQc: pendar biru muda di bawah kartu (left 30, bottom -60, 200×120, blur 30)
        ? <Image source={KILAU_QC} accessible={false} transition={0} style={{ position: "absolute", left: 30 - 90, bottom: -60 - 90, width: 380, height: 300 }} />
        // Main/Kerja: kilau putih di kiri-atas (left -30, top -40, 160×90, blur 18)
        : <Image source={KILAU} accessible={false} transition={0} style={{ position: "absolute", left: -30 - 54, top: -40 - 54, width: 268, height: 198 }} />}
      <View style={{ padding: 18, gap: 14 }}><PadaLatarGelap.Provider value>{children}</PadaLatarGelap.Provider></View>
    </View>
  );
}
const KILAU = require("../../assets/latar/kilau-kartu.png");
const KILAU_QC = require("../../assets/latar/kilau-kartu-qc.png");

/** Panel kaca kecil DI DALAM kartu utama (mockup: putih 16% + tepi 40%, sudut 22, isi 14). */
export function GlassOnBlue({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ borderRadius: 22, padding: 14, backgroundColor: KACA.dalam.bg, borderWidth: 1, borderColor: KACA.dalam.tepi }, style]}>{children}</View>;
}

/** Chip kaca di atas biru (mockup: "Live", jam berjalan, "terlama 35 mnt"). */
export function PilKaca({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: KACA.pil.bg, borderWidth: 1, borderColor: KACA.pil.tepi }, style]}>{children}</View>;
}
/** Pil "Live" (titik hijau berdenyut) — mockup: titik #7CFFB2 berpendar. */
export function PilLive({ putus }: { putus?: boolean }) {
  return (
    <PilKaca>
      {putus ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#FF8A8F" }} /> : <Denyut warna="#7CFFB2" ukuran={7} />}
      <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 12, color: C.white }}>{putus ? "Terputus" : "Live"}</Text>
    </PilKaca>
  );
}

/** Tombol bulat kaca di kepala layar (mockup: 46, putih 20% + tepi 50%). */
export function TombolBulat({ children, onPress, accessibilityLabel, size = 46 }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel: string; size?: number }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: KACA.bulat.bg, borderWidth: 1, borderColor: KACA.bulat.tepi, boxShadow: KACA.bulat.bayang }}>
      {children}
    </PressableScale>
  );
}

/** Kepala layar beranda (mockup): bulatan inisial kaca 46 + keterangan 13/600 + sapaan 21/800 + tombol/pil di kanan. */
export function Kepala({ inisial, keterangan, judul, kanan }: { inisial: string; keterangan: string; judul: string; kanan?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.22)", borderWidth: 1, borderColor: "rgba(255,255,255,0.55)" }}>
        <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: 16, color: C.white }}>{inisial}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 13, color: "#DCEBFF" }}>{keterangan}</Text>
        <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.heavy, fontSize: 21, letterSpacing: -0.4, color: C.white }}>{judul}</Text>
      </View>
      {kanan}
    </View>
  );
}
/** Kepala layar tab biasa: keterangan kecil + judul besar 34/800 (mockup "layar bersama"), putih di atas biru. */
export function KepalaJudul({ keterangan, judul, kanan }: { keterangan?: React.ReactNode; judul: string; kanan?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof keterangan === "string" ? <T.Caption numberOfLines={1}>{keterangan}</T.Caption> : keterangan}
        <T.LargeTitle accessibilityRole="header" numberOfLines={1}>{judul}</T.LargeTitle>
      </View>
      {kanan}
    </View>
  );
}

/** Bola ikon — gradasi RADIAL mulus persis mockup (`circle at 35% 30%`), tanpa kilau oval tempelan. */
export function IconOrb({ children, size = 42, nada = "orb", bayang = false }: { children?: React.ReactNode; size?: number; nada?: "orb" | "orbOranye"; bayang?: boolean }) {
  const navy = React.useContext(NadaLayar) === "navy";
  const o = nada === "orbOranye" ? ORB.oranye : navy ? ORB.navy : ORB.biru;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", experimental_backgroundImage: o.bg }, bayang ? { boxShadow: o.bayang } : null]}>
      {children}
    </View>
  );
}

/** Ubin menu kaca (mockup): kotak kaca 72 sudut 24 + bola ikon 42 + label 12/700 putih. Dipakai di dalam <GridMenu>. */
export function MenuTile({ label, Icon, onPress, badge, oranye, lebar }: {
  label: string; Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; onPress: () => void; badge?: number; oranye?: boolean; lebar?: number;
}) {
  const navy = React.useContext(NadaLayar) === "navy";
  const tier = useGlassTier();
  const k = navy ? KACA.ubinNavy : KACA.ubin;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge}` : label} onPress={onPress} style={{ width: lebar ?? "25%", alignItems: "center", gap: 6 }}>
      <View style={[{ width: 72, height: 72, borderRadius: R.tile, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: k.tepi, experimental_backgroundImage: k.bg }, tier === "MINIMAL" ? null : { boxShadow: k.bayang }]}>
        <IconOrb size={42} nada={oranye ? "orbOranye" : "orb"} bayang={tier !== "MINIMAL"}><Icon size={20} color={C.white} strokeWidth={2.2} /></IconOrb>
        {badge ? (
          <View style={{ position: "absolute", top: -5, right: -5, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: C.white, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: F.heavy, fontSize: 11, color: TONE.orange.text }}>{badge > 99 ? "99+" : badge}</Text>
          </View>
        ) : null}
      </View>
      {/* bayangan teks tipis: baris kedua ubin jatuh di zona gradasi yang mulai terang */}
      <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={{ fontFamily: F.bold, fontSize: 12, color: C.white, textShadowColor: "rgba(3,25,91,0.35)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}>{label}</Text>
    </PressableScale>
  );
}
/** Grid menu 4 kolom (mockup: jarak kolom 10, jarak baris 12) — lebar kolom dihitung dari lebar layar supaya posisinya persis. */
export function GridMenu({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const lebar = Math.floor((width - S.gutter * 2 - 30) / 4);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 12 }}>
      {React.Children.map(children, (c) => (React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<{ lebar?: number }>, { lebar }) : c))}
    </View>
  );
}

/** Kotak angka kaca kecil (mockup Kerja: "Selesai hari ini / Di antrean / Target kamu"): sudut 22, angka 26/800, label 12/700. */
export function StatKaca({ n, label, rapat }: { n: number | string; label: string; rapat?: boolean }) {
  // `rapat` = empat kotak sebaris (Papan): isi & huruf label sedikit dikecilkan supaya "Dikerjakan" tidak terpotong.
  return (
    <View style={{ flex: 1, padding: rapat ? 10 : 12, borderRadius: 22, borderWidth: 1, borderColor: KACA.mini.tepi, experimental_backgroundImage: KACA.mini.bg, boxShadow: KACA.mini.bayang }}>
      <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 26, color: C.white, fontVariant: ["tabular-nums"] }}>{n}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: rapat ? 11 : 12, color: C.white }}>{label}</Text>
    </View>
  );
}

/** Cincin progres (mockup "4/6 selesai"): cincin putih 92 di atas jalur putih 22%, inti biru bergradasi 74. */
export function CincinProgres({ nilai, total, label = "selesai" }: { nilai: number; total: number; label?: string }) {
  const UK = 92, TEBAL = 9, r = (UK - TEBAL) / 2, kel = 2 * Math.PI * r;
  const pct = total > 0 ? Math.max(0, Math.min(1, nilai / total)) : 0;
  const panjang = total > 99 || nilai > 99;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`${nilai} dari ${total} ${label}`} style={{ width: UK, height: UK, alignItems: "center", justifyContent: "center", borderRadius: UK / 2, boxShadow: "0 0 24px rgba(255,255,255,0.35)" }}>
      <Svg width={UK} height={UK} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={UK / 2} cy={UK / 2} r={r} stroke="rgba(255,255,255,0.22)" strokeWidth={TEBAL} fill="none" />
        {pct > 0 ? <Circle cx={UK / 2} cy={UK / 2} r={r} stroke="#FFFFFF" strokeWidth={TEBAL} fill="none" strokeDasharray={`${kel * pct} ${kel}`} /> : null}
      </Svg>
      <View style={{ width: 74, height: 74, borderRadius: 37, alignItems: "center", justifyContent: "center", experimental_backgroundImage: "linear-gradient(150deg, #3E8BFF, #0B4FE0)" }}>
        <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: panjang ? 18 : 24, lineHeight: panjang ? 22 : 26, color: C.white, fontVariant: ["tabular-nums"] }}>{nilai}/{total}</Text>
        <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.bold, fontSize: 10, color: "#DCEBFF" }}>{label}</Text>
      </View>
    </View>
  );
}

/** Tombol putih besar di dalam kartu utama (mockup: tinggi 54–56, teks 16/800 biru, bola panah di kanan). */
export function TombolPutih({ label, onPress, children, tinggi = 54, warna = "#0B4FE0", accessibilityLabel }: { label: string; onPress?: () => void; children?: React.ReactNode; tinggi?: number; warna?: string; accessibilityLabel?: string }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress}
      style={{ flex: 1, height: tinggi, borderRadius: tinggi / 2, backgroundColor: KACA.tombolPutih.bg, boxShadow: KACA.tombolPutih.bayang, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 7 }}>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ flexShrink: 1, fontFamily: F.heavy, fontSize: 16, color: warna }}>{label}</Text>
      {children}
    </PressableScale>
  );
}

/** Kolom cari (mockup "Cari unit": tinggi 52, sudut 26, ikon kaca pembesar) — putih pekat supaya ketikan selalu terbaca. */
export function KolomCari({ value, onChangeText, placeholder, accessibilityLabel, autoCapitalize }: {
  value: string; onChangeText: (v: string) => void; placeholder: string; accessibilityLabel: string; autoCapitalize?: "none" | "characters";
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 52, paddingHorizontal: 16, borderRadius: 26, backgroundColor: KACA.tombolPutih.bg, boxShadow: "0 10px 28px rgba(20,60,140,0.10), inset 0 1px 0 #FFFFFF" }}>
      <Search color={C.ink3} size={20} strokeWidth={2} />
      <TextInput accessibilityLabel={accessibilityLabel} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.ink3}
        autoCapitalize={autoCapitalize} style={{ flex: 1, fontFamily: F.medium, fontSize: 15, color: C.ink, paddingVertical: 0 }} />
    </View>
  );
}

/** Chip status (mockup: isi 4×9, sudut 11, 12/800). */
export function Chip({ label, tone = "gray", style }: { label: string; tone?: ToneKey; style?: StyleProp<ViewStyle> }) {
  const t = TONE[tone];
  return (
    <View style={[{ alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 9, borderRadius: R.chip, backgroundColor: t.tint, justifyContent: "center" }, style]}>
      <Text style={{ fontFamily: F.heavy, fontSize: 12, color: t.text }} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
}

export function Divider({ inset = 16 }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: "#E6EEF8", marginLeft: inset }} />;
}

type ButtonKind = "primary" | "success" | "destructive" | "tinted" | "danger" | "plain";
/**
 * Tombol (mockup): tinggi 54, sudut 27, 16px. Di permukaan terang → biru pekat #007BFF (mockup Detail Unit);
 * LANGSUNG di atas latar biru → pil putih 95% dengan teks biru (mockup tombol kartu utama) supaya tidak tenggelam.
 */
export function Button({ label, onPress, kind = "primary", tone = "blue", icon, disabled, busy, style, accessibilityLabel }: {
  label?: string; onPress?: () => void; kind?: ButtonKind; tone?: ToneKey; icon?: React.ReactNode; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const diAtasBiru = React.useContext(PadaLatarGelap);
  const t = TONE[kind === "success" ? "green" : kind === "danger" || kind === "destructive" ? "red" : tone];
  const solid = kind === "primary" || kind === "success" || kind === "destructive";
  const utamaBiru = kind === "primary" && tone === "blue";
  const putih = solid && diAtasBiru && utamaBiru;
  const redup = !!disabled || !!busy;
  let bg: string, fg: string, tepi: string | undefined, bayang: string | undefined;
  // Latar memudar dari biru (atas) ke biru es (bawah), jadi tombol yang berdiri LANGSUNG di atas latar harus terbaca di keduanya:
  // pil putih + teks berwarna. Di dalam panel/kartu terang: isian tipis sewarna (mockup: #D8E9FF + #0056B3).
  if (putih) { bg = KACA.tombolPutih.bg; fg = "#0B4FE0"; bayang = redup ? undefined : KACA.tombolPutih.bayang; }
  else if (solid) { bg = kind === "success" ? "#15803D" : utamaBiru ? TONE.blue.fill : t.text; fg = C.white; }
  else if (diAtasBiru) { bg = "rgba(255,255,255,0.92)"; fg = t.text; tepi = "rgba(255,255,255,0.95)"; }
  else if (kind === "plain") { bg = "transparent"; fg = t.text; }
  else { bg = tone === "blue" && kind !== "danger" ? "#D8E9FF" : t.tint; fg = tone === "blue" && kind !== "danger" ? "#0056B3" : t.text; }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: redup, busy: !!busy }}
      disabled={redup}
      onPress={onPress}
      style={[
        { minHeight: TOUCH, borderRadius: R.btn, backgroundColor: bg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 20 },
        tepi ? { borderWidth: 1, borderColor: tepi } : null,
        bayang ? { boxShadow: bayang } : null,
        redup && { opacity: 0.5 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon}
      {label ? <Text style={{ flexShrink: 1, textAlign: "center", fontFamily: putih ? F.heavy : F.bold, fontSize: 16, color: fg }} maxFontSizeMultiplier={1.3}>{label}</Text> : null}
    </PressableScale>
  );
}

/** Nomor antrean (mockup: 38; nomor 1 = bola biru radial, sisanya biru es #E3F0FF dengan angka #0062CC, 15/800). */
export function QueueNumber({ n, tone = "blue", solid = false, size = 38 }: { n: number | string; tone?: ToneKey; solid?: boolean; size?: number }) {
  const t = TONE[tone];
  const teks = <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: size > 50 ? 26 : 15, color: solid ? C.white : t.text }}>{n}</Text>;
  if (solid) return <IconOrb size={size} nada={tone === "red" || tone === "orange" ? "orbOranye" : "orb"}>{teks}</IconOrb>;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.tint, alignItems: "center", justifyContent: "center" }}>{teks}</View>;
}

export function ProgressBar({ value, tone = "blue", height = 6 }: { value: number; tone?: ToneKey; height?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={{ height, borderRadius: 99, backgroundColor: "#EEF4FB", overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 99, backgroundColor: TONE[tone].fill }} />
    </View>
  );
}

/** Keadaan kosong / galat / memuat yang konsisten (panel kaca; di dalam panel → kotak putih). */
export function StateView({ kind, title, text, onRetry }: { kind: "loading" | "empty" | "error"; title?: string; text?: string; onRetry?: () => void }) {
  const diPanel = React.useContext(DiPanel);
  return (
    kind === "loading" ? (
      // Kerangka berkilau (shimmer) menggantikan spinner: bentuk isi sudah terlihat sebelum data datang.
      <Card style={{ gap: 12 }} >
        <View accessibilityRole="progressbar" accessibilityLabel={title ?? "Memuat"} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Kilau style={{ width: 38, height: 38, borderRadius: 19 }} />
          <View style={{ flex: 1, gap: 8 }}><Kilau style={{ height: 14, width: "70%" }} /><Kilau style={{ height: 12, width: "45%" }} /></View>
        </View>
        <Kilau style={{ height: 12, width: "90%" }} />
        <Kilau style={{ height: 12, width: "60%" }} />
      </Card>
    ) :
    <Card style={{ alignItems: "center", gap: 6, paddingVertical: diPanel ? 18 : 24 }}>
      {title ? <T.Row style={{ textAlign: "center", fontSize: 15 }}>{title}</T.Row> : null}
      {text ? <T.RowSub style={[{ textAlign: "center", fontSize: 13, lineHeight: 18 }, diPanel ? null : { color: C.ink2 }]}>{text}</T.RowSub> : null}
      {onRetry ? <Button label="Coba lagi" kind="tinted" onPress={onRetry} style={{ marginTop: 8, alignSelf: "stretch" }} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: R.card, borderWidth: 1, borderColor: KACA.panel.tepi },
});
