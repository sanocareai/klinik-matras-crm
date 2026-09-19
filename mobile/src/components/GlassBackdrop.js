// Latar "liquid glass": gradien lembut + dua bercak cahaya. Diletakkan sebagai ANAK PERTAMA
// container layar (absolute, di bawah konten) — layar tidak perlu diubah strukturnya.
// Kartu kaca di atasnya cukup translusen (tokens.glass.surface); blur sungguhan tidak dipakai
// karena di atas gradien halus hasilnya nyaris tak terlihat tapi memakan kinerja Android.
import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import { useTokens } from "../constants/theme";

function GlassBackdrop() {
  const { glass } = useTokens();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={glass.gradient} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="gA" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glass.blobA} stopOpacity={glass.blobAOpacity} />
            <Stop offset="1" stopColor={glass.blobA} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="gB" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glass.blobB} stopOpacity={glass.blobBOpacity} />
            <Stop offset="1" stopColor={glass.blobB} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="8%" cy="4%" r="190" fill="url(#gA)" />
        <Circle cx="98%" cy="64%" r="170" fill="url(#gB)" />
      </Svg>
    </View>
  );
}

// memo: latar tidak boleh ikut dirender ulang tiap layar induknya berganti state.
export default memo(GlassBackdrop);

// Gradien untuk kartu utama (mis. Target Tim) — anak pertama kartu ber-overflow hidden.
export function HeroGradient() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["#3B74FF", "#1F4FD8", "#1638A8"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
