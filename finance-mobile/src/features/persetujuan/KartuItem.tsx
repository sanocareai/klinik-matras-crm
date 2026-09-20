import React from "react";
import { Text, View } from "react-native";
import { ChevronRight, HandCoins, Paperclip, Receipt, ShoppingCart, TriangleAlert, Undo2, type LucideIcon } from "lucide-react-native";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { IconCircle, PressableScale } from "@/design/ui";
import { TeksSensitif, useSamarkan } from "@/design/Samarkan";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { formatRupiah } from "@/lib/money";
import type { ApprovalItem, JenisApproval } from "@/api/types";

export const IKON_JENIS: Record<JenisApproval, LucideIcon> = { expense: Receipt, purchase: ShoppingCart, bill: HandCoins, refund: Undo2 };

/** "Hari ini", "Kemarin", "6 hari". */
export function labelUmur(hari: number): string {
  if (hari <= 0) return "Hari ini";
  if (hari === 1) return "Kemarin";
  return `${hari} hari`;
}

const nadaStatus = (tahap: ApprovalItem["tahap"]) => (tahap === "DITOLAK" ? "danger" : tahap === "DISETUJUI" ? "success" : "info");

export function KartuItem({ item, onPress }: { item: ApprovalItem; onPress: () => void }) {
  const { colors } = useTheme();
  const samar = useSamarkan();
  const Ikon = IKON_JENIS[item.jenis];
  const lama = item.tahap === "MENUNGGU" && item.umurHari >= 5;
  const label = [
    `${item.jenisLabel} ${item.nomor}`,
    samar ? "nominal disembunyikan" : formatRupiah(item.nominal),
    item.pemohon ? `diajukan ${item.pemohon.name}` : null,
    labelUmur(item.umurHari),
    item.statusLabel,
    samar ? null : item.keterangan,
  ].filter(Boolean).join(", ");
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} style={{ marginBottom: 12 }}>
      <GlassCard padding={14}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <IconCircle icon={Ikon} tone="info" size={36} />
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12 }}>{item.jenisLabel} · {item.nomor}</Text>
            <TeksSensitif maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15, lineHeight: 20, marginTop: 1 }}>
              {item.keterangan || "(tanpa keterangan)"}
            </TeksSensitif>
          </View>
          <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: lama ? colors.warning : colors.textMuted, fontFamily: lama ? font.semibold : font.regular, fontSize: 12 }}>{labelUmur(item.umurHari)}</Text>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} style={{ marginTop: 4 }} />
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            {item.pihak || item.kategori ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {item.pihak ? <TeksSensitif maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{item.pihak}</TeksSensitif> : null}
                {item.pihak && item.kategori ? <Text style={{ color: colors.textMuted, fontSize: 12 }}> · </Text> : null}
                {item.kategori ? <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{item.kategori}</Text> : null}
              </View>
            ) : null}
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>
              Diajukan {item.pemohon ? item.pemohon.name : "—"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
              {item.tahap !== "MENUNGGU" ? <StatusBadge label={item.statusLabel} tone={nadaStatus(item.tahap)} /> : null}
              {item.adaLampiran ? (
                <View accessible accessibilityLabel="Ada lampiran" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Paperclip size={14} color={colors.textMuted} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Lampiran</Text>
                </View>
              ) : null}
              {item.syarat && item.tahap === "MENUNGGU" ? (
                <View accessible accessibilityLabel={`Perlu perhatian: ${item.syarat.pesan}`} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <TriangleAlert size={14} color={colors.warning} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12 }}>Nota belum ada</Text>
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
