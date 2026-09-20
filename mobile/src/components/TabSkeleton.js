// Kerangka ringan yang tampil SESAAT ketika layar tab dipasang pertama kali di tengah perpindahan tab.
// Sengaja statis (tanpa shimmer/loop animasi) dan hanya belasan View: tugasnya cuma menghindari bingkai kosong/putih
// dan membiarkan animasi geser berjalan tanpa terhalang mount layar besar. Latar SAMA dengan layar asli (GlassBackdrop).
import React, { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import GlassBackdrop from "./GlassBackdrop";
import { useTokens } from "../constants/theme";

function TabSkeleton() {
  const tokens = useTokens();
  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1 },
    title: { height: 30, width: 120, borderRadius: 8, backgroundColor: tokens.color.border, marginHorizontal: 16, marginTop: 20, opacity: 0.6 },
    chips: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 16 },
    chip: { height: 34, width: 88, borderRadius: 17, backgroundColor: tokens.color.border, opacity: 0.45 },
    card: { ...tokens.glass.surface, height: 84, borderRadius: 16, marginHorizontal: 16, marginTop: 12 },
  }), [tokens]);
  return (
    <View style={s.root} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <GlassBackdrop />
      <View style={s.title} />
      <View style={s.chips}><View style={s.chip} /><View style={s.chip} /><View style={s.chip} /></View>
      {[0, 1, 2, 3, 4].map((i) => <View key={i} style={s.card} />)}
    </View>
  );
}

export default memo(TabSkeleton);
