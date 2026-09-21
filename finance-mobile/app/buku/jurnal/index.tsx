import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, Search, X } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useJurnalList } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { jam, tanggalPendek } from "@/lib/dates";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { IndikatorSeimbang, KartuPeringatan, periodeBuku } from "@/features/buku/Bagian";
import type { FilterJurnal, JurnalItem } from "@/api/types";

const SUMBER = [
  { id: null, label: "Semua sumber" }, { id: "PENGELUARAN", label: "Pengeluaran" }, { id: "PEMBELIAN", label: "Pembelian" }, { id: "PEMBAYARAN_ORDER", label: "Pembayaran order" },
  { id: "KASBON", label: "Kasbon" }, { id: "PEMASUKAN_LAIN", label: "Pemasukan lain" }, { id: "TAGIHAN_SUPPLIER", label: "Tagihan supplier" }, { id: "PEMBAYARAN_SUPPLIER", label: "Pembayaran supplier" },
  { id: "REFUND", label: "Refund" }, { id: "REVERSAL", label: "Jurnal balik" }, { id: "MANUAL", label: "Manual" }, { id: "SALDO_AWAL", label: "Saldo awal" },
] as const;
const STATUS = [{ id: null, label: "Semua status" }, { id: "POSTED", label: "Terposting" }, { id: "REVERSED", label: "Sudah dibalik" }] as const;

function useDebounce<T>(nilai: T, ms: number): T {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

function KartuJurnal({ j, onPress }: { j: JurnalItem; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`Jurnal ${j.nomor}, ${j.keterangan}, ${j.statusLabel}, ${j.seimbang ? "seimbang" : "TIDAK seimbang"}`} style={{ marginBottom: 12 }}>
      <GlassCard padding={14}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11 }}>{j.nomor} · {tanggalPendek(j.tanggal)}</Text>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14, lineHeight: 19, marginTop: 2 }}>{j.keterangan}</Text>
          </View>
          <View style={{ flexShrink: 0, maxWidth: "46%", alignItems: "flex-end" }}>
            <MoneyText value={j.totalDebit} size="md" />
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 1 }}>Total debit</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <StatusBadge label={j.sumberLabel} tone="info" />
          <StatusBadge label={j.statusLabel} tone={j.nada} />
          <IndikatorSeimbang seimbang={j.seimbang} selisih={j.selisih} />
        </View>
        {j.membalik || j.dibalikOleh ? (
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>
            {j.membalik ? `Membalik ${j.membalik.nomor}` : `Dibalik oleh ${j.dibalikOleh?.nomor}`}
          </Text>
        ) : null}
      </GlassCard>
    </PressableScale>
  );
}

function DaftarJurnal() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const [cari, setCari] = useState("");
  const q = useDebounce(cari, 400);
  const [periodeId, setPeriodeId] = useState<string | null>(null);
  const [sumber, setSumber] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const filter = useMemo<FilterJurnal>(() => {
    const p = periodeId ? periodeBuku().find((x) => x.id === periodeId) : null;
    return { from: p?.from ?? null, to: p?.to ?? null, q, source: sumber, status, akunId: null };
  }, [q, periodeId, sumber, status]);
  const daftar = useJurnalList(filter);
  const halaman = daftar.data?.pages ?? [];
  const items = halaman.flatMap((h) => h.items);
  const pertama = halaman[0];
  const aktif = (q.trim() ? 1 : 0) + (periodeId ? 1 : 0) + (sumber ? 1 : 0) + (status ? 1 : 0);
  const gerak = daftar.isPlaceholderData;
  const muatUlang = () => void daftar.refetch();

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
          <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Kembali</Text>
        </PressableScale>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24 }}>Jurnal</Text>
          {gerak || (daftar.isFetching && !daftar.isLoading) ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Memuat" /> : null}
        </View>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 10 }}>Hanya baca. Jurnal manual, pembalikan, dan koreksi ada di web.</Text>
        {pertama && pertama.tidakSeimbang > 0 ? <KartuPeringatan judul={`${pertama.tidakSeimbang} jurnal tidak seimbang`} isi="Keadaan darurat: total debit ≠ kredit pada periode ini. Hubungi admin; perbaikannya hanya di web." /> : null}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke, marginBottom: 10 }}>
          <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
          <TextInput value={cari} onChangeText={setCari} placeholder="Cari nomor, keterangan, nominal…" placeholderTextColor={colors.textFaint} accessibilityLabel="Cari jurnal" returnKeyType="search" autoCorrect={false} autoCapitalize="none" maxFontSizeMultiplier={1.4}
            style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, paddingVertical: 8 }} />
          {cari.length > 0 ? <PressableScale onPress={() => setCari("")} accessibilityLabel="Hapus pencarian" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><X size={18} color={colors.textMuted} strokeWidth={1.75} /></PressableScale> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 8 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          <Chip label="Semua waktu" aktif={periodeId == null} onPress={() => setPeriodeId(null)} />
          {periodeBuku().map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={periodeId === p.id} onPress={() => setPeriodeId(p.id)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 8 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {STATUS.map((s) => <Chip key={s.label} label={s.label} aktif={status === s.id} jumlah={s.id ? pertama?.hitung[s.id] : undefined} onPress={() => setStatus(s.id)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {SUMBER.map((s) => <Chip key={s.label} label={s.label} aktif={sumber === s.id} onPress={() => setSumber(s.id)} />)}
        </ScrollView>

        {daftar.isLoading && !daftar.data ? (
          <View style={{ gap: 12 }} accessibilityLabel="Memuat daftar jurnal" accessibilityLiveRegion="polite">{[0, 1, 2].map((i) => <Skeleton key={i} tinggi={110} style={{ borderRadius: 24 }} />)}</View>
        ) : !daftar.data ? (
          <GalatPenuh error={daftar.error} online={online} onCoba={muatUlang} nama="Daftar jurnal" />
        ) : (
          <FlatList
            data={items} keyExtractor={(i) => i.id} renderItem={({ item }) => <KartuJurnal j={item} onPress={() => router.push({ pathname: "/buku/jurnal/[id]", params: { id: item.id } })} />}
            contentContainerStyle={{ paddingBottom: 130, opacity: gerak ? 0.55 : 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            refreshControl={<RefreshControl refreshing={daftar.isRefetching && !daftar.isFetchingNextPage && !gerak} onRefresh={muatUlang} tintColor={colors.primary} colors={[colors.primary]} />}
            onEndReachedThreshold={0.4} onEndReached={() => { if (daftar.hasNextPage && !daftar.isFetchingNextPage) void daftar.fetchNextPage(); }}
            ListHeaderComponent={daftar.isError ? <BannerBasi error={daftar.error} online={online} onCoba={muatUlang} /> : null}
            ListEmptyComponent={aktif > 0
              ? <EmptyState judul="Tidak ada yang cocok" isi="Ubah kata kunci atau atur ulang filter." aksi="Atur ulang" onAksi={() => { setCari(""); setPeriodeId(null); setSumber(null); setStatus(null); }} />
              : <EmptyState judul="Belum ada jurnal" isi="Jurnal yang terbukukan muncul di sini." />}
            ListFooterComponent={daftar.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} accessibilityLabel="Memuat halaman berikutnya" />
              : daftar.hasNextPage ? (
                <PressableScale onPress={() => void daftar.fetchNextPage()} accessibilityLabel="Muat lebih banyak" style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14 }}>Muat lebih banyak</Text>
                </PressableScale>
              ) : items.length > 0 ? (
                <Text style={{ textAlign: "center", color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginVertical: 14 }}>{items.length} jurnal · sudah semua{pertama?.diperbaruiPada ? ` · diperbarui ${jam(pertama.diperbaruiPada)} WIB` : ""}</Text>
              ) : null}
          />
        )}
      </View>
    </Screen>
  );
}

export default denganAkses(DaftarJurnal, "financeRead");
