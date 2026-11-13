import React from "react";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

// Ikon aplikasi (kanvas "Bahasa Desain"): tiga lapisan kasur + centang hijau, latar biru→indigo.
export function AppIcon({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 168 168" accessibilityLabel="Ikon SANSS Produksi">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor="#5E8BFF" />
          <Stop offset="1" stopColor="#3F4BD9" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="168" height="168" rx="38" fill="url(#g)" />
      <Rect x="46" y="94" width="76" height="16" rx="8" fill="#fff" opacity={0.55} />
      <Rect x="46" y="75" width="76" height="16" rx="8" fill="#fff" opacity={0.8} />
      <Rect x="46" y="56" width="76" height="16" rx="8" fill="#fff" />
      <Circle cx="110" cy="64" r="13" fill="#34C759" stroke="#fff" strokeWidth={4} />
      <Path d="m104 64 4.5 4.5L116 60" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
