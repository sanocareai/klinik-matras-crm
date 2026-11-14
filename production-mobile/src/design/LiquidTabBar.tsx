import React, { useEffect, useState } from "react";
import { Animated, Text, View, type LayoutChangeEvent } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Plus, type LucideIcon } from "lucide-react-native";
import { PressableScale } from "./ui";
import { PEGAS_LEMBUT, useKurangiGerak } from "./gerak";
import { haptic } from "./haptics";
import { C, F, G, GRAD, TONE } from "./tokens";

// NAVBAR "LIQUID GLASS" (referensi iOS 27): pil kaca melayang; tab aktif duduk di "lensa" putih yang MELUNCUR dengan pegas
// ke tab yang dipilih (translateX, native driver — mulus walau HP kelas menengah), tombol + bulat terpisah → Aksi Cepat.
// Lebar tab sama rata supaya lensa cukup digeser (tanpa animasi lebar yang berat). > 5 tab → label hanya pada tab aktif.

export type ItemTab = { name: string; label: string; Icon: LucideIcon; badge?: number };
type Props = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
  items: ItemTab[];
};

export const TINGGI_NAVBAR = 68;
const PAD = 5;

export function LiquidTabBar({ state, navigation, items }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const kurangi = useKurangiGerak();
  const aktif = state.routes[state.index]?.name;
  const idx = Math.max(0, items.findIndex((it) => it.name === aktif));
  const ringkas = items.length > 5;
  const [lebar, setLebar] = useState(0);
  const lebarItem = lebar > 0 ? (lebar - PAD * 2) / items.length : 0;
  const [x] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!lebarItem) return;
    if (kurangi) x.setValue(idx * lebarItem);
    else Animated.spring(x, { toValue: idx * lebarItem, ...PEGAS_LEMBUT }).start();
  }, [idx, lebarItem, kurangi, x]);

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 14, right: 14, bottom: Math.max(insets.bottom, 10) + 8, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        accessibilityRole="tablist"
        onLayout={(e: LayoutChangeEvent) => setLebar(e.nativeEvent.layout.width)}
        style={{
          flex: 1, height: TINGGI_NAVBAR, flexDirection: "row", alignItems: "center", padding: PAD, borderRadius: TINGGI_NAVBAR / 2,
          // Isian hampir pekat: elevation Android menggambar bayangan MENEMBUS isian tembus pandang (tampak kotor), jadi bilah ini tidak dibuat bening.
          backgroundColor: "rgba(250,252,255,0.97)", borderWidth: 1, borderColor: C.barLine,
          shadowColor: G.shadow, shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 10,
        }}
      >
        {lebarItem ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: PAD, top: PAD, width: lebarItem, height: TINGGI_NAVBAR - PAD * 2 - 2, borderRadius: (TINGGI_NAVBAR - PAD * 2) / 2,
              backgroundColor: C.white, borderWidth: 1, borderColor: "rgba(0,98,204,0.12)",
              shadowColor: G.shadow, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
              transform: [{ translateX: x }],
            }}
          />
        ) : null}
        {items.map((it) => {
          const fokus = it.name === aktif;
          const warna = fokus ? TONE.blue.text : C.ink;
          return (
            <PressableScale
              key={it.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: fokus }}
              accessibilityLabel={it.badge ? `${it.label}, ${it.badge} perlu dicek` : it.label}
              onPress={() => { if (!fokus) { haptic.tick(); navigation.navigate(it.name); } }}
              style={{ width: lebarItem || undefined, flex: lebarItem ? undefined : 1, height: TINGGI_NAVBAR - PAD * 2, alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              <View>
                <it.Icon size={22} color={warna} strokeWidth={fokus ? 2.3 : 1.9} />
                {it.badge ? (
                  <View style={{ position: "absolute", top: -5, right: -11, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: TONE.orange.fill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: C.white }}>
                    <Text style={{ color: C.white, fontFamily: F.heavy, fontSize: 10 }}>{it.badge > 99 ? "99+" : it.badge}</Text>
                  </View>
                ) : null}
              </View>
              {!ringkas || fokus ? (
                <Text numberOfLines={1} maxFontSizeMultiplier={1.1} style={{ color: warna, fontFamily: fokus ? F.heavy : F.bold, fontSize: 11 }}>{it.label}</Text>
              ) : null}
            </PressableScale>
          );
        })}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Aksi cepat"
        onPress={() => { haptic.ringan(); router.push("/aksi-cepat"); }}
        style={{
          width: TINGGI_NAVBAR, height: TINGGI_NAVBAR, borderRadius: TINGGI_NAVBAR / 2, overflow: "hidden", alignItems: "center", justifyContent: "center",
          borderWidth: 1, borderColor: "rgba(255,255,255,0.7)", elevation: 8,
          shadowColor: TONE.blue.text, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 },
        }}
      >
        <LinearGradient colors={GRAD.brand} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <View pointerEvents="none" style={{ position: "absolute", top: 6, left: 14, width: 30, height: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.35)" }} />
        <Plus size={28} color={C.white} strokeWidth={2.6} />
      </PressableScale>
    </View>
  );
}
