import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { elevation, radius, useTheme } from "./theme";
import { Icon } from "./icons";

// Navigasi bawah HANYA untuk tujuan yang benar-benar ada (Beranda, Biaya Armada). Modul lain belum punya layar,
// jadi tidak diberi tombol di sini. Tinggi yang dipakai layar untuk padding bawah: NAV_SPACE + inset bawah.
export const NAV_SPACE = 96;
const TUJUAN = [
  { name: "Home", label: "Beranda", icon: "home" },
  { name: "BiayaArmada", label: "Biaya Armada", icon: "wallet" },
];

export function BottomNav({ navigation, current }) {
  const t = useTheme();
  const inset = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[s.wrap, { paddingBottom: Math.max(inset.bottom, 10) + 6 }]}>
      <View style={[s.dock, { backgroundColor: t.navBg, borderColor: t.border }, elevation(t, 2)]}>
        {TUJUAN.map((d) => {
          const aktif = d.name === current;
          return (
            <Pressable key={d.name} onPress={() => !aktif && navigation.navigate(d.name)} accessibilityRole="tab" accessibilityState={{ selected: aktif }} accessibilityLabel={d.label}
              style={[s.item, aktif && { backgroundColor: t.accent }]}>
              <Icon name={d.icon} size={20} color={aktif ? t.accentInk : t.ink2} />
              {aktif && <Text style={{ color: t.accentInk, fontWeight: "700", fontSize: 13 }}>{d.label}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  dock: { flexDirection: "row", gap: 6, padding: 6, borderRadius: radius.pill, borderWidth: 1 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, height: 48, minWidth: 56, paddingHorizontal: 18, borderRadius: radius.pill, justifyContent: "center" },
});
