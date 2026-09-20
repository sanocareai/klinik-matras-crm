import React from "react";
import { Text, View } from "react-native";
import { Paperclip } from "lucide-react-native";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { PressableScale } from "@/design/ui";
import { TeksSensitif } from "@/design/Samarkan";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { tanggalPendek } from "@/lib/dates";
import type { ItemTx } from "@/api/types";

// Modul yang angka utamanya adalah SISA (yang belum diselesaikan), bukan nominal awal.
const UTAMAKAN_SISA = new Set(["piutang", "tagihan", "kasbon", "supplier"]);

export const utamaTx = (i: ItemTx) => (UTAMAKAN_SISA.has(i.modul) && i.sisa ? { nilai: i.sisa, label: i.modul === "supplier" ? "Sisa utang" : "Sisa" } : { nilai: i.nominal, label: null });

/** Kalimat umur/jatuh tempo — dihitung server (`umurHari`, `jatuhTempo`); klien hanya menuliskannya. */
export function teksJatuhTempo(i: ItemTx): { teks: string; lewat: boolean } | null {
  if (!i.jatuhTempo) return null;
  const u = i.umurHari;
  if (u == null) return { teks: `Jatuh tempo ${tanggalPendek(i.jatuhTempo)}`, lewat: false };
  if (u > 0) return { teks: `Jatuh tempo ${tanggalPendek(i.jatuhTempo)} · lewat ${u} hari`, lewat: true };
  if (u === 0) return { teks: `Jatuh tempo hari ini (${tanggalPendek(i.jatuhTempo)})`, lewat: false };
  return { teks: `Jatuh tempo ${tanggalPendek(i.jatuhTempo)} · ${-u} hari lagi`, lewat: false };
}

export function KartuTx({ item, onPress }: { item: ItemTx; onPress: () => void }) {
  const { colors } = useTheme();
  const utama = utamaTx(item);
  const jt = teksJatuhTempo(item);
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`${item.judul}, ${item.nomor}, ${item.statusLabel}`} style={{ marginBottom: 12 }}>
      <GlassCard padding={14}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <TeksSensitif numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15, lineHeight: 20 }}>{item.judul}</TeksSensitif>
            {item.sub ? <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{item.sub}</Text> : null}
          </View>
          <View style={{ flexShrink: 0, maxWidth: "48%", alignItems: "flex-end" }}>
            <MoneyText value={utama.nilai} size="md" />
            {utama.label ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 1 }}>{utama.label}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <StatusBadge label={item.statusLabel} tone={item.nada} />
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, flexShrink: 1 }}>{item.nomor}{item.tanggal ? ` · ${tanggalPendek(item.tanggal)}` : ""}</Text>
          {item.adaLampiran ? <Paperclip size={13} color={colors.textFaint} strokeWidth={1.75} accessibilityLabel="Ada lampiran" /> : null}
        </View>
        {item.pihak || item.rekening ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>
            {[item.pihak, item.rekening ? `dari ${item.rekening}` : null].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {jt ? <Text maxFontSizeMultiplier={1.3} style={{ color: jt.lewat ? colors.danger : colors.textMuted, fontFamily: jt.lewat ? font.medium : font.regular, fontSize: 12, marginTop: 4 }}>{jt.teks}</Text> : null}
        {item.notaWajib ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.danger, fontFamily: font.medium, fontSize: 12, marginTop: 4 }}>Nota wajib sebelum disetujui</Text> : null}
      </GlassCard>
    </PressableScale>
  );
}
