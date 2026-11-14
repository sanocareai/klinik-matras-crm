import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { PressableScale, usePadaLatarGelap } from "./ui";
import { C, F, KACA } from "./tokens";

/** Bilah navigasi: tombol kembali bulat dari kaca + judul di tengah (transparan di atas <Latar>). */
export function NavBar({ judul, kembali = "Kembali" }: { judul: string; kembali?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const diAtasBiru = usePadaLatarGelap(); // judul putih di atas gradasi biru; tombol kembali tetap kaca putih + teks gelap
  return (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, height: insets.top + 60, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={kembali}
        onPress={() => router.back()}
        style={{ height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: kembali === "Kembali" ? 0 : 14, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: diAtasBiru ? KACA.bulat.bg : "rgba(255,255,255,0.55)", borderWidth: 1, borderColor: diAtasBiru ? KACA.bulat.tepi : "rgba(255,255,255,0.85)", boxShadow: KACA.bulat.bayang }}
      >
        {kembali === "Kembali" ? <ChevronLeft color={diAtasBiru ? C.white : C.ink} size={22} strokeWidth={2.2} /> : <Text style={{ fontFamily: F.bold, fontSize: 14, color: diAtasBiru ? C.white : C.ink }}>{kembali}</Text>}
      </PressableScale>
      <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ flex: 1, textAlign: "center", fontFamily: F.bold, fontSize: 17, color: diAtasBiru ? C.white : C.ink }}>{judul}</Text>
      <View style={{ minWidth: kembali === "Kembali" ? 44 : 70 }} />
    </View>
  );
}
