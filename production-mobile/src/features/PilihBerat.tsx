import React from "react";
import { Pressable, Text, View } from "react-native";
import type { BeratPemakai } from "./model";
import { Isian } from "@/design/Form";
import { C, F, TONE } from "@/design/tokens";

/**
 * Isian berat yang TERINTEGRASI dengan order: chip per pemakai (dari Sales) mengisi angka sekali ketuk.
 * Angka tetap bisa diubah bila penguji yang dipakai beratnya berbeda.
 */
export function PilihBerat({ label, value, onChange, pemakai }: { label: string; value: string; onChange: (v: string) => void; pemakai: BeratPemakai[] }) {
  return (
    <View style={{ gap: 8 }}>
      <Isian label={label} value={value} onChange={onChange} keyboardType="number-pad" suffix="kg" />
      {pemakai.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Text style={{ fontFamily: F.medium, fontSize: 12.5, color: C.ink3, marginLeft: 4 }}>Dari order:</Text>
          {pemakai.map((p) => {
            const on = value === String(p.kg);
            return (
              <Pressable
                key={`${p.label}-${p.kg}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Pakai berat ${p.label} ${p.kg} kilogram`}
                onPress={() => onChange(String(p.kg))}
                style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: "center", backgroundColor: on ? TONE.purple.fill : TONE.purple.tint }}
              >
                <Text style={{ fontFamily: F.semibold, fontSize: 14, color: on ? "#fff" : TONE.purple.text }}>{p.label} · {p.kg} kg</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={{ fontFamily: F.medium, fontSize: 12.5, color: TONE.orange.text, marginLeft: 4 }}>Berat badan belum diisi Sales di order — isi berat penguji.</Text>
      )}
    </View>
  );
}
