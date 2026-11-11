import React from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { C, F, TONE } from "./tokens";

/** Bilah navigasi gaya iOS: tombol kembali + judul di tengah. */
export function NavBar({ judul, kembali = "Kembali" }: { judul: string; kembali?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 8, height: insets.top + 56, flexDirection: "row", alignItems: "center", backgroundColor: C.bg }}>
      <Pressable accessibilityRole="button" accessibilityLabel={kembali} onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", height: 44, paddingHorizontal: 4, minWidth: 90 }}>
        <ChevronLeft color={TONE.blue.text} size={26} />
        <Text style={{ fontFamily: F.regular, fontSize: 17, color: TONE.blue.text }}>{kembali}</Text>
      </Pressable>
      <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, textAlign: "center", fontFamily: F.bold, fontSize: 17, color: C.ink }}>{judul}</Text>
      <View style={{ minWidth: 90 }} />
    </View>
  );
}
