// Bottom nav pill (12 Sep 2026, fase 2 redesign UI — referensi Gojek/
// Grab/DelTrack: bar melayang bulat di bawah, item aktif jadi lingkaran
// solid ACCENT berisi ikon putih, item non-aktif ikon pudar + label
// kecil). Menggantikan tab pill di ATAS konten yang dipakai JobListScreen
// (Aktif/Riwayat) & AdminHomeScreen (Hari Ini/Driver/Masalah/Performa) —
// komponen bersama supaya perilaku & tampilan konsisten di kedua layar,
// bukan reimplementasi tab dua kali.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function BottomNavBar({ items, active, onChange, theme: t, badge }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: t.SURFACE, borderColor: t.BORDER }]}>
        {items.map((it) => {
          const isActive = it.key === active;
          const Icon = it.icon;
          const count = badge?.[it.key] || 0;
          return (
            <Pressable key={it.key} style={styles.item} onPress={() => onChange(it.key)} hitSlop={8}>
              <View style={[styles.iconWrap, isActive && { backgroundColor: t.ACCENT }]}>
                <Icon size={18} color={isActive ? "#FFFFFF" : t.INK3} />
                {count > 0 && (
                  <View style={[styles.dot, { backgroundColor: t.RED, borderColor: t.SURFACE }]}>
                    <Text style={styles.dotText}>{count > 9 ? "9+" : count}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, { color: isActive ? t.ACCENT : t.INK3 }]} numberOfLines={1}>
                {it.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8 },
  bar: {
    flexDirection: "row", borderRadius: 26, paddingVertical: 8, paddingHorizontal: 6,
    borderWidth: 1,
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 14,
    elevation: 10,
  },
  item: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 2 },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 10, fontWeight: "700" },
  dot: {
    position: "absolute", top: -3, right: -4, minWidth: 15, height: 15, borderRadius: 8,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderWidth: 1.5,
  },
  dotText: { color: "#FFFFFF", fontSize: 8, fontWeight: "800" },
});
