// Kartu gradasi (12 Sep 2026, fase 3 redesign UI — referensi Gojek/
// DelTrack: hero card biru di atas layar). Pakai react-native-svg
// (SUDAH ada sebagai dependency native SEJAK scaffold awal — dipakai
// lucide-react-native buat gambar tiap ikon, jadi native module-nya
// SUDAH ter-compile di binary preview yang terpasang) — AMAN dikirim
// lewat OTA, BEDA dari expo-linear-gradient yang butuh native rebuild
// baru kalau belum ada di binary.
import React, { useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";

let seq = 0;

// BUG NYATA (13 Sep 2026, laporan owner: screenshot AdminHomeScreen —
// angka "Total Job/Selesai/Jalan" di hero nyaris tak terlihat, seperti
// "hantu"). Root cause: Svg sebelumnya `width="100%" height="100%"` di
// dalam View yang tingginya sendiri ditentukan oleh KONTEN (heroStatsRow
// baru dirender belakangan, setelah `isLoading` selesai — lihat
// AdminHomeScreen.js). Svg absolut TIDAK ikut menyumbang tinggi ke parent,
// jadi saat konten tumbuh (baris angka muncul), Svg persentase tidak
// selalu re-ukur mengikuti — di Android RN ini kadang macet di ukuran LAMA
// (sebelum heroStatsRow ada), jadi gradasi biru berhenti sebelum baris
// angka, dan teks putih di situ jatuh di atas latar terang halaman (NAVY
// light mode = abu-biru sangat terang), nyaris tak kelihatan.
// FIX: ukur ukuran KONTAINER sungguhan lewat onLayout (yang WAJIB
// re-fire tiap kali tinggi berubah, termasuk saat heroStatsRow muncul),
// lalu kasih Svg dimensi PIXEL eksplisit — bukan "100%" yang rawan stale.
export default function GradientCard({ colors, style, contentStyle, radius = 22, children }) {
  const id = useRef(`gc-grad-${seq++}`).current;
  const [size, setSize] = useState(null);

  return (
    <View
      style={[{ borderRadius: radius, overflow: "hidden" }, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {size && (
        <Svg style={StyleSheet.absoluteFill} width={size.width} height={size.height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors[0]} stopOpacity={1} />
              <Stop offset="1" stopColor={colors[1]} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.width} height={size.height} fill={`url(#${id})`} />
        </Svg>
      )}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
});
