import React, { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useKurangiGerak } from "./gerak";

// LATAR AURORA untuk layar pembuka (login): biru pekat sewarna splash + tiga cahaya lembut yang melayang pelan.
// Ringan untuk HP kelas menengah: cahaya = lingkaran konsentris (tanpa blur GPU), gerak hanya translate/scale lewat
// native driver dengan loop panjang (7–10 detik). "Kurangi gerakan" → diam.

const BIRU = ["#0A55D1", "#0B3FC0", "#03195B"] as const;

function Cahaya({ size, color, top, left, dx, dy, durasi }: { size: number; color: string; top: number; left: number; dx: number; dy: number; durasi: number }) {
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
    <Animated.View pointerEvents="none" style={{ position: "absolute", top, left, width: size, height: size, alignItems: "center", justifyContent: "center", transform }}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.12 }} />
      <View style={{ position: "absolute", width: size * 0.7, height: size * 0.7, borderRadius: size * 0.35, backgroundColor: color, opacity: 0.16 }} />
      <View style={{ position: "absolute", width: size * 0.42, height: size * 0.42, borderRadius: size * 0.21, backgroundColor: color, opacity: 0.2 }} />
    </Animated.View>
  );
}

export const Aurora = React.memo(function Aurora() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={BIRU} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <Cahaya size={380} color="#5CC8FF" top={-120} left={-140} dx={60} dy={40} durasi={8000} />
      <Cahaya size={340} color="#3FD9C8" top={260} left={140} dx={-70} dy={50} durasi={10000} />
      <Cahaya size={300} color="#8FB8FF" top={560} left={-80} dx={50} dy={-60} durasi={7000} />
    </View>
  );
});
