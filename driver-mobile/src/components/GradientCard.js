// Kartu gradasi (12 Sep 2026, fase 3 redesign UI — referensi Gojek/
// DelTrack: hero card biru di atas layar). Pakai react-native-svg
// (SUDAH ada sebagai dependency native SEJAK scaffold awal — dipakai
// lucide-react-native buat gambar tiap ikon, jadi native module-nya
// SUDAH ter-compile di binary preview yang terpasang) — AMAN dikirim
// lewat OTA, BEDA dari expo-linear-gradient yang butuh native rebuild
// baru kalau belum ada di binary.
import React, { useRef } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";

let seq = 0;

export default function GradientCard({ colors, style, contentStyle, radius = 22, children }) {
  const id = useRef(`gc-grad-${seq++}`).current;
  return (
    <View style={[{ borderRadius: radius, overflow: "hidden" }, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[0]} stopOpacity={1} />
            <Stop offset="1" stopColor={colors[1]} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
});
