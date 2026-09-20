import React, { useState } from "react";
import { ScrollView, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { Sheet } from "@/design/Sheet";
import { PressableScale } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { hariIniWIB } from "@/lib/dates";

// PRIMITIF ISIAN FORMULIR (S6–S8). Validasi inline (pesan tampil di bawah kolom), label tidak menyusut di font besar, target sentuh ≥ 44dp.

export function Kolom({ label, wajib, galat, petunjuk, children }: { label: string; wajib?: boolean; galat?: string | null; petunjuk?: string | null; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 13, marginBottom: 6 }}>
        {label}{wajib ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      {children}
      {galat ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={{ color: colors.danger, fontFamily: font.regular, fontSize: 12, marginTop: 5 }}>{galat}</Text>
        : petunjuk ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginTop: 5 }}>{petunjuk}</Text> : null}
    </View>
  );
}

const gayaKotak = (colors: ReturnType<typeof useTheme>["colors"], galat: boolean) => ({
  minHeight: 48, paddingHorizontal: 14, borderRadius: radius.button, backgroundColor: colors.solidAlt, borderWidth: 1, borderColor: galat ? colors.danger : colors.hairline,
  color: colors.text, fontFamily: font.regular, fontSize: 15,
});

export function IsianTeks({ label, nilai, onUbah, wajib, galat, petunjuk, placeholder, multiline, keyboardType, maxLength, editable = true, nama }: {
  label: string; nilai: string; onUbah: (t: string) => void; wajib?: boolean; galat?: string | null; petunjuk?: string | null; placeholder?: string;
  multiline?: boolean; keyboardType?: KeyboardTypeOptions; maxLength?: number; editable?: boolean; nama?: string;
}) {
  const { colors } = useTheme();
  return (
    <Kolom label={label} wajib={wajib} galat={galat} petunjuk={petunjuk}>
      <TextInput
        value={nilai} onChangeText={onUbah} placeholder={placeholder} placeholderTextColor={colors.textFaint} editable={editable} multiline={multiline}
        keyboardType={keyboardType} maxLength={maxLength} accessibilityLabel={nama ?? label} maxFontSizeMultiplier={1.4}
        style={[gayaKotak(colors, !!galat), multiline ? { minHeight: 84, paddingTop: 12, textAlignVertical: "top" as const } : null]}
      />
    </Kolom>
  );
}

/** Isian nominal Rupiah: teks bebas (mis. "1.500.000") — dibaca jadi string desimal oleh pemanggil (parseInputRupiah), TIDAK PERNAH jadi Number. */
export function IsianUang({ label = "Nominal", nilai, onUbah, wajib = true, galat, petunjuk, editable = true }: {
  label?: string; nilai: string; onUbah: (t: string) => void; wajib?: boolean; galat?: string | null; petunjuk?: string | null; editable?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Kolom label={label} wajib={wajib} galat={galat} petunjuk={petunjuk}>
      <View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, gayaKotak(colors, !!galat), { paddingVertical: 0 }]}>
        <Text style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 15 }}>Rp</Text>
        <TextInput
          value={nilai} onChangeText={(t) => onUbah(t.replace(/[^\d.,]/g, ""))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textFaint}
          editable={editable} accessibilityLabel={label} maxFontSizeMultiplier={1.4}
          style={{ flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 18, minHeight: 46 }}
        />
      </View>
    </Kolom>
  );
}

/** Tanggal format YYYY-MM-DD dengan pintasan Hari ini / Kemarin (tanpa pemilih kalender — ringan & aman di HP lama). */
export function IsianTanggal({ label = "Tanggal", nilai, onUbah, galat }: { label?: string; nilai: string; onUbah: (t: string) => void; galat?: string | null }) {
  const { colors } = useTheme();
  const hariIni = hariIniWIB();
  const kemarin = new Date(Date.parse(`${hariIni}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const chip = (teks: string, v: string) => (
    <PressableScale key={teks} onPress={() => { haptic.tick(); onUbah(v); }} accessibilityLabel={`${teks}, ${v}`} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: radius.chip, justifyContent: "center", backgroundColor: nilai === v ? colors.primary : colors.glassFill, borderWidth: 1, borderColor: nilai === v ? colors.primary : colors.glassStroke }}>
      <Text style={{ color: nilai === v ? colors.onPrimary : colors.text, fontFamily: font.medium, fontSize: 13 }}>{teks}</Text>
    </PressableScale>
  );
  return (
    <Kolom label={label} wajib galat={galat} petunjuk="Format TTTT-BB-HH, mis. 2026-09-21">
      <TextInput
        value={nilai} onChangeText={(t) => onUbah(t.replace(/[^\d-]/g, "").slice(0, 10))} placeholder="2026-09-21" placeholderTextColor={colors.textFaint}
        keyboardType="numbers-and-punctuation" accessibilityLabel={label} maxFontSizeMultiplier={1.4} style={gayaKotak(colors, !!galat)}
      />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>{[chip("Hari ini", hariIni), chip("Kemarin", kemarin)]}</View>
    </Kolom>
  );
}

export const tanggalSah = (t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`));

export type OpsiPilih = { id: string; label: string; sub?: string };

/** Pilihan dari daftar (kategori, rekening, supplier, karyawan…) lewat sheet. Status memuat/galat ditampilkan pemanggil lewat `petunjuk`/`galat`. */
export function IsianPilih({ label, nilai, opsi, onUbah, wajib, galat, petunjuk, placeholder = "Pilih…", judulSheet, memuat, kosongPesan }: {
  label: string; nilai: string; opsi: OpsiPilih[]; onUbah: (id: string) => void; wajib?: boolean; galat?: string | null; petunjuk?: string | null;
  placeholder?: string; judulSheet?: string; memuat?: boolean; kosongPesan?: string;
}) {
  const { colors } = useTheme();
  const [buka, setBuka] = useState(false);
  const terpilih = opsi.find((o) => o.id === nilai);
  return (
    <Kolom label={label} wajib={wajib} galat={galat} petunjuk={petunjuk}>
      <PressableScale onPress={() => { haptic.tick(); setBuka(true); }} accessibilityLabel={`${label}: ${terpilih?.label ?? "belum dipilih"}`} style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, gayaKotak(colors, !!galat)]}>
        <Text numberOfLines={2} maxFontSizeMultiplier={1.4} style={{ flex: 1, color: terpilih ? colors.text : colors.textFaint, fontFamily: font.regular, fontSize: 15 }}>
          {memuat ? "Memuat…" : terpilih?.label ?? placeholder}
        </Text>
        <ChevronDown size={18} color={colors.textMuted} strokeWidth={1.75} />
      </PressableScale>
      <Sheet visible={buka} onClose={() => setBuka(false)} judul={judulSheet ?? label}>
        <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
          {opsi.length === 0 ? <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, paddingVertical: 12 }}>{kosongPesan ?? "Belum ada pilihan."}</Text> : null}
          {opsi.map((o) => (
            <PressableScale key={o.id} onPress={() => { haptic.tick(); onUbah(o.id); setBuka(false); }} accessibilityLabel={`${o.label}${o.sub ? `, ${o.sub}` : ""}`} style={{ minHeight: 52, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: o.id === nilai ? font.semibold : font.medium, fontSize: 15 }}>{o.label}</Text>
                {o.sub ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{o.sub}</Text> : null}
              </View>
              {o.id === nilai ? <Check size={18} color={colors.primary} strokeWidth={2} /> : null}
            </PressableScale>
          ))}
        </ScrollView>
      </Sheet>
    </Kolom>
  );
}
