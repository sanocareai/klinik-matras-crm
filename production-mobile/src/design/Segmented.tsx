import React from "react";
import { Pressable, Text, View } from "react-native";
import { haptic } from "./haptics";
import { C, F, G } from "./tokens";

/** Segmented control kaca: jalur tembus pandang, pilihan aktif = pil putih. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: C.fill, borderRadius: 22, padding: 4, borderWidth: 1, borderColor: G.stroke }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => { if (!on) { haptic.tick(); onChange(o.key); } }}
            style={[{ flex: 1, minHeight: 40, borderRadius: 18, alignItems: "center", justifyContent: "center" }, on && { backgroundColor: C.card, shadowColor: G.shadow, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }]}
          >
            <Text style={{ fontFamily: on ? F.bold : F.semibold, fontSize: 13.5, color: on ? C.ink : C.ink3 }} numberOfLines={1} maxFontSizeMultiplier={1.3}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
