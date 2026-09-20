import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Search, X } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { Button, Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useTxList } from "@/hooks/transaksi";
import { useOnline } from "@/hooks/useOnline";
import { useSession } from "@/auth/session";
import { ENV } from "@/lib/env";
import { jam } from "@/lib/dates";
import { periodePreset } from "@/lib/periode";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import type { FilterTx, HalamanTx, ItemTx, ModulTx, RingkasanTx } from "@/api/types";
import { KartuTx } from "./KartuTx";
import { KONFIG, bisaBuat } from "./modul";

function useDebounce<T>(nilai: T, ms: number): T {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

/** Kartu ringkasan modul — semua angka dari server (tidak berubah saat pindah tab/pencarian). */
function Ringkasan({ modul, r }: { modul: ModulTx; r: RingkasanTx }) {
  const { colors } = useTheme();
  const baris: { label: string; nilai: NonNullable<RingkasanTx["total"]>; nada?: string }[] = [];
  if (modul === "piutang" && r.totalSemua) baris.push({ label: "Total piutang", nilai: r.totalSemua });
  if (modul === "piutang" && r.menungguVerifikasi && r.menungguVerifikasi.jumlah > 0) baris.push({ label: `Lunas di CRM, menunggu verifikasi · ${r.menungguVerifikasi.jumlah}`, nilai: r.menungguVerifikasi.total });
  if (modul === "kasbon" && r.sisaAktif) baris.push({ label: "Belum dipotong dari gaji", nilai: r.sisaAktif });
  if ((modul === "tagihan" || modul === "supplier") && r.utangTerbuka) baris.push({ label: "Utang usaha terbuka", nilai: r.utangTerbuka });
  if (modul === "tagihan" && r.lewatTempo && r.lewatTempo.jumlah > 0) baris.push({ label: `Lewat jatuh tempo · ${r.lewatTempo.jumlah}`, nilai: r.lewatTempo.total, nada: colors.danger });
  if (!["piutang", "supplier", "tagihan"].includes(modul) && r.total) baris.push({ label: "Total pada daftar ini", nilai: r.total });
  if (baris.length === 0) return null;
  return (
    <GlassCard padding={12} style={{ marginBottom: 12 }}>
      {baris.map((b) => (
        <View key={b.label} accessible accessibilityLabel={b.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: b.nada ?? colors.textMuted, fontFamily: font.regular, fontSize: 13, flexShrink: 1 }}>{b.label}</Text>
          <View style={{ flexShrink: 0, maxWidth: "55%" }}><MoneyText value={b.nilai} size="sm" /></View>
        </View>
      ))}
    </GlassCard>
  );
}

/** Rincian umur piutang (server) — hanya untuk modul Piutang. */
function UmurPiutang({ r }: { r: RingkasanTx }) {
  const { colors } = useTheme();
  const LABEL: Record<string, string> = { belum_jatuh_tempo: "Belum jatuh tempo", "1_30": "1–30 hari", "31_60": "31–60 hari", "61_90": "61–90 hari", "90_plus": "> 90 hari" };
  const ada = r.umur ? Object.entries(r.umur).filter(([, v]) => !/^0+(\.0+)?$/.test(v)) : [];
  if (ada.length === 0) return null;
  return (
    <GlassCard variant="flat" padding={12} style={{ marginBottom: 12 }}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13, marginBottom: 4 }}>Umur piutang</Text>
      {ada.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 3 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, flexShrink: 1 }}>{LABEL[k] ?? k}</Text>
          <View style={{ flexShrink: 0, maxWidth: "55%" }}><MoneyText value={v as never} size="sm" /></View>
        </View>
      ))}
    </GlassCard>
  );
}

export function DaftarTx({ modul, supplierId = null }: { modul: ModulTx; supplierId?: string | null }) {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const caps = useSession((s) => s.capabilities);
  const k = KONFIG[modul];

  const [tab, setTab] = useState<string>(k.tabs[0]?.id ?? "SEMUA");
  const [cari, setCari] = useState("");
  const q = useDebounce(cari, 400);
  const [periodeId, setPeriodeId] = useState<string | null>(null);
  const [lewatSaja, setLewatSaja] = useState(false);

  const filter = useMemo<FilterTx>(() => {
    const p = periodeId ? periodePreset().find((x) => x.id === periodeId) : null;
    return { modul, tab, q, from: p?.from ?? null, to: p?.to ?? null, supplierId, jatuhTempoLewat: modul === "tagihan" && lewatSaja };
  }, [modul, tab, q, periodeId, supplierId, lewatSaja]);

  const daftar = useTxList(filter);
  const halaman: HalamanTx[] = daftar.data?.pages ?? [];
  const items: ItemTx[] = halaman.flatMap((h) => h.items);
  const hitung = halaman[0]?.hitung;
  const ringkasan = halaman[0]?.ringkasan;
  const diperbarui = halaman[0]?.diperbaruiPada;
  const aktif = (q.trim() ? 1 : 0) + (periodeId ? 1 : 0) + (lewatSaja ? 1 : 0);
  const gerak = daftar.isPlaceholderData;
  const muatUlang = () => void daftar.refetch();
  const bukaDetail = (id: string) => router.push({ pathname: "/tx/[modul]/[id]", params: { modul, id } });
  const bolehBuat = bisaBuat(caps, modul);
  const Ikon = k.ikon;

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
          <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Transaksi</Text>
        </PressableScale>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Ikon size={22} color={colors.primary} strokeWidth={1.75} />
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, flexShrink: 1 }}>{k.label}</Text>
          </View>
          {gerak || (daftar.isFetching && !daftar.isLoading) ? <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Memuat" /> : null}
        </View>

        {ringkasan ? <Ringkasan modul={modul} r={ringkasan} /> : null}
        {modul === "piutang" && ringkasan ? <UmurPiutang r={ringkasan} /> : null}

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke }}>
            <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
            <TextInput
              value={cari} onChangeText={setCari} placeholder={k.cari} placeholderTextColor={colors.textFaint} accessibilityLabel={`Cari ${k.tunggal}`}
              returnKeyType="search" autoCorrect={false} autoCapitalize="none" maxFontSizeMultiplier={1.4}
              style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, paddingVertical: 8 }}
            />
            {cari.length > 0 ? (
              <PressableScale onPress={() => setCari("")} accessibilityLabel="Hapus pencarian" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
                <X size={18} color={colors.textMuted} strokeWidth={1.75} />
              </PressableScale>
            ) : null}
          </View>
          {bolehBuat ? (
            <PressableScale onPress={() => router.push({ pathname: "/tx/[modul]/baru", params: { modul } })} accessibilityLabel={`Tambah ${k.tunggal}`} style={{ width: 46, height: 46, borderRadius: radius.button, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary }}>
              <Plus size={22} color={colors.onPrimary} strokeWidth={2} />
            </PressableScale>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: k.periode ? 8 : 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }} accessibilityRole="tablist">
          {k.tabs.map((t) => <Chip key={t.id} label={t.label} aktif={tab === t.id} jumlah={hitung?.[t.id]} onPress={() => setTab(t.id)} />)}
        </ScrollView>
        {k.periode ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
            <Chip label="Semua waktu" aktif={periodeId == null} onPress={() => setPeriodeId(null)} />
            {periodePreset().slice(0, 4).map((p) => <Chip key={p.id} label={p.label} aktif={periodeId === p.id} onPress={() => setPeriodeId(p.id)} />)}
            {modul === "tagihan" ? <Chip label="Lewat tempo saja" aktif={lewatSaja} onPress={() => setLewatSaja((v) => !v)} /> : null}
          </ScrollView>
        ) : null}

        {daftar.isLoading && !daftar.data ? (
          <View style={{ gap: 12 }} accessibilityLabel={`Memuat daftar ${k.tunggal}`} accessibilityLiveRegion="polite">
            {[0, 1, 2].map((i) => <Skeleton key={i} tinggi={110} style={{ borderRadius: 24 }} />)}
          </View>
        ) : !daftar.data ? (
          <GalatPenuh error={daftar.error} online={online} onCoba={muatUlang} nama={`Daftar ${k.tunggal}`} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.kunci}
            renderItem={({ item }) => <KartuTx item={item} onPress={() => bukaDetail(item.id)} />}
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
                ? <EmptyState judul="Tidak ada yang cocok" isi="Ubah kata kunci atau atur ulang filter." aksi="Atur ulang" onAksi={() => { setCari(""); setPeriodeId(null); setLewatSaja(false); }} />
                : <View><EmptyState judul={k.kosong.judul} isi={k.kosong.isi} />{bolehBuat ? <Button label={`Tambah ${k.tunggal}`} icon={Plus} onPress={() => router.push({ pathname: "/tx/[modul]/baru", params: { modul } })} style={{ marginTop: 8 }} /> : null}</View>
            }
            ListFooterComponent={
              daftar.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} accessibilityLabel="Memuat halaman berikutnya" />
              : daftar.hasNextPage ? (
                <PressableScale onPress={() => void daftar.fetchNextPage()} accessibilityLabel="Muat lebih banyak" style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14 }}>Muat lebih banyak</Text>
                </PressableScale>
              ) : items.length > 0 ? (
                <Text style={{ textAlign: "center", color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginVertical: 14 }}>
                  {items.length} {k.tunggal} · sudah semua{diperbarui ? ` · diperbarui ${jam(diperbarui)} WIB` : ""}
                </Text>
              ) : null
            }
          />
        )}
      </View>
    </Screen>
  );
}
