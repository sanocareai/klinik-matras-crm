import React from "react";
import { Pressable, Text, View } from "react-native";
import { haptic } from "./haptics";
import { C, F, KACA } from "./tokens";
import { usePadaLatarGelap } from "./ui";

/** Segmented control kaca: jalur tembus pandang, pilihan aktif = pil putih. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  // Di atas latar biru: jalur kaca (putih 22% + tepi 45%, seperti pil mockup), pilihan aktif = pil putih 95%, sisanya teks putih.
  // Di dalam panel/kartu terang: jalur #DDE8F5 (mockup Laporan).
  const diAtasBiru = usePadaLatarGelap();
  return (
    <View accessibilityRole="tablist" style={[{ flexDirection: "row", borderRadius: 22, padding: 4 }, diAtasBiru ? { backgroundColor: KACA.pil.bg, borderWidth: 1, borderColor: KACA.pil.tepi } : { backgroundColor: "#DDE8F5" }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => { if (!on) { haptic.tick(); onChange(o.key); } }}
            style={[{ flex: 1, minHeight: 40, borderRadius: 18, alignItems: "center", justifyContent: "center" }, on && { backgroundColor: KACA.tombolPutih.bg, boxShadow: "0 3px 12px rgba(20,60,140,0.14), inset 0 1px 0 #FFFFFF" }]}
          >
            <Text style={{ fontFamily: on ? F.heavy : F.bold, fontSize: 13, color: on ? C.ink : diAtasBiru ? C.white : "#42526B" }} numberOfLines={1} maxFontSizeMultiplier={1.3}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
