import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ListFilter, Search, X } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { useOpsiBayar, usePembayaranList } from "@/hooks/pembayaran";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { jam } from "@/lib/dates";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { periodeKeRentang } from "@/features/persetujuan/Sheets";
import { KartuPembayaran } from "@/features/pembayaran/KartuPembayaran";
import { DRAFT_KOSONG, FilterBayarSheet, jumlahFilterBayar, type DraftBayar } from "@/features/pembayaran/FilterBayarSheet";
import type { FilterPembayaran, PembayaranItem, RingkasanBayar, TabBayar } from "@/api/types";

const TAB: { id: TabBayar; label: string }[] = [
  { id: "MENUNGGU", label: "Menunggu verifikasi" }, { id: "TERVERIFIKASI", label: "Terverifikasi" }, { id: "DITOLAK", label: "Ditolak" },
];

const KOSONG: Record<TabBayar, { judul: string; isi: string }> = {
  MENUNGGU: { judul: "Tidak ada yang menunggu", isi: "Semua pembayaran pelanggan sudah diperiksa." },
  TERVERIFIKASI: { judul: "Belum ada yang terverifikasi", isi: "Pembayaran yang sudah diverifikasi Finance muncul di sini." },
  DITOLAK: { judul: "Belum ada yang ditolak", isi: "Pembayaran yang ditolak beserta alasannya muncul di sini." },
};

function useDebounce<T>(nilai: T, ms: number): T {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

/** Kartu ringkasan periode — dari server, TIDAK berubah saat pindah tab/pencarian. Nominal ikut tersamarkan bila "Sembunyikan nominal" aktif. */
function KartuRingkasan({ r }: { r: RingkasanBayar }) {
  const { colors } = useTheme();
  const baris = (label: string, jumlah: number, nominal: RingkasanBayar["menunggu"]["nominal"], nada: string) => (
    <View accessible accessibilityLabel={`${label}: ${jumlah} pembayaran`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: nada }} />
        <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, flexShrink: 1 }}>{label} · {jumlah}</Text>
      </View>
      <View style={{ flexShrink: 0, maxWidth: "55%" }}><MoneyText value={nominal} size="sm" /></View>
    </View>
  );
  return (
    <GlassCard padding={12} style={{ marginBottom: 12 }}>
      {baris("Menunggu verifikasi", r.menunggu.jumlah, r.menunggu.nominal, colors.warning)}
      {baris("Terverifikasi", r.terverifikasi.jumlah, r.terverifikasi.nominal, colors.success)}
      {baris("Ditolak", r.ditolak.jumlah, r.ditolak.nominal, colors.danger)}
    </GlassCard>
  );
}

function DaftarPembayaran() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();

  const [tab, setTab] = useState<TabBayar>("MENUNGGU");
  const [cari, setCari] = useState("");
  const q = useDebounce(cari, 400);
  const [draft, setDraft] = useState<DraftBayar>(DRAFT_KOSONG);
  const [filterBuka, setFilterBuka] = useState(false);

  const filter = useMemo<FilterPembayaran>(() => {
    const r = periodeKeRentang(draft.periodeId);
    return { tab, metode: draft.metode, rekeningId: draft.rekeningId, from: r.from, to: r.to, q };
  }, [tab, draft, q]);

  const daftar = usePembayaranList(filter);
  const opsi = useOpsiBayar(filterBuka);
  const halaman = daftar.data?.pages ?? [];
  const items: PembayaranItem[] = halaman.flatMap((h) => h.items);
  const hitung = halaman[0]?.hitung;
  const ringkasan = halaman[0]?.ringkasan;
  const diperbarui = halaman[0]?.diperbaruiPada;
  const aktif = jumlahFilterBayar(filter) + (q.trim() ? 1 : 0);
  const gerak = daftar.isPlaceholderData;
  const muatUlang = () => void daftar.refetch();
  const bukaDetail = (id: string) => router.push({ pathname: "/pembayaran/[id]", params: { id } });

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
          <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Transaksi</Text>
        </PressableScale>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24 }}>Pembayaran pelanggan</Text>
          {gerak || (daftar.isFetching && !daftar.isLoading) ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Memuat" /> : null}
        </View>

        {ringkasan ? <KartuRingkasan r={ringkasan} /> : null}

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke }}>
            <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
            <TextInput
              value={cari} onChangeText={setCari} placeholder="Cari order, pelanggan, nominal…" placeholderTextColor={colors.textFaint}
              accessibilityLabel="Cari pembayaran" returnKeyType="search" autoCorrect={false} autoCapitalize="none"
              style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, paddingVertical: 8 }}
            />
            {cari.length > 0 ? (
              <PressableScale onPress={() => setCari("")} accessibilityLabel="Hapus pencarian" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
                <X size={18} color={colors.textMuted} strokeWidth={1.75} />
              </PressableScale>
            ) : null}
          </View>
          <PressableScale
            onPress={() => { haptic.tick(); setFilterBuka(true); }}
            accessibilityLabel={jumlahFilterBayar(filter) > 0 ? `Filter, ${jumlahFilterBayar(filter)} aktif` : "Filter"}
            style={{ width: 46, height: 46, borderRadius: radius.button, alignItems: "center", justifyContent: "center", backgroundColor: jumlahFilterBayar(filter) > 0 ? colors.primary : colors.glassFillStrong, borderWidth: 1, borderColor: jumlahFilterBayar(filter) > 0 ? colors.primary : colors.glassStroke }}
          >
            <ListFilter size={20} color={jumlahFilterBayar(filter) > 0 ? colors.onPrimary : colors.text} strokeWidth={1.75} />
          </PressableScale>
        </View>

        {/* Satu baris yang bisa digeser: tiga tab + jumlah tidak muat di layar sempit / font besar tanpa membungkus. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }} accessibilityRole="tablist">
          {TAB.map((t) => <Chip key={t.id} label={t.label} aktif={tab === t.id} jumlah={hitung?.[t.id]} onPress={() => setTab(t.id)} />)}
        </ScrollView>

        {daftar.isLoading && !daftar.data ? (
          <View style={{ gap: 12 }} accessibilityLabel="Memuat daftar pembayaran" accessibilityLiveRegion="polite">
            {[0, 1, 2].map((i) => <Skeleton key={i} tinggi={120} style={{ borderRadius: 24 }} />)}
          </View>
        ) : !daftar.data ? (
          <GalatPenuh error={daftar.error} online={online} onCoba={muatUlang} nama="Daftar pembayaran" />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => <KartuPembayaran item={item} onPress={() => bukaDetail(item.id)} />}
            contentContainerStyle={{ paddingBottom: 130, opacity: gerak ? 0.55 : 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={<RefreshControl refreshing={daftar.isRefetching && !daftar.isFetchingNextPage && !gerak} onRefresh={muatUlang} tintColor={colors.primary} colors={[colors.primary]} />}
            onEndReachedThreshold={0.4}
            onEndReached={() => { if (daftar.hasNextPage && !daftar.isFetchingNextPage) void daftar.fetchNextPage(); }}
            ListHeaderComponent={daftar.isError ? <BannerBasi error={daftar.error} online={online} onCoba={muatUlang} /> : null}
            ListEmptyComponent={
              aktif > 0
                ? <EmptyState judul="Tidak ada yang cocok" isi="Ubah kata kunci atau atur ulang filter." aksi="Atur ulang" onAksi={() => { setCari(""); setDraft(DRAFT_KOSONG); }} />
                : <EmptyState judul={KOSONG[tab].judul} isi={KOSONG[tab].isi} />
            }
            ListFooterComponent={
              daftar.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} accessibilityLabel="Memuat halaman berikutnya" />
              : daftar.hasNextPage ? (
                <PressableScale onPress={() => void daftar.fetchNextPage()} accessibilityLabel="Muat lebih banyak" style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14 }}>Muat lebih banyak</Text>
                </PressableScale>
              ) : items.length > 0 ? (
                <Text style={{ textAlign: "center", color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginVertical: 14 }}>
                  {items.length} pembayaran · sudah semua{diperbarui ? ` · diperbarui ${jam(diperbarui)} WIB` : ""}
                </Text>
              ) : null
            }
          />
        )}
      </View>
      <FilterBayarSheet visible={filterBuka} awal={draft} opsi={opsi.data} onTutup={() => setFilterBuka(false)} onTerapkan={(d) => { setDraft(d); setFilterBuka(false); }} />
    </Screen>
  );
}

export default denganAkses(DaftarPembayaran, "financeRead");
