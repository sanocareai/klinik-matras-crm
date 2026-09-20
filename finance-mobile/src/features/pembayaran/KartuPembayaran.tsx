import React from "react";
import { Text, View } from "react-native";
import { BadgeCheck, ChevronRight, Paperclip, Split } from "lucide-react-native";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { IconCircle, PressableScale } from "@/design/ui";
import { TeksSensitif, useSamarkan } from "@/design/Samarkan";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { formatRupiah } from "@/lib/money";
import { tanggalPendek } from "@/lib/dates";
import type { JenisBayar, PembayaranItem, StatusBayar } from "@/api/types";

export const LABEL_JENIS_BAYAR: Record<JenisBayar, string> = { DP: "DP", CICILAN: "Cicilan", PELUNASAN: "Pelunasan" };
export const nadaStatusBayar = (s: StatusBayar): "warning" | "success" | "danger" | "neutral" =>
  s === "MENUNGGU" ? "warning" : s === "TERVERIFIKASI" ? "success" : s === "DITOLAK" ? "danger" : "neutral";

export function KartuPembayaran({ item, onPress }: { item: PembayaranItem; onPress: () => void }) {
  const { colors } = useTheme();
  const samar = useSamarkan();
  const jenis = item.jenis ? LABEL_JENIS_BAYAR[item.jenis] : null;
  const label = [
    `Pembayaran${jenis ? ` ${jenis}` : ""}${item.order ? ` order ${item.order.nomor}` : ""}`,
    samar ? "nominal disembunyikan" : formatRupiah(item.nominal),
    samar ? null : item.pelanggan?.name,
    item.metodeLabel,
    item.tanggal ? tanggalPendek(item.tanggal) : null,
    item.statusLabel,
    item.adaBukti ? "ada bukti" : null,
  ].filter(Boolean).join(", ");
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} style={{ marginBottom: 12 }}>
      <GlassCard padding={14}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <IconCircle icon={BadgeCheck} tone={item.status === "TERVERIFIKASI" ? "success" : item.status === "DITOLAK" ? "danger" : "info"} size={36} />
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12 }}>
              {jenis ? `${jenis} · ` : ""}{item.order?.nomor ?? "Tanpa order"}
            </Text>
            <TeksSensitif maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15, lineHeight: 20, marginTop: 1 }}>
              {item.pelanggan?.name ?? "(pelanggan tidak diketahui)"}
            </TeksSensitif>
          </View>
          <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{item.tanggal ? tanggalPendek(item.tanggal) : ""}</Text>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} style={{ marginTop: 4 }} />
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>
              {item.metodeLabel}{item.rekening ? ` · ${item.rekening.name}` : ""}
            </Text>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>
              Dicatat {item.pencatat ? item.pencatat.name : "—"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
              {item.status !== "MENUNGGU" ? <StatusBadge label={item.statusLabel} tone={nadaStatusBayar(item.status)} /> : null}
              {item.adaBukti ? (
                <View accessible accessibilityLabel="Ada bukti pembayaran" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Paperclip size={14} color={colors.textMuted} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Bukti</Text>
                </View>
              ) : null}
              {item.adaAlokasi ? (
                <View accessible accessibilityLabel="Dialokasikan ke beberapa order" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Split size={14} color={colors.textMuted} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Alokasi</Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={{ flexShrink: 0, maxWidth: "48%", alignItems: "flex-end" }}>
            <MoneyText value={item.nominal} size="md" />
          </View>
        </View>
      </GlassCard>
    </PressableScale>
  );
}
