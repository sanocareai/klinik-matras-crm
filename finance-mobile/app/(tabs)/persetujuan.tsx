import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ListFilter, Search, X } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { useApprovalList, usePemohon } from "@/hooks/approvals";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { S } from "@/lib/strings";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { KartuItem } from "@/features/persetujuan/KartuItem";
import { FilterSheet, jumlahFilterAktif, periodeKeRentang, type DraftFilter } from "@/features/persetujuan/Sheets";
import type { ApprovalItem, FilterApproval, TahapApproval } from "@/api/types";

const TAB: { id: TahapApproval; label: string }[] = [
  { id: "MENUNGGU", label: "Menunggu" }, { id: "DIPROSES", label: "Diproses" }, { id: "DISETUJUI", label: "Disetujui" }, { id: "DITOLAK", label: "Ditolak" },
];

const KOSONG: Record<TahapApproval, { judul: string; isi: string }> = {
  MENUNGGU: { judul: S.persetujuan.kosongJudul, isi: S.persetujuan.kosongIsi },
  DIPROSES: { judul: "Belum ada yang diproses", isi: "Pengajuan yang sudah disetujui tetapi belum dibayar atau lunas muncul di sini." },
  DISETUJUI: { judul: "Belum ada yang disetujui", isi: "Pengajuan yang sudah disetujui dan selesai muncul di sini." },
  DITOLAK: { judul: "Belum ada yang ditolak", isi: "Pengajuan yang ditolak beserta alasannya muncul di sini." },
};

function useDebounce<T>(nilai: T, ms: number): T {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

function Persetujuan() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();

  const [tab, setTab] = useState<TahapApproval>("MENUNGGU");
  const [cari, setCari] = useState("");
  const q = useDebounce(cari, 400);
  const [draft, setDraft] = useState<DraftFilter>({ jenis: [], periodeId: null, pemohonId: null });
  const [filterBuka, setFilterBuka] = useState(false);

  const filter = useMemo<FilterApproval>(() => {
    const r = periodeKeRentang(draft.periodeId);
    return { tab, jenis: draft.jenis, from: r.from, to: r.to, pemohonId: draft.pemohonId, q };
  }, [tab, draft, q]);

  const daftar = useApprovalList(filter);
  const pemohon = usePemohon(filterBuka);
  const halaman = daftar.data?.pages ?? [];
  const items: ApprovalItem[] = halaman.flatMap((h) => h.items);
  const hitung = halaman[0]?.hitung;
  const aktif = jumlahFilterAktif(filter) + (q.trim() ? 1 : 0);
  const gerak = daftar.isPlaceholderData;
  const muatUlang = () => void daftar.refetch();

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24 }}>{S.persetujuan.judul}</Text>
          {gerak || (daftar.isFetching && !daftar.isLoading) ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Memuat" /> : null}
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke }}>
            <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
            <TextInput
              value={cari} onChangeText={setCari} placeholder="Cari nomor, vendor, nominal…" placeholderTextColor={colors.textFaint}
              accessibilityLabel="Cari pengajuan" returnKeyType="search" autoCorrect={false} autoCapitalize="none"
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
            accessibilityLabel={jumlahFilterAktif(filter) > 0 ? `Filter, ${jumlahFilterAktif(filter)} aktif` : "Filter"}
            style={{ width: 46, height: 46, borderRadius: radius.button, alignItems: "center", justifyContent: "center", backgroundColor: jumlahFilterAktif(filter) > 0 ? colors.primary : colors.glassFillStrong, borderWidth: 1, borderColor: jumlahFilterAktif(filter) > 0 ? colors.primary : colors.glassStroke }}
          >
            <ListFilter size={20} color={jumlahFilterAktif(filter) > 0 ? colors.onPrimary : colors.text} strokeWidth={1.75} />
          </PressableScale>
        </View>

        {/* Satu baris yang bisa digeser: empat tab + jumlah tidak muat di layar sempit / font besar tanpa membungkus. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }} accessibilityRole="tablist">
          {TAB.map((t) => (
            <Chip key={t.id} label={t.label} aktif={tab === t.id} jumlah={hitung?.[t.id]} onPress={() => setTab(t.id)} />
          ))}
        </ScrollView>

        {daftar.isLoading && !daftar.data ? (
          <View style={{ gap: 12 }} accessibilityLabel="Memuat daftar persetujuan" accessibilityLiveRegion="polite">
            {[0, 1, 2].map((i) => <Skeleton key={i} tinggi={128} style={{ borderRadius: 24 }} />)}
          </View>
        ) : !daftar.data ? (
          <GalatPenuh error={daftar.error} online={online} onCoba={muatUlang} nama="Daftar persetujuan" />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.kunci}
            renderItem={({ item }) => <KartuItem item={item} onPress={() => router.push({ pathname: "/persetujuan/[jenis]/[id]", params: { jenis: item.jenis, id: item.id } })} />}
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
                ? <EmptyState judul="Tidak ada yang cocok" isi="Ubah kata kunci atau atur ulang filter." aksi="Atur ulang" onAksi={() => { setCari(""); setDraft({ jenis: [], periodeId: null, pemohonId: null }); }} />
                : <EmptyState judul={KOSONG[tab].judul} isi={KOSONG[tab].isi} />
            }
            ListFooterComponent={
              daftar.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} accessibilityLabel="Memuat halaman berikutnya" />
              : daftar.hasNextPage ? (
                <PressableScale onPress={() => void daftar.fetchNextPage()} accessibilityLabel="Muat lebih banyak" style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14 }}>Muat lebih banyak</Text>
                </PressableScale>
              ) : items.length > 0 ? <Text style={{ textAlign: "center", color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginVertical: 14 }}>{daftar.data.pages[0]?.total ?? items.length} pengajuan · sudah semua</Text> : null
            }
          />
        )}
      </View>
      <FilterSheet
        visible={filterBuka} awal={draft} pemohon={pemohon.data ?? []} onTutup={() => setFilterBuka(false)}
        onTerapkan={(d) => { setDraft(d); setFilterBuka(false); }}
      />
    </Screen>
  );
}

export default denganAkses(Persetujuan, "financeApprove");
