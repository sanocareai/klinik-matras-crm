import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { LATAR } from "./tokens";

// LATAR — persis kanvas mockup v2: gradasi 180° (biru → biru es di bawah) + PENDAR yang di-blur halus.
// Di mockup pendar = lingkaran dengan `filter: blur(30–60px)`; React Native tidak punya blur lintas-versi Android, jadi pendar
// di-render sekali ke PNG transparan (Gaussian asli, lihat skrip olah_latar.py) lalu direntangkan memenuhi layar.
// Hasilnya TANPA tepi lingkaran (versi lama menumpuk lingkaran konsentris → terlihat bentuk bulat, dikoreksi 14 Nov 2026).
export type NadaLatar = "biru" | "navy";
const PENDAR = {
  biru: require("../../assets/latar/pendar-biru.png"),
  navy: require("../../assets/latar/pendar-navy.png"),
} as const;

// memo + renderToHardwareTextureAndroid: lapisan statis ini disimpan sebagai satu tekstur GPU → tidak digambar ulang saat menggulir.
export const Latar = React.memo(function Latar({ nada = "biru" }: { nada?: NadaLatar }) {
  const g = LATAR[nada];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} renderToHardwareTextureAndroid shouldRasterizeIOS>
      <LinearGradient colors={g.colors} locations={g.locations} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <Image source={PENDAR[nada]} style={StyleSheet.absoluteFill} contentFit="fill" transition={0} accessible={false} />
    </View>
  );
});
