import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { CalendarDays, Check, ChevronDown } from "lucide-react-native";
import { Sheet } from "@/design/Sheet";
import { PressableScale } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { daftarBulan, periodePreset, type Periode } from "@/lib/periode";
import { jam, waktuRelatif } from "@/lib/dates";
import { useNow } from "@/hooks/useNow";

// PILIHAN PERIODE + STATUS "DIPERBARUI". Periode hanya memengaruhi laba rugi; kas, piutang, utang selalu posisi saat ini.

export function PeriodeBar({
  periode, onPilih, memuat, diperbaruiMs,
}: { periode: Periode; onPilih: (id: string) => void; memuat: boolean; diperbaruiMs: number | null }) {
  const { colors } = useTheme();
  const [buka, setBuka] = useState(false);
  const now = useNow();
  const preset = useMemo(() => periodePreset(now), [now]);
  const bulan = useMemo(() => daftarBulan(now, 12), [now]);

  function pilih(id: string) {
    haptic.tick();
    setBuka(false);
    onPilih(id);
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <PressableScale
          onPress={() => { haptic.tick(); setBuka(true); }}
          accessibilityLabel={`Periode laporan: ${periode.label}. Ketuk untuk mengganti`}
          style={{
            minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: radius.chip,
            backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke,
          }}
        >
          <CalendarDays size={18} color={colors.primary} strokeWidth={1.75} />
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, flexShrink: 1 }}>{periode.label}</Text>
          <ChevronDown size={16} color={colors.textMuted} strokeWidth={1.75} />
        </PressableScale>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          {memuat ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, flexShrink: 1 }} accessibilityLiveRegion="polite">
            {memuat ? "Memuat…" : diperbaruiMs ? `Diperbarui ${jam(new Date(diperbaruiMs).toISOString())} WIB · ${waktuRelatif(new Date(diperbaruiMs).toISOString(), now)}` : ""}
          </Text>
        </View>
      </View>

      <Sheet visible={buka} onClose={() => setBuka(false)} judul="Pilih periode" sub="Periode dipakai untuk laba rugi. Kas, piutang, dan utang selalu menunjukkan posisi saat ini.">
        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          <Kelompok judul="Pilihan cepat" daftar={preset} aktif={periode} onPilih={pilih} />
          <Kelompok judul="Bulan tertentu" daftar={bulan} aktif={periode} onPilih={pilih} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

function Kelompok({ judul, daftar, aktif: dipilih, onPilih }: { judul: string; daftar: Periode[]; aktif: Periode; onPilih: (id: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 6, marginBottom: 4 }}>{judul}</Text>
      {daftar.map((p) => {
        const aktif = p.from === dipilih.from && p.to === dipilih.to; // rentang sama = periode sama
        return (
          <PressableScale
            key={p.id}
            onPress={() => onPilih(p.id)}
            accessibilityLabel={`${p.judul ? `${p.judul}, ${p.label}` : p.label}${aktif ? ", dipilih" : ""}`}
            style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.hairline }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.text, fontFamily: aktif ? font.semibold : font.regular, fontSize: 15, flexShrink: 1 }}>{p.judul ?? p.label}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {p.judul ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{p.label}</Text> : null}
              {aktif ? <Check size={18} color={colors.primary} strokeWidth={2} /> : null}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}
