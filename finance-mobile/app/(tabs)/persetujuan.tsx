import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Paperclip, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Chip, EmptyState, ErrorState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useApprovals, BelumTersedia } from "@/hooks/data";
import { useOnline } from "@/hooks/useOnline";
import { haptic } from "@/design/haptics";
import { ENV } from "@/lib/env";
import { tanggalPendek } from "@/lib/dates";
import { S } from "@/lib/strings";
import type { JenisApproval } from "@/api/types";

const JENIS: (JenisApproval | "semua")[] = ["semua", "expense", "purchase", "bill", "refund"];

export default function Persetujuan() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const [jenis, setJenis] = useState<JenisApproval | "semua">("semua");
  const { data, isLoading, isError, error, refetch, isRefetching } = useApprovals();

  // Terlama dulu (yang paling lama menunggu diputuskan lebih dulu).
  const tampil = useMemo(
    () => [...(data ?? [])].filter((a) => jenis === "semua" || a.jenis === jenis).sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [data, jenis],
  );
  const hitung = (j: JenisApproval | "semua") => (data ?? []).filter((a) => j === "semua" || a.jenis === j).length;

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26, marginBottom: 4 }}>{S.persetujuan.judul}</Text>
      <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginBottom: 8 }}>Yang paling lama menunggu ada di atas.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
        {JENIS.map((j) => (
          <Chip key={j} label={j === "semua" ? S.persetujuan.semua : (S.persetujuan.jenis[j] ?? j)} aktif={jenis === j} jumlah={hitung(j)} onPress={() => setJenis(j)} />
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={{ gap: 10, marginTop: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} tinggi={112} style={{ borderRadius: radius.card }} />)}</View>
      ) : isError ? (
        <ErrorState
          judul={error instanceof BelumTersedia ? S.segera : "Persetujuan belum bisa dimuat"}
          isi={error instanceof BelumTersedia ? S.segeraIsi : error instanceof Error ? error.message : undefined}
          onCoba={error instanceof BelumTersedia ? undefined : () => void refetch()}
        />
      ) : tampil.length === 0 ? (
        <EmptyState judul={S.persetujuan.kosongJudul} isi={S.persetujuan.kosongIsi} />
      ) : (
        <View style={{ gap: 10, marginTop: 8 }}>
          {tampil.map((a) => (
            <PressableScale key={a.id} onPress={() => { haptic.tick(); router.push(`/persetujuan/${a.id}`); }} accessibilityLabel={`${a.nomor}, ${a.keterangan}`}>
              <GlassCard padding={14}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 12 }}>{S.persetujuan.jenis[a.jenis] ?? a.jenis} · {a.nomor}</Text>
                    <Text numberOfLines={2} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15, lineHeight: 20, marginTop: 4 }}>{a.keterangan}</Text>
                    <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>
                      Diajukan {a.diajukanOleh} · {tanggalPendek(a.tanggal)}
                    </Text>
                  </View>
                  <MoneyText value={a.amount} size="md" />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <StatusBadge status="MENUNGGU_APPROVAL" />
                  {a.adaBukti ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Paperclip size={14} color={colors.textMuted} strokeWidth={1.75} />
                      <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Ada bukti</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <TriangleAlert size={14} color={colors.warning} strokeWidth={1.75} />
                      <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12 }}>Belum ada bukti</Text>
                    </View>
                  )}
                  {!a.bolehDisetujuiSaya ? <StatusBadge label="Pengajuan Anda" tone="neutral" /> : null}
                </View>
              </GlassCard>
            </PressableScale>
          ))}
        </View>
      )}
    </Screen>
  );
}
