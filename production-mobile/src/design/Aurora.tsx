import React, { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useKurangiGerak } from "./gerak";

// LATAR AURORA untuk layar pembuka (login): biru pekat sewarna splash + tiga pendar lembut yang melayang pelan.
// Pendar = SATU gambar bulat yang sudah di-blur (assets/latar/pendar-bulat.png, diwarnai lewat tintColor) — tanpa tepi lingkaran.
// (Versi lama menumpuk lingkaran konsentris sehingga terlihat bentuk bulat; dikoreksi 14 Nov 2026 mengikuti mockup.)
// Ringan untuk HP kelas menengah: gerak hanya translate/scale lewat native driver, loop panjang (7–10 detik). "Kurangi gerakan" → diam.

const BIRU = ["#0A55D1", "#0B3FC0", "#03195B"] as const;
const PENDAR = require("../../assets/latar/pendar-bulat.png");

function Cahaya({ size, color, opacity, top, left, dx, dy, durasi }: { size: number; color: string; opacity: number; top: number; left: number; dx: number; dy: number; durasi: number }) {
  const kurangi = useKurangiGerak();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (kurangi) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: durasi, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: durasi, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [t, durasi, kurangi]);
  const transform = [
    { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
    { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
    { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
  ];
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", top, left, width: size, height: size, opacity, transform }}>
      <Image source={PENDAR} tintColor={color} contentFit="fill" transition={0} accessible={false} style={{ width: size, height: size }} />
    </Animated.View>
  );
}

export const Aurora = React.memo(function Aurora() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={BIRU} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <Cahaya size={520} color="#5CC8FF" opacity={0.5} top={-190} left={-210} dx={60} dy={40} durasi={8000} />
      <Cahaya size={480} color="#3FD9C8" opacity={0.3} top={200} left={90} dx={-70} dy={50} durasi={10000} />
      <Cahaya size={440} color="#8FB8FF" opacity={0.45} top={500} left={-150} dx={50} dy={-60} durasi={7000} />
    </View>
  );
});
