import React from "react";
import { Pressable, Text, View } from "react-native";
import { C, F } from "./tokens";

/** Segmented control gaya iOS. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: C.fill, borderRadius: 11, padding: 2 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[{ flex: 1, minHeight: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" }, on && { backgroundColor: C.card, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 }]}
          >
            <Text style={{ fontFamily: F.semibold, fontSize: 13.5, color: C.ink }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
