import React from "react";
import { Pressable, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { Check } from "lucide-react-native";
import { C, F, TONE, TOUCH } from "./tokens";

// KOMPONEN ISIAN — besar & minim ketik (lantai produksi): kotak centang selebar baris, pilihan chip, angka.

export function CentangBaris({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: TOUCH, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.card, borderRadius: 14 }}
    >
      <View style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: value ? TONE.green.fill : "transparent", borderWidth: value ? 0 : 2, borderColor: "#C7C7CC" }}>
        {value ? <Check color="#fff" size={17} strokeWidth={3.2} /> : null}
      </View>
      <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 15.5, color: C.ink }}>{label}</Text>
    </Pressable>
  );
}

export function Isian({ label, value, onChange, placeholder, multiline, keyboardType, suffix }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: KeyboardTypeOptions; suffix?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.ink2, marginLeft: 4 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14 }}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.ink3}
          multiline={multiline}
          keyboardType={keyboardType}
          style={{ flex: 1, minHeight: multiline ? 88 : 52, paddingVertical: 12, fontFamily: F.regular, fontSize: 16, color: C.ink, textAlignVertical: multiline ? "top" : "center" }}
        />
        {suffix ? <Text style={{ fontFamily: F.semibold, fontSize: 15, color: C.ink3 }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export function PilihanChip<K extends string>({ label, options, value, onChange, multi }: {
  label?: string; options: readonly { value: K; label: string }[]; value: K[]; onChange: (v: K[]) => void; multi?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.ink2, marginLeft: 4 }}>{label}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <Pressable
              key={o.value}
              accessibilityRole={multi ? "checkbox" : "radio"}
              accessibilityState={multi ? { checked: on } : { selected: on }}
              onPress={() => onChange(multi ? (on ? value.filter((x) => x !== o.value) : [...value, o.value]) : [o.value])}
              style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: "center", backgroundColor: on ? TONE.blue.fill : C.card, borderWidth: on ? 0 : 1.5, borderColor: "#D1D1D6" }}
            >
              <Text style={{ fontFamily: F.semibold, fontSize: 15, color: on ? "#fff" : C.ink }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
