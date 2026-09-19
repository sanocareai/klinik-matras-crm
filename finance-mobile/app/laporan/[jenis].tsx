import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ShieldAlert, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { ErrorState, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useLaporan, BelumTersedia } from "@/hooks/data";
import { S } from "@/lib/strings";
import type { JenisLaporan } from "@/api/types";

const VALID: JenisLaporan[] = ["laba-rugi", "neraca", "arus-kas", "neraca-saldo", "umur-piutang", "umur-utang"];

export default function DetailLaporan() {
  const { colors } = useTheme();
  const router = useRouter();
  const { jenis } = useLocalSearchParams<{ jenis: string }>();
  const valid = VALID.includes(jenis as JenisLaporan);
  const { data, isLoading, isError, error, refetch } = useLaporan(valid ? (jenis as JenisLaporan) : "laba-rugi");

  return (
    <Screen refreshing={false} onRefresh={() => void refetch()}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>{S.laporan.judul}</Text>
      </PressableScale>

      {!valid ? (
        <ErrorState judul="Laporan tidak dikenal" />
      ) : isLoading ? (
        <View style={{ gap: 12 }}><Skeleton tinggi={30} lebar="60%" /><Skeleton tinggi={140} style={{ borderRadius: radius.card }} /><Skeleton tinggi={220} style={{ borderRadius: radius.card }} /></View>
      ) : isError || !data ? (
        <ErrorState
          judul={error instanceof BelumTersedia ? S.segera : "Laporan belum bisa dimuat"}
          isi={error instanceof BelumTersedia ? S.segeraIsi : error instanceof Error ? error.message : undefined}
          onCoba={error instanceof BelumTersedia ? undefined : () => void refetch()}
        />
      ) : (
        <>
          <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26 }}>{data.judul}</Text>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginTop: 2, marginBottom: 14 }}>{data.periode}</Text>

          {data.seimbang === false ? (
            <GlassCard variant="flat" style={{ marginBottom: 12, borderColor: colors.danger }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <ShieldAlert size={20} color={colors.danger} strokeWidth={1.75} />
                <Text style={{ flex: 1, color: colors.danger, fontFamily: font.semibold, fontSize: 13 }}>Laporan ini tidak seimbang. Hubungi admin untuk memeriksa jurnal.</Text>
              </View>
            </GlassCard>
          ) : null}

          <GlassCard variant="hero">
            {data.ringkasan.map((r, i) => (
              <View key={r.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "rgba(255,255,255,0.14)" }}>
                <Text style={{ color: colors.heroTextMuted, fontFamily: r.tebal ? font.semibold : font.regular, fontSize: 14 }}>{r.label}</Text>
                <MoneyText value={r.nilai} size={r.tebal ? "lg" : "md"} color={colors.heroText} />
              </View>
            ))}
          </GlassCard>

          {data.kelompok.map((k) => (
            <View key={k.judul}>
              <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16, marginTop: 22, marginBottom: 10 }}>{k.judul}</Text>
              <GlassCard padding={4}>
                {k.baris.map((b, i) => (
                  <View key={`${b.kode ?? ""}${b.nama}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{b.nama}</Text>
                      {b.kode ? <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 1 }}>{b.kode}</Text> : null}
                    </View>
                    <MoneyText value={b.nilai} size="md" autoNegatif />
                  </View>
                ))}
              </GlassCard>
            </View>
          ))}

          {data.catatan.length > 0 ? (
            <GlassCard variant="flat" style={{ marginTop: 20 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TriangleAlert size={18} color={colors.warning} strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13 }}>{S.beranda.catatan}</Text>
                  {data.catatan.map((c) => <Text key={c} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{c}</Text>)}
                </View>
              </View>
            </GlassCard>
          ) : null}
        </>
      )}
    </Screen>
  );
}
