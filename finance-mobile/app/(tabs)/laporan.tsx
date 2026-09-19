import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChartColumn, ChevronRight, FileSpreadsheet, ListTree, Scale, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { IconCircle, MockBanner, PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { ENV } from "@/lib/env";
import { labelBulan, periodeBulanIni } from "@/lib/dates";
import { S } from "@/lib/strings";
import type { JenisLaporan } from "@/api/types";
import { denganAkses } from "@/features/guard/RequireCapability";

const DAFTAR: { jenis: JenisLaporan; label: string; sub: string; Icon: LucideIcon }[] = [
  { jenis: "laba-rugi", label: S.laporan.labaRugi, sub: "Pendapatan, beban, dan laba periode", Icon: TrendingUp },
  { jenis: "neraca", label: S.laporan.neraca, sub: "Aset, kewajiban, dan ekuitas per tanggal", Icon: Scale },
  { jenis: "arus-kas", label: S.laporan.arusKas, sub: "Uang masuk dan keluar periode", Icon: ChartColumn },
  { jenis: "neraca-saldo", label: S.laporan.neracaSaldo, sub: "Saldo semua akun (debit = kredit)", Icon: ListTree },
  { jenis: "umur-piutang", label: S.laporan.umurPiutang, sub: "Tagihan pelanggan berdasarkan umur", Icon: FileSpreadsheet },
  { jenis: "umur-utang", label: S.laporan.umurUtang, sub: "Utang ke supplier berdasarkan umur", Icon: TrendingDown },
];

function Laporan() {
  const { colors } = useTheme();
  const router = useRouter();
  const periode = periodeBulanIni();
  return (
    <Screen>
      {ENV.useMocks ? <MockBanner /> : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26 }}>{S.laporan.judul}</Text>
      <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginTop: 4, marginBottom: 16 }}>
        {S.laporan.sub} Periode: {labelBulan(periode.from)}.
      </Text>
      <View style={{ gap: 10 }}>
        {DAFTAR.map((d) => (
          <PressableScale key={d.jenis} onPress={() => { haptic.tick(); router.push(`/laporan/${d.jenis}`); }} accessibilityLabel={d.label}>
            <GlassCard padding={14}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <IconCircle icon={d.Icon} tone="info" size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15 }}>{d.label}</Text>
                  <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{d.sub}</Text>
                </View>
                <ChevronRight size={20} color={colors.textFaint} strokeWidth={1.75} />
              </View>
            </GlassCard>
          </PressableScale>
        ))}
      </View>
    </Screen>
  );
}

export default denganAkses(Laporan, "financeRead");
