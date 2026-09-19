import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useTheme } from "./theme";
import { useBlurTarget } from "./Screen";
import { radius } from "./tokens";

export type GlassVariant = "default" | "strong" | "hero" | "flat";

type Props = {
  variant?: GlassVariant;
  /**
   * Blur nyata (tier FULL saja, Android 12+). Aturan §10.3: paling banyak 2 per layar
   * dan TIDAK PERNAH di dalam item daftar yang digulir. Default mati.
   */
  blur?: boolean;
  padding?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export function GlassCard({ variant = "default", blur = false, padding = 16, style, children }: Props) {
  const { colors, glassTier, isDark } = useTheme();
  const blurTarget = useBlurTarget();

  const bentuk: ViewStyle = { borderRadius: radius.card, overflow: "hidden" };
  const bayangan: ViewStyle = glassTier === "MINIMAL" ? {} : { elevation: variant === "hero" ? 6 : 3, shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } };

  if (variant === "hero") {
    return (
      <View style={[bentuk, bayangan, { borderWidth: 1, borderColor: colors.glassStroke }, style]}>
        <LinearGradient colors={[colors.heroFrom, colors.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[styles.kilau, { backgroundColor: "rgba(255,255,255,0.10)" }]} />
        <View style={{ padding }}>{children}</View>
      </View>
    );
  }

  const isi =
    variant === "flat" ? colors.solidAlt
    : glassTier === "MINIMAL" ? colors.solid
    : variant === "strong" ? colors.glassFillStrong
    : colors.glassFill;

  const pakaiBlur = blur && glassTier === "FULL" && Platform.OS === "android" && blurTarget != null;

  return (
    <View style={[bentuk, bayangan, { borderWidth: 1, borderColor: variant === "flat" ? colors.hairline : colors.glassStroke }, style]}>
      {pakaiBlur ? (
        <BlurView
          blurTarget={blurTarget ?? undefined}
          blurMethod="dimezisBlurViewSdk31Plus"
          tint={isDark ? "dark" : "light"}
          intensity={60}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: isi }]} />
      <View style={{ padding }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  kilau: { position: "absolute", top: -60, right: -40, width: 200, height: 200, borderRadius: 100 },
});
