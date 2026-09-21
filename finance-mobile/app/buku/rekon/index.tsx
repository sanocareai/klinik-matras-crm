import React from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { StatusBadge } from "@/design/StatusBadge";
import { EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useRekonList } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { BarisUang } from "@/features/buku/Bagian";
import type { RekonItem } from "@/api/types";

function KartuRekon({ r, onPress }: { r: RekonItem; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`Rekonsiliasi ${r.rekening.name}, ${r.periode.from} sampai ${r.periode.to}, ${r.statusLabel}, ${r.belumCocok} belum cocok. Buka`} style={{ marginBottom: 12 }}>
      <GlassCard>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 15 }}>{r.rekening.name}</Text>
          <StatusBadge label={r.statusLabel} tone={r.nada} />
        </View>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2, marginBottom: 6 }}>{r.periode.from} s/d {r.periode.to} · {r.belumCocok} belum cocok · {r.cocokBaris} cocok</Text>
        <BarisUang label="Saldo buku" nilai={r.saldoBuku} />
        <BarisUang label="Saldo statement" nilai={r.saldoKoran} />
        <BarisUang label={r.cocok ? "Selisih (cocok)" : "Selisih"} nilai={r.selisih} tebal warna={r.cocok ? colors.success : colors.danger} />
      </GlassCard>
    </PressableScale>
  );
}

function DaftarRekon() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const q = useRekonList();
  const muatUlang = () => void q.refetch();
  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
          <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Kembali</Text>
        </PressableScale>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, marginBottom: 4 }}>Rekonsiliasi Bank</Text>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 12 }}>Impor statement, pembuatan rekonsiliasi, dan penutupan tetap di web.</Text>
        {q.isLoading && !q.data ? (
          <View style={{ gap: 12 }} accessibilityLabel="Memuat rekonsiliasi">{[0, 1].map((i) => <Skeleton key={i} tinggi={150} style={{ borderRadius: 24 }} />)}</View>
        ) : !q.data ? (
          <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Rekonsiliasi" />
        ) : (
          <FlatList
            data={q.data} keyExtractor={(r) => r.id} contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={muatUlang} tintColor={colors.primary} colors={[colors.primary]} />}
            ListHeaderComponent={q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
            ListEmptyComponent={<EmptyState judul="Belum ada rekonsiliasi" isi="Rekonsiliasi dibuat dari web setelah statement bank diimpor." />}
            renderItem={({ item }) => <KartuRekon r={item} onPress={() => router.push({ pathname: "/buku/rekon/[id]", params: { id: item.id } })} />}
          />
        )}
      </View>
    </Screen>
  );
}

export default denganAkses(DaftarRekon, "financeRead");
