import React from "react";
import { Text, View } from "react-native";
import { CloudOff, LogOut, ShieldOff, TriangleAlert, WifiOff, type LucideIcon } from "lucide-react-native";
import { ErrorState, PressableScale } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { klasifikasiGalat, type JenisGalat } from "@/features/beranda/galat";

// Panel galat & banner "data lama" yang dipakai bersama Beranda dan Persetujuan.
const IKON_GALAT: Record<JenisGalat, LucideIcon> = { offline: WifiOff, sesi: LogOut, izin: ShieldOff, server: CloudOff, batas: TriangleAlert, lain: TriangleAlert };

export function GalatPenuh({ error, online, onCoba, nama = "Halaman" }: { error: unknown; online: boolean; onCoba: () => void; nama?: string }) {
  const info = klasifikasiGalat(error, online, nama);
  return (
    <ErrorState
      icon={IKON_GALAT[info.jenis]}
      tone={info.jenis === "offline" || info.jenis === "batas" ? "warning" : "danger"}
      judul={info.judul}
      isi={info.isi}
      onCoba={info.jenis === "sesi" ? undefined : onCoba}
    />
  );
}

/** Penyegaran gagal tetapi data terakhir masih ada: tetap tampilkan data, beri tahu, dan tawarkan coba lagi. */
export function BannerBasi({ error, online, onCoba }: { error: unknown; online: boolean; onCoba: () => void }) {
  const { colors } = useTheme();
  const info = klasifikasiGalat(error, online);
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.small, backgroundColor: colors.warningSoft, marginBottom: 12 }}>
      <TriangleAlert size={18} color={colors.warning} strokeWidth={1.75} />
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 13 }}>Gagal memperbarui</Text>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{info.judul}. Menampilkan data terakhir yang berhasil dimuat.</Text>
      </View>
      <PressableScale onPress={onCoba} accessibilityLabel="Coba muat ulang" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 6 }}>
        <Text style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 13 }}>Coba lagi</Text>
      </PressableScale>
    </View>
  );
}
