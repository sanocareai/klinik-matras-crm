import React, { useEffect, useState } from "react";
import { Animated, Text, View, type LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Plus, type LucideIcon } from "lucide-react-native";
import { PressableScale } from "./ui";
import { PEGAS_LEMBUT, useKurangiGerak } from "./gerak";
import { haptic } from "./haptics";
import { C, F, KACA, TONE } from "./tokens";

// NAVBAR "LIQUID GLASS" (referensi iOS 27): pil kaca melayang; tab aktif duduk di "lensa" putih yang MELUNCUR dengan pegas
// ke tab yang dipilih (translateX, native driver — mulus walau HP kelas menengah), tombol + bulat terpisah → Aksi Cepat.
// Lebar tab sama rata supaya lensa cukup digeser (tanpa animasi lebar yang berat). > 5 tab → label hanya pada tab aktif.

export type ItemTab = { name: string; label: string; Icon: LucideIcon; badge?: number };
type Props = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
  items: ItemTab[];
};

export const TINGGI_NAVBAR = 70; // mockup: tab 58 + isi 5×2 + tepi 1×2
const PLUS = 68;
const PAD = 5;

export function LiquidTabBar({ state, navigation, items }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const kurangi = useKurangiGerak();
  const aktif = state.routes[state.index]?.name;
  const cari = items.findIndex((it) => it.name === aktif);
  const idx = Math.max(0, cari); // layar dari menu Beranda yang bukan tab (mis. Kerja untuk Admin) → lensa disembunyikan
  const adaAktif = cari >= 0;
  const ringkas = items.length > 5;
  const [lebar, setLebar] = useState(0);
  const lebarItem = lebar > 0 ? (lebar - 2 - PAD * 2) / items.length : 0; // dikurangi tepi 1px kiri-kanan
  const [x] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!lebarItem) return;
    if (kurangi) x.setValue(idx * lebarItem);
    else Animated.spring(x, { toValue: idx * lebarItem, ...PEGAS_LEMBUT }).start();
  }, [idx, lebarItem, kurangi, x]);

  return (
    // mockup: left/right 16, bottom 24 (termasuk area gestur), jarak ke tombol + = 10
    <View pointerEvents="box-none" style={{ position: "absolute", left: 16, right: 16, bottom: Math.max(insets.bottom + 8, 24), flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        accessibilityRole="tablist"
        onLayout={(e: LayoutChangeEvent) => setLebar(e.nativeEvent.layout.width)}
        style={{
          flex: 1, height: TINGGI_NAVBAR, flexDirection: "row", alignItems: "center", padding: PAD, borderRadius: 36,
          // mockup: putih 62% + backdrop-blur. Tanpa blur, isi yang digulir akan terbaca menembus bilah → isian dinaikkan ke 90%
          // (di zona latar yang sudah terang hasilnya sama). Bayangan lewat boxShadow (bukan elevation) → tidak menembus isian.
          backgroundColor: KACA.navbar.bg, borderWidth: 1, borderColor: KACA.navbar.tepi, boxShadow: KACA.navbar.bayang,
        }}
      >
        {lebarItem ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute", left: PAD, top: PAD, width: lebarItem, height: 58, borderRadius: 29,
              backgroundColor: KACA.lensa.bg, borderWidth: 1, borderColor: KACA.lensa.tepi, boxShadow: KACA.lensa.bayang,
              transform: [{ translateX: x }], opacity: adaAktif ? 1 : 0,
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
              style={{ width: lebarItem || undefined, flex: lebarItem ? undefined : 1, height: 58, alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              <View>
                <it.Icon size={22} color={warna} strokeWidth={fokus ? 2.2 : 2} />
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
          // mockup: 68, gradasi 150° #4AA3FF → #007BFF 55% → #0A55D1, tepi putih 70%, bayangan biru — TANPA kilau oval.
          width: PLUS, height: PLUS, borderRadius: PLUS / 2, alignItems: "center", justifyContent: "center",
          borderWidth: 1, borderColor: KACA.plus.tepi, experimental_backgroundImage: KACA.plus.bg, boxShadow: KACA.plus.bayang,
        }}
      >
        <Plus size={26} color={C.white} strokeWidth={2.6} />
      </PressableScale>
    </View>
  );
}
