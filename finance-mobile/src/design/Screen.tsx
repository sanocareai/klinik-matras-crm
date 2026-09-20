import React, { createContext, useContext, useRef } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurTargetView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme";
import { GUTTER, font } from "./tokens";
import { PESAN_BACA_SAJA, bacaSaja } from "@/lib/bacaSaja";

// Konteks lapisan latar yang di-blur (tier FULL, Android). Tiap <Screen> punya
// targetnya sendiri sehingga banyak layar (tab) tidak berebut satu ref.
export const BlurTargetContext = createContext<React.RefObject<View | null> | null>(null);
export function useBlurTarget() {
  return useContext(BlurTargetContext);
}

/** Latar "Biru Kaca": gradien statis + dua bulatan cahaya. Satu-satunya lapisan besar di layar. */
function Latar() {
  const { colors } = useTheme();
  return (
    <>
      <LinearGradient colors={[colors.bgTop, colors.bgBottom]} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.blob, { top: -80, right: -60, backgroundColor: colors.blob1 }]} />
      <View pointerEvents="none" style={[styles.blob, { top: 260, left: -110, width: 260, height: 260, borderRadius: 130, backgroundColor: colors.blob2 }]} />
    </>
  );
}

/** Pelindung status bar: konten yang bergulir ke atas tidak boleh menembus jam & ikon sistem. */
export function StatusBarScrim() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: colors.bgTop }} />;
}

type Props = {
  children: React.ReactNode;
  /** false = konten tidak digulir (mis. daftar yang punya FlatList sendiri). */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Ruang bawah untuk tab bar + FAB. */
  bawah?: number;
  contentStyle?: StyleProp<ViewStyle>;
};

/** Penanda tetap di semua layar pada build preview baca-saja. */
function BannerBacaSaja() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" accessibilityLabel={PESAN_BACA_SAJA} style={{ padding: 8, borderRadius: 12, backgroundColor: colors.warningSoft, marginBottom: 12 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12, lineHeight: 17, textAlign: "center" }}>{PESAN_BACA_SAJA}</Text>
    </View>
  );
}

export function Screen({ children, scroll = true, refreshing = false, onRefresh, bawah = 120, contentStyle }: Props) {
  const { colors, glassTier } = useTheme();
  const insets = useSafeAreaInsets();
  const target = useRef<View | null>(null);
  const pakaiBlur = glassTier === "FULL";

  const isi = scroll ? (
    <ScrollView
      contentContainerStyle={[{ paddingTop: insets.top + 8, paddingHorizontal: GUTTER, paddingBottom: bawah }, contentStyle]}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
    >
      {bacaSaja() ? <BannerBacaSaja /> : null}
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingTop: insets.top + 8, paddingHorizontal: GUTTER }, contentStyle]}>{bacaSaja() ? <BannerBacaSaja /> : null}{children}</View>
  );

  return (
    <BlurTargetContext.Provider value={pakaiBlur ? target : null}>
      <View style={[styles.root, { backgroundColor: colors.bgBottom }]}>
        {pakaiBlur ? (
          <BlurTargetView ref={target} style={StyleSheet.absoluteFill}>
            <Latar />
          </BlurTargetView>
        ) : (
          <View style={StyleSheet.absoluteFill}><Latar /></View>
        )}
        {isi}
        <StatusBarScrim />
      </View>
    </BlurTargetContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  blob: { position: "absolute", width: 320, height: 320, borderRadius: 160 },
});
