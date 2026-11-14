import React, { useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Latar } from "./Latar";
import { Kilau, Muncul, PEGAS } from "./gerak";
import { useGlassTier } from "./glass";
import { C, F, G, GRAD, R, S, TONE, TOUCH, type ToneKey } from "./tokens";

// KOMPONEN DASAR "Biru Kaca". Semua teks lewat <T> supaya font Plus Jakarta Sans konsisten.

type TProps = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; accessibilityRole?: "header" | "text" };
const mk = (base: TextStyle, nama: string) => {
  const Teks = ({ children, style, numberOfLines, accessibilityRole }: TProps) => (
    <Text style={[base, style]} numberOfLines={numberOfLines} accessibilityRole={accessibilityRole} maxFontSizeMultiplier={1.3}>{children}</Text>
  );
  Teks.displayName = `T.${nama}`;
  return Teks;
};
export const T = {
  LargeTitle: mk({ fontFamily: F.heavy, fontSize: 32, letterSpacing: -0.8, color: C.ink }, "LargeTitle"),
  Title: mk({ fontFamily: F.heavy, fontSize: 20, letterSpacing: -0.3, color: C.ink }, "Title"),
  Headline: mk({ fontFamily: F.bold, fontSize: 16, color: C.ink }, "Headline"),
  Body: mk({ fontFamily: F.regular, fontSize: 15, color: C.ink2 }, "Body"),
  Sub: mk({ fontFamily: F.medium, fontSize: 13.5, color: C.ink2 }, "Sub"),
  Caption: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink3 }, "Caption"),
  Eyebrow: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink3 }, "Eyebrow"),
};

/** Tombol yang sedikit mengecil saat ditekan (rasa iOS). */
export function PressableScale({ style, children, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const [s] = useState(() => new Animated.Value(1));
  // Tekan: menyusut cepat (110 ms). Lepas: kembali dengan pegas — rasa tombol iOS. Native driver: tidak membebani JS.
  const tekan = () => Animated.timing(s, { toValue: 0.96, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  const lepas = () => Animated.spring(s, { toValue: 1, ...PEGAS }).start();
  return (
    <Pressable {...rest} onPressIn={(e) => { tekan(); rest.onPressIn?.(e); }} onPressOut={(e) => { lepas(); rest.onPressOut?.(e); }}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Layar bergulir di atas latar gradasi, tarik-untuk-muat-ulang, dan ruang untuk tab bar. */
export function Screen({ children, refreshing, onRefresh, bottomPad = 130, header }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; bottomPad?: number; header?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Latar />
      {header}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: header ? 8 : insets.top + 16, paddingHorizontal: S.gutter, paddingBottom: bottomPad + insets.bottom, gap: S.gap }}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={TONE.blue.fill} colors={[TONE.blue.fill]} /> : undefined}
      >
        {/* Muncul bertahap: tiap bagian naik & memudar masuk saat pertama tampil (juga saat data baru datang). Kunci posisi stabil → tidak diulang saat refetch. */}
        {React.Children.toArray(children).map((c, i) => (
          <Muncul key={(c as React.ReactElement).key ?? i} urutan={i}>{c}</Muncul>
        ))}
      </ScrollView>
      {/* pelindung status bar: isi yang digulir ke atas tidak menembus jam & ikon sistem */}
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: "rgba(214,231,255,0.92)" }} />
    </View>
  );
}

/** Kartu KACA: putih tembus pandang + tepi putih. "Kurangi gerakan" → putih solid. Tanpa elevation Android (bayangan menembus isian tembus pandang). */
export function Card({ children, style, padded = true, solid = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; solid?: boolean }) {
  const tier = useGlassTier();
  const isi = solid || tier === "MINIMAL" ? C.card : G.fill;
  return (
    <View style={[styles.kaca, { backgroundColor: isi }, padded && { padding: 16 }, style]}>{children}</View>
  );
}

/** Kartu utama bergradasi (biru brand / navy QC) dengan kilau di sudut — teks di dalamnya putih. */
export function HeroCard({ children, style, nada = "brand" }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; nada?: "brand" | "navy" }) {
  return (
    <View style={[{ borderRadius: R.hero, overflow: "hidden", borderWidth: 1, borderColor: G.strokeOnBlue }, style]}>
      <LinearGradient colors={GRAD[nada]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={{ position: "absolute", top: -70, right: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,0.14)" }} />
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 24, right: 24, height: 1, backgroundColor: "rgba(255,255,255,0.55)" }} />
      <View style={{ padding: 18, gap: 14 }}>{children}</View>
    </View>
  );
}

/** Panel kaca kecil DI DALAM kartu biru (angka, progres). */
export function GlassOnBlue({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ borderRadius: 18, padding: 12, backgroundColor: G.fillOnBlue, borderWidth: 1, borderColor: G.strokeOnBlue }, style]}>{children}</View>;
}

/** Bola ikon mengkilap (menu, nomor antrean). */
export function IconOrb({ children, size = 42, nada = "orb" }: { children?: React.ReactNode; size?: number; nada?: "orb" | "orbOranye" }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <LinearGradient colors={GRAD[nada]} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={{ position: "absolute", top: size * 0.08, left: size * 0.18, width: size * 0.42, height: size * 0.26, borderRadius: size, backgroundColor: "rgba(255,255,255,0.35)" }} />
      {children}
    </View>
  );
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginHorizontal: 6, marginBottom: 8 }}>
        <T.Headline style={{ fontFamily: F.heavy, fontSize: 17 }}>{title}</T.Headline>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Chip({ label, tone = "gray", style }: { label: string; tone?: ToneKey; style?: StyleProp<ViewStyle> }) {
  const t = TONE[tone];
  return (
    <View style={[{ alignSelf: "flex-start", height: 26, paddingHorizontal: 10, borderRadius: R.chip, backgroundColor: t.tint, justifyContent: "center" }, style]}>
      <Text style={{ fontFamily: F.bold, fontSize: 12, color: t.text }} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
}

export function Divider({ inset = 16 }: { inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: C.line, marginLeft: inset }} />;
}

type ButtonKind = "primary" | "success" | "destructive" | "tinted" | "danger" | "plain";
export function Button({ label, onPress, kind = "primary", tone = "blue", icon, disabled, busy, style, accessibilityLabel }: {
  label?: string; onPress?: () => void; kind?: ButtonKind; tone?: ToneKey; icon?: React.ReactNode; disabled?: boolean; busy?: boolean;
  style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const t = TONE[kind === "success" ? "green" : kind === "danger" || kind === "destructive" ? "red" : tone];
  const gradien = kind === "primary" && tone === "blue";
  const solid = kind === "primary" || kind === "success" || kind === "destructive";
  const bg = kind === "plain" ? "transparent" : gradien ? "transparent" : solid ? (kind === "success" ? "#15803D" : kind === "destructive" ? t.text : t.text) : G.fillStrong;
  const fg = solid ? C.white : t.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        { minHeight: TOUCH, borderRadius: R.btn, backgroundColor: bg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 20, overflow: "hidden" },
        kind === "tinted" && { borderWidth: 1, borderColor: G.stroke },
        (disabled || busy) && { opacity: 0.45 },
        style,
      ]}
    >
      {gradien ? <LinearGradient colors={GRAD.tombol} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {busy ? <ActivityIndicator color={fg} /> : icon}
      {label ? <Text style={{ fontFamily: F.bold, fontSize: 16.5, color: fg }} maxFontSizeMultiplier={1.3}>{label}</Text> : null}
    </PressableScale>
  );
}

/** Nomor antrean: bola biru mengkilap untuk yang berikutnya, tipis untuk sisanya. */
export function QueueNumber({ n, tone = "indigo", solid = false, size = 44 }: { n: number | string; tone?: ToneKey; solid?: boolean; size?: number }) {
  const t = TONE[tone];
  const teks = <Text style={{ fontFamily: F.heavy, fontSize: size > 50 ? 28 : 18, color: solid ? C.white : t.text }}>{n}</Text>;
  if (solid) return <IconOrb size={size}>{teks}</IconOrb>;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.tint, alignItems: "center", justifyContent: "center" }}>{teks}</View>;
}

export function ProgressBar({ value, tone = "blue", height = 6 }: { value: number; tone?: ToneKey; height?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={{ height, borderRadius: 99, backgroundColor: "rgba(11,27,63,0.08)", overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 99, backgroundColor: TONE[tone].fill }} />
    </View>
  );
}

/** Keadaan kosong / galat / memuat yang konsisten. */
export function StateView({ kind, title, text, onRetry }: { kind: "loading" | "empty" | "error"; title?: string; text?: string; onRetry?: () => void }) {
  return (
    kind === "loading" ? (
      // Kerangka berkilau (shimmer) menggantikan spinner: bentuk isi sudah terlihat sebelum data datang.
      <Card style={{ gap: 12 }} >
        <View accessibilityRole="progressbar" accessibilityLabel={title ?? "Memuat"} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Kilau style={{ width: 44, height: 44, borderRadius: 22 }} />
          <View style={{ flex: 1, gap: 8 }}><Kilau style={{ height: 14, width: "70%" }} /><Kilau style={{ height: 12, width: "45%" }} /></View>
        </View>
        <Kilau style={{ height: 12, width: "90%" }} />
        <Kilau style={{ height: 12, width: "60%" }} />
      </Card>
    ) :
    <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
      {title ? <T.Headline style={{ textAlign: "center" }}>{title}</T.Headline> : null}
      {text ? <T.Sub style={{ textAlign: "center" }}>{text}</T.Sub> : null}
      {onRetry ? <Button label="Coba lagi" kind="tinted" onPress={onRetry} style={{ marginTop: 6, alignSelf: "stretch" }} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  kaca: { borderRadius: R.card, overflow: "hidden", borderWidth: 1, borderColor: G.stroke },
});
