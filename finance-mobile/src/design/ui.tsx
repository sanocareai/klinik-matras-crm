import React, { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Inbox, TriangleAlert, WifiOff } from "lucide-react-native";
import { useTheme } from "./theme";
import { font, radius, TOUCH, type Tone, toneColors } from "./tokens";
import { haptic } from "./haptics";
import { GlassCard } from "./GlassCard";
import { S } from "@/lib/strings";

// ─── PressableScale: tekan → skala 0.97 (Animated core, driver native) ─────────────────────
type PressProps = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "tab" | "link";
  hitSlop?: number;
};

export function PressableScale({ onPress, onLongPress, disabled, style, children, accessibilityLabel, accessibilityRole = "button", hitSlop }: PressProps) {
  const [skala] = useState(() => new Animated.Value(1));
  const ke = (v: number) => Animated.spring(skala, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onPressIn={() => ke(0.97)}
      onPressOut={() => ke(1)}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View style={[{ transform: [{ scale: skala }], opacity: disabled ? 0.5 : 1 }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

// ─── Button ────────────────────────────────────────────────────────────────────────────────
type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = "primary", icon: Icon, loading, disabled, style }: ButtonProps) {
  const { colors } = useTheme();
  const v = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: "transparent" },
    secondary: { bg: colors.primarySoft, fg: colors.primary, border: "transparent" },
    ghost: { bg: "transparent", fg: colors.primary, border: colors.hairline },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: "transparent" },
  }[variant];
  return (
    <PressableScale
      onPress={() => { haptic.ringan(); onPress?.(); }}
      disabled={disabled || loading}
      accessibilityLabel={label}
      style={{
        minHeight: TOUCH, borderRadius: radius.button, backgroundColor: v.bg, borderWidth: 1, borderColor: v.border,
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18,
      }}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : Icon ? <Icon size={18} color={v.fg} strokeWidth={1.75} /> : null}
      <Text style={{ color: v.fg, fontFamily: font.semibold, fontSize: 15 }}>{label}</Text>
    </PressableScale>
  );
}

// ─── Chip ──────────────────────────────────────────────────────────────────────────────────
export function Chip({ label, aktif, onPress, jumlah }: { label: string; aktif?: boolean; onPress?: () => void; jumlah?: number }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={() => { haptic.tick(); onPress?.(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        minHeight: 36, paddingHorizontal: 14, borderRadius: radius.chip, flexDirection: "row", alignItems: "center", gap: 6,
        backgroundColor: aktif ? colors.primary : colors.glassFill, borderWidth: 1, borderColor: aktif ? colors.primary : colors.glassStroke,
      }}
    >
      <Text style={{ color: aktif ? colors.onPrimary : colors.text, fontFamily: font.medium, fontSize: 13 }}>{label}</Text>
      {jumlah != null && jumlah > 0 ? (
        <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: aktif ? "rgba(255,255,255,0.28)" : colors.primarySoft }}>
          <Text style={{ color: aktif ? colors.onPrimary : colors.primary, fontFamily: font.semibold, fontSize: 11 }}>{jumlah}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

// ─── SectionHeader ─────────────────────────────────────────────────────────────────────────
export function SectionHeader({ judul, aksi, onAksi }: { judul: string; aksi?: string; onAksi?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 10 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16 }}>{judul}</Text>
      {aksi ? (
        <Pressable onPress={onAksi} hitSlop={12} accessibilityRole="link">
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 13 }}>{aksi}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Lingkaran ikon ────────────────────────────────────────────────────────────────────────
export function IconCircle({ icon: Icon, tone = "info", size = 44 }: { icon: LucideIcon; tone?: Tone; size?: number }) {
  const { colors } = useTheme();
  const { fg, bg } = toneColors(colors, tone);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon size={size * 0.46} color={fg} strokeWidth={1.75} />
    </View>
  );
}

// ─── Skeleton (shimmer ringan: opasitas berdenyut) ─────────────────────────────────────────
export function Skeleton({ tinggi = 16, lebar = "100%", style }: { tinggi?: number; lebar?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const [o] = useState(() => new Animated.Value(0.45));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.45, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={[{ height: tinggi, width: lebar, borderRadius: 8, backgroundColor: colors.neutralSoft, opacity: o }, style]} />;
}

// ─── State kosong / galat / offline ───────────────────────────────────────────────────────
function StatePanel({ icon: Icon, tone, judul, isi, aksi, onAksi }: { icon: LucideIcon; tone: Tone; judul: string; isi?: string; aksi?: string; onAksi?: () => void }) {
  const { colors } = useTheme();
  return (
    <GlassCard style={{ marginTop: 16 }}>
      <View style={{ alignItems: "center", paddingVertical: 12, gap: 10 }}>
        <IconCircle icon={Icon} tone={tone} size={52} />
        <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16, textAlign: "center" }}>{judul}</Text>
        {isi ? <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: "center" }}>{isi}</Text> : null}
        {aksi ? <Button label={aksi} variant="secondary" onPress={onAksi} style={{ marginTop: 6 }} /> : null}
      </View>
    </GlassCard>
  );
}

export const EmptyState = ({ judul, isi, aksi, onAksi }: { judul: string; isi?: string; aksi?: string; onAksi?: () => void }) => (
  <StatePanel icon={Inbox} tone="info" judul={judul} isi={isi} aksi={aksi} onAksi={onAksi} />
);

export const ErrorState = ({ judul = "Gagal memuat", isi, onCoba }: { judul?: string; isi?: string; onCoba?: () => void }) => (
  <StatePanel icon={TriangleAlert} tone="danger" judul={judul} isi={isi} aksi={onCoba ? S.umum.coba : undefined} onAksi={onCoba} />
);

export function OfflineBanner() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.small, backgroundColor: colors.warningSoft, marginBottom: 12 }}>
      <WifiOff size={16} color={colors.warning} strokeWidth={1.75} />
      <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 13, flex: 1 }}>{S.offline.banner}</Text>
    </View>
  );
}

/** Banner mode contoh (data mock) — supaya tidak ada yang mengira ini data asli. */
export function MockBanner() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ padding: 8, borderRadius: radius.small, backgroundColor: colors.infoSoft, marginBottom: 12 }}>
      <Text style={{ color: colors.info, fontFamily: font.medium, fontSize: 12, textAlign: "center" }}>{S.umum.modeContoh}</Text>
    </View>
  );
}
