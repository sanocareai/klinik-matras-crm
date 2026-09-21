import React, { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useBukuBesar } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ApiError } from "@/api/errors";
import { ENV } from "@/lib/env";
import { jam, tanggalPendek } from "@/lib/dates";
import { periodePreset } from "@/lib/periode";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { BarisUang, periodeBuku } from "@/features/buku/Bagian";
import type { BarisBuku } from "@/api/types";

function BarisBukuKartu({ b, onPress }: { b: BarisBuku; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`Mutasi ${b.nomor}, ${b.keterangan}. Buka jurnal`} style={{ marginBottom: 10 }}>
      <GlassCard padding={12}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11 }}>{b.nomor} · {tanggalPendek(b.tanggal)} · {b.sumberLabel}{b.status === "REVERSED" ? " · dibalik" : ""}</Text>
        <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, marginTop: 2 }}>{b.keterangan}</Text>
        {b.penanda ? <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11, marginTop: 2 }}>{b.penanda}</Text> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
          <View accessible accessibilityLabel="Debit" style={{ flexShrink: 1 }}><Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 10 }}>Debit</Text><MoneyText value={b.debit} size="sm" /></View>
          <View accessible accessibilityLabel="Kredit" style={{ flexShrink: 1, alignItems: "center" }}><Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 10 }}>Kredit</Text><MoneyText value={b.kredit} size="sm" /></View>
          <View accessible accessibilityLabel="Saldo berjalan" style={{ flexShrink: 1, alignItems: "flex-end" }}><Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 10 }}>Saldo</Text><MoneyText value={b.saldo} size="sm" autoNegatif /></View>
        </View>
      </GlassCard>
    </PressableScale>
  );
}

function BukuBesar() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { id, from: pFrom, to: pTo } = useLocalSearchParams<{ id: string; from?: string; to?: string }>();
  const awal = periodePreset()[0];
  const [rentang, setRentang] = useState({ from: typeof pFrom === "string" && pFrom ? pFrom : awal?.from ?? "", to: typeof pTo === "string" && pTo ? pTo : awal?.to ?? "" });
  const q = useBukuBesar(String(id), rentang.from, rentang.to);
  const halaman = q.data?.pages ?? [];
  const pertama = halaman[0];
  const baris = halaman.flatMap((h) => h.baris);
  const gerak = q.isPlaceholderData;
  const muatUlang = () => void q.refetch();
  const tidakAda = q.error instanceof ApiError && q.error.status === 404;
  const terakhir = halaman.at(-1);

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
          <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Buku Besar</Text>
        </PressableScale>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}

        {q.isLoading && !q.data ? (
          <View style={{ gap: 12 }} accessibilityLabel="Memuat buku besar" accessibilityLiveRegion="polite"><Skeleton tinggi={30} lebar="60%" /><Skeleton tinggi={130} style={{ borderRadius: 24 }} /><Skeleton tinggi={100} style={{ borderRadius: 24 }} /></View>
        ) : tidakAda ? (
          <EmptyState judul="Akun tidak ditemukan" aksi="Kembali" onAksi={() => router.back()} />
        ) : !pertama ? (
          <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Buku besar" />
        ) : (
          <FlatList
            data={baris} keyExtractor={(b) => b.lineId} contentContainerStyle={{ paddingBottom: 130, opacity: gerak ? 0.55 : 1 }} showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage && !gerak} onRefresh={muatUlang} tintColor={colors.primary} colors={[colors.primary]} />}
            onEndReachedThreshold={0.4} onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage(); }}
            ListHeaderComponent={(
              <View>
                {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
                <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22 }}>{pertama.akun.kode} {pertama.akun.nama}</Text>
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2, marginBottom: 10 }}>Saldo normal {pertama.akun.saldoNormal === "DEBIT" ? "debit" : "kredit"} · {pertama.periode.from} s/d {pertama.periode.to}{pertama.diperbaruiPada ? ` · diperbarui ${jam(pertama.diperbaruiPada)} WIB` : ""}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
                  {periodeBuku().map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={rentang.from === p.from && rentang.to === p.to} onPress={() => setRentang({ from: p.from, to: p.to })} />)}
                </ScrollView>
                <GlassCard style={{ marginBottom: 14 }}>
                  <BarisUang label="Saldo awal" nilai={pertama.saldoAwal} />
                  <BarisUang label="Total debit" nilai={pertama.totalDebit} />
                  <BarisUang label="Total kredit" nilai={pertama.totalKredit} />
                  <BarisUang label="Saldo akhir" nilai={(terakhir ?? pertama).saldoAkhir} tebal />
                </GlassCard>
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginBottom: 8 }}>{pertama.total} mutasi</Text>
              </View>
            )}
            ListEmptyComponent={<EmptyState judul="Tidak ada mutasi" isi="Akun ini tidak punya mutasi pada periode tersebut. Saldo awal sama dengan saldo akhir." />}
            renderItem={({ item }) => <BarisBukuKartu b={item} onPress={() => router.push({ pathname: "/buku/jurnal/[id]", params: { id: item.jurnalId } })} />}
            ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} accessibilityLabel="Memuat halaman berikutnya" />
              : q.hasNextPage ? (
                <PressableScale onPress={() => void q.fetchNextPage()} accessibilityLabel="Muat lebih banyak" style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14 }}>Muat lebih banyak</Text>
                </PressableScale>
              ) : baris.length > 0 ? <Text style={{ textAlign: "center", color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginVertical: 14 }}>{baris.length} mutasi · sudah semua</Text> : null}
          />
        )}
      </View>
    </Screen>
  );
}

export default denganAkses(BukuBesar, "financeRead");
