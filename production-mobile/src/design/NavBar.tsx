import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { PressableScale } from "./ui";
import { C, F, G } from "./tokens";

/** Bilah navigasi: tombol kembali bulat dari kaca + judul di tengah (transparan di atas <Latar>). */
export function NavBar({ judul, kembali = "Kembali" }: { judul: string; kembali?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, height: insets.top + 60, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={kembali}
        onPress={() => router.back()}
        style={{ height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: kembali === "Kembali" ? 0 : 14, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: G.fillStrong, borderWidth: 1, borderColor: G.stroke }}
      >
        {kembali === "Kembali" ? <ChevronLeft color={C.ink} size={24} /> : <Text style={{ fontFamily: F.bold, fontSize: 15, color: C.ink }}>{kembali}</Text>}
      </PressableScale>
      <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ flex: 1, textAlign: "center", fontFamily: F.heavy, fontSize: 17, color: C.ink }}>{judul}</Text>
      <View style={{ minWidth: kembali === "Kembali" ? 44 : 70 }} />
    </View>
  );
}
