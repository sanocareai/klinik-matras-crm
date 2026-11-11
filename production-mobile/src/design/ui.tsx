import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, R, S, TONE, TOUCH, type ToneKey } from "./tokens";

// KOMPONEN DASAR gaya iOS. Semua teks lewat <T> supaya font Inter konsisten.

type TProps = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; accessibilityRole?: "header" | "text" };
const mk = (base: TextStyle, nama: string) => {
  const Teks = ({ children, style, numberOfLines, accessibilityRole }: TProps) => (
    <Text style={[base, style]} numberOfLines={numberOfLines} accessibilityRole={accessibilityRole}>{children}</Text>
  );
  Teks.displayName = `T.${nama}`;
  return Teks;
};
export const T = {
  LargeTitle: mk({ fontFamily: F.heavy, fontSize: 34, letterSpacing: -0.7, color: C.ink }, "LargeTitle"),
  Title: mk({ fontFamily: F.heavy, fontSize: 20, letterSpacing: -0.2, color: C.ink }, "Title"),
  Headline: mk({ fontFamily: F.bold, fontSize: 16, color: C.ink }, "Headline"),
  Body: mk({ fontFamily: F.regular, fontSize: 15, color: C.ink2 }, "Body"),
  Sub: mk({ fontFamily: F.regular, fontSize: 13.5, color: C.ink2 }, "Sub"),
  Caption: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink3 }, "Caption"),
  Eyebrow: mk({ fontFamily: F.semibold, fontSize: 13, color: C.ink3, textTransform: "uppercase", letterSpacing: 0.4 }, "Eyebrow"),
};

/** Layar bergulir dengan latar grouped, tarik-untuk-muat-ulang, dan ruang untuk tab bar. */
export function Screen({ children, refreshing, onRefresh, bottomPad = 110, header }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; bottomPad?: number; header?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {header}
      <ScrollView
        contentContainerStyle={{ paddingTop: header ? 8 : insets.top + 16, paddingHorizontal: S.gutter, paddingBottom: bottomPad + insets.bottom, gap: S.gap }}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({ children, style, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[{ backgroundColor: C.card, borderRadius: R.card, overflow: "hidden" }, padded && { padding: 16 }, style]}>{children}</View>;
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginHorizontal: 6, marginBottom: 8 }}>
        <T.Eyebrow>{title}</T.Eyebrow>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Chip({ label, tone = "gray", style }: { label: string; tone?: ToneKey; style?: StyleProp<ViewStyle> }) {
  const t = TONE[tone];
  return (
    <View style={[{ alignSelf: "flex-start", height: 24, paddingHorizontal: 10, borderRadius: R.chip, backgroundColor: t.tint, justifyContent: "center" }, style]}>
      <Text style={{ fontFamily: F.semibold, fontSize: 12, color: t.text }} numberOfLines={1}>{label}</Text>
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
  const solid = kind === "primary" || kind === "success" || kind === "destructive";
  const bg = kind === "plain" ? "transparent" : solid ? t.fill : t.tint;
  const fg = solid ? C.white : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        { minHeight: TOUCH, borderRadius: R.btn, backgroundColor: bg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18 },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon}
      {label ? <Text style={{ fontFamily: F.semibold, fontSize: 17, color: fg }}>{label}</Text> : null}
    </Pressable>
  );
}

/** Kotak nomor antrean (gaya kanvas: indigo pekat untuk yang sedang dikerjakan, tipis untuk berikutnya). */
export function QueueNumber({ n, tone = "indigo", solid = false, size = 44 }: { n: number | string; tone?: ToneKey; solid?: boolean; size?: number }) {
  const t = TONE[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size > 50 ? 18 : R.num, backgroundColor: solid ? t.fill : t.tint, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: F.heavy, fontSize: size > 50 ? 30 : 20, color: solid ? C.white : t.text }}>{n}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = "blue", height = 6 }: { value: number; tone?: ToneKey; height?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={{ height, borderRadius: 99, backgroundColor: "#EBEBF0", overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 99, backgroundColor: TONE[tone].fill }} />
    </View>
  );
}

/** Keadaan kosong / galat / memuat yang konsisten. */
export function StateView({ kind, title, text, onRetry }: { kind: "loading" | "empty" | "error"; title?: string; text?: string; onRetry?: () => void }) {
  return (
    <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
      {kind === "loading" ? <ActivityIndicator /> : null}
      {title ? <T.Headline style={{ textAlign: "center" }}>{title}</T.Headline> : null}
      {text ? <T.Sub style={{ textAlign: "center" }}>{text}</T.Sub> : null}
      {onRetry ? <Button label="Coba lagi" kind="tinted" onPress={onRetry} style={{ marginTop: 6, alignSelf: "stretch" }} /> : null}
    </Card>
  );
}
