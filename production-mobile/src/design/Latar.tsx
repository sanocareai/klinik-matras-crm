import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GRAD } from "./tokens";

// LATAR "Biru Kaca": gradasi biru es + tiga bayangan cahaya. React Native tidak punya filter blur untuk View,
// jadi tiap bayangan = tiga lingkaran konsentris yang makin pekat ke tengah (tepi lembut, tanpa biaya GPU blur).
function Cahaya({ size, color, style }: { size: number; color: string; style: object }) {
  return (
    <View pointerEvents="none" style={[{ position: "absolute", width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.16 }} />
      <View style={{ position: "absolute", width: size * 0.72, height: size * 0.72, borderRadius: size * 0.36, backgroundColor: color, opacity: 0.2 }} />
      <View style={{ position: "absolute", width: size * 0.44, height: size * 0.44, borderRadius: size * 0.22, backgroundColor: color, opacity: 0.24 }} />
    </View>
  );
}

// memo: latar statis tidak pernah digambar ulang saat isi layar berubah (hemat di HP kelas menengah).
export const Latar = React.memo(function Latar() {
  return (
    // renderToHardwareTextureAndroid: lapisan statis ini disimpan sebagai satu tekstur GPU → tidak digambar ulang tiap frame saat menggulir.
    <View pointerEvents="none" style={StyleSheet.absoluteFill} renderToHardwareTextureAndroid shouldRasterizeIOS>
      <LinearGradient colors={GRAD.latar} start={{ x: 0, y: 0 }} end={{ x: 0.3, y: 1 }} style={StyleSheet.absoluteFill} />
      <Cahaya size={340} color="#5AA9FF" style={{ top: -120, left: -120 }} />
      <Cahaya size={320} color="#3FD9C8" style={{ top: 300, right: -150 }} />
      <Cahaya size={300} color="#7FB8FF" style={{ bottom: -60, left: -40 }} />
    </View>
  );
});
