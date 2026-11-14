import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react-native";
import { cariBahanKomponen } from "@/api/komponen";
import type { BarisRework } from "./picBahan";
import { Card, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";

// DAFTAR BAHAN KATALOG + JUMLAH — dipakai Rencana Bahan (BOM) dan Minta Bahan Rework (PIC Bahan).
// Cermin daftar baris + pencarian katalog di BomPlanSheet/ReworkMaterialSheet web. Satu bahan satu baris; tidak menulis stok.

export type BarisKatalog = BarisRework;

export function DaftarBahanKatalog({ lines, onChange, qtyLabel, disabled, kosong = "Belum ada bahan." }: {
  lines: BarisKatalog[]; onChange: (v: BarisKatalog[]) => void; qtyLabel: string; disabled?: boolean; kosong?: string;
}) {
  const [q, setQ] = useState("");
  const hasil = useQuery({ queryKey: ["bahan-komponen", q.trim()], queryFn: () => cariBahanKomponen(q.trim()), enabled: !disabled, staleTime: 60_000 });
  const ada = new Set(lines.map((l) => l.materialId));
  const ubah = (id: string, qty: string) => onChange(lines.map((l) => (l.materialId === id ? { ...l, qty } : l)));
  const hapus = (id: string) => onChange(lines.filter((l) => l.materialId !== id));
  const tambah = (m: { materialId: string; code?: string; name?: string; unit?: string | null }) => {
    if (ada.has(m.materialId)) return;
    onChange([...lines, { materialId: m.materialId, code: m.code ?? null, name: m.name ?? null, unit: m.unit ?? null, qty: "" }]);
  };

  return (
    <View style={{ gap: 10 }}>
      {lines.length ? (
        <View style={{ gap: 8 }}>
          {lines.map((l) => (
            <View key={l.materialId} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.isian, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T.Headline numberOfLines={1}>{l.name || l.code}</T.Headline>
                <T.Caption numberOfLines={1}>{[l.code, l.unit && `satuan ${String(l.unit).toLowerCase()}`].filter(Boolean).join(" · ")}</T.Caption>
              </View>
              <TextInput
                accessibilityLabel={`${qtyLabel} ${l.name || l.code}`}
                value={l.qty}
                editable={!disabled}
                onChangeText={(t) => ubah(l.materialId, t)}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={C.ink3}
                style={{ width: 72, height: 46, borderRadius: 12, backgroundColor: C.fill, textAlign: "center", fontFamily: F.semibold, fontSize: 17, color: C.ink }}
              />
              {!disabled ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${l.name || l.code}`} onPress={() => hapus(l.materialId)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                  <Trash2 color={TONE.red.text} size={19} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : <Card><T.Sub>{kosong}</T.Sub></Card>}

      {!disabled ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 12, paddingHorizontal: 12, height: 44 }}>
            <Search color={C.ink3} size={17} />
            <TextInput accessibilityLabel="Cari bahan katalog" value={q} onChangeText={setQ} placeholder="Cari kode/nama bahan" placeholderTextColor={C.ink3} style={{ flex: 1, fontFamily: F.regular, fontSize: 15, color: C.ink }} />
          </View>
          {hasil.error ? <T.Caption style={{ color: TONE.orange.text }}>Katalog tidak dapat dimuat. Tarik untuk mencoba lagi.</T.Caption> : null}
          {(hasil.data?.items ?? []).slice(0, 10).map((m) => {
            const dipilih = ada.has(m.materialId);
            return (
              <Pressable key={m.materialId} accessibilityRole="button" disabled={dipilih} onPress={() => tambah(m)}
                style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.isian, borderRadius: 12, paddingHorizontal: 12, minHeight: 46, opacity: dipilih ? 0.45 : 1 }}>
                <Text style={{ flex: 1, fontFamily: F.medium, fontSize: 14.5, color: C.ink }} numberOfLines={1}>{m.name}</Text>
                <T.Caption>{m.code}</T.Caption>
                <Plus color={TONE.blue.text} size={17} />
              </Pressable>
            );
          })}
          {hasil.data && !hasil.data.items.length ? <T.Caption>Tidak ada bahan yang cocok.</T.Caption> : null}
        </View>
      ) : null}
    </View>
  );
}
