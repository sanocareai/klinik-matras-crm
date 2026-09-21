import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, Search, X } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { Sheet } from "@/design/Sheet";
import { StatusBadge } from "@/design/StatusBadge";
import { TeksSensitif } from "@/design/Samarkan";
import { Button, Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useDaftarPemasukan, useRingkasanPemasukan } from "@/hooks/pemasukan";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { jam, tanggalPendek } from "@/lib/dates";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { BarisTeks, KartuPeringatan, periodeBuku } from "@/features/buku/Bagian";
import { LABEL_KATEGORI, type BarisPemasukan, type KategoriPemasukan, type RingkasanPemasukan } from "@/api/pemasukan";

// PEMASUKAN (v1.1.0) — agregator BACA-SAJA. Klasifikasi & total dari server; klien tidak menghitung uang. Impor "Data Sebelum Sistem", rekonsiliasi, dan posting hanya di web.

type TabId = "ringkasan" | "pendapatan" | "pembayaran" | "lain" | "dana" | "historis" | "ditinjau";
const TAB: { id: TabId; label: string; kategori: KategoriPemasukan | null }[] = [
  { id: "ringkasan", label: "Ringkasan", kategori: null }, { id: "pendapatan", label: "Pendapatan Penjualan", kategori: "PENDAPATAN" }, { id: "pembayaran", label: "Pembayaran Masuk", kategori: "PEMBAYARAN" },
  { id: "lain", label: "Pemasukan Lain", kategori: "LAIN" }, { id: "dana", label: "Dana Masuk Bukan Pendapatan", kategori: "DANA" }, { id: "historis", label: "Data Sebelum Sistem", kategori: "HISTORIS" },
];
const TAB_TINJAU = { id: "ditinjau" as TabId, label: "Perlu Ditinjau", kategori: "DITINJAU" as KategoriPemasukan };

function useDebounce<T>(nilai: T, ms: number): T {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

function Angka({ label, nilai, sub, onPress, info }: { label: string; nilai: React.ReactNode; sub?: string; onPress?: () => void; info?: string }) {
  const { colors } = useTheme();
  const isi = (
    <GlassCard padding={14}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12 }}>{label}</Text>
      <View style={{ marginTop: 4 }}>{nilai}</View>
      {sub ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 4 }}>{sub}</Text> : null}
      {info ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 4, lineHeight: 15 }}>{info}</Text> : null}
    </GlassCard>
  );
  return onPress ? <PressableScale onPress={onPress} accessibilityLabel={`${label}. Buka daftar`} style={{ marginBottom: 10 }}>{isi}</PressableScale> : <View style={{ marginBottom: 10 }}>{isi}</View>;
}

function TabRingkasan({ r, ke }: { r: RingkasanPemasukan; ke: (t: TabId) => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <KartuPeringatan nada="warning" judul="Pendapatan ≠ uang masuk" isi="Pendapatan = penjualan yang sudah diakui (belum tentu dibayar). Uang masuk = pembayaran yang benar-benar diterima. Keduanya tidak dijumlahkan karena akan menghitung penjualan yang sama dua kali." />
      <Angka label="Pendapatan dari sistem" nilai={<MoneyText value={r.pendapatanSistem.nilai} size="lg" autoNegatif />} sub={`${r.pendapatanSistem.jumlah} pengakuan · retur/potongan`} onPress={() => ke("pendapatan")} />
      <Angka label="Pendapatan historis (sebelum sistem)" nilai={<MoneyText value={r.pendapatanHistoris.nilai} size="lg" autoNegatif />} sub={`${r.pendapatanHistoris.jumlah} baris · ${r.pendapatanHistoris.perluDitinjau.jumlah} perlu ditinjau`} onPress={() => ke("historis")} info={r.labelHistoris} />
      <Angka label="Total pendapatan gabungan" nilai={<MoneyText value={r.pendapatanGabungan.nilai} size="lg" autoNegatif />} sub="Sistem + historis (setelah deduplikasi)" info="Tidak ditambah dengan pembayaran masuk." />
      <Angka label="Pembayaran masuk terverifikasi" nilai={<MoneyText value={r.pembayaranMasuk.terverifikasi.nilai} size="lg" autoNegatif />} sub={`${r.pembayaranMasuk.terverifikasi.jumlah} pembayaran · menunggu verifikasi ${r.pembayaranMasuk.menunggu.jumlah}`} onPress={() => ke("pembayaran")} />
      <Angka label="Piutang masih tersisa" nilai={<MoneyText value={r.piutangTersisa.nilai} size="lg" autoNegatif />} sub={`${r.piutangTersisa.jumlahOrder} order${r.piutangTersisa.perTanggal ? ` · per ${tanggalPendek(r.piutangTersisa.perTanggal)}` : ""}`} />
      <Angka label="Pemasukan lain" nilai={<MoneyText value={r.pemasukanLain.nilai} size="lg" autoNegatif />} sub={`${r.pemasukanLain.jumlah} catatan`} onPress={() => ke("lain")} />
      <Angka label="Dana masuk bukan pendapatan" nilai={<MoneyText value={r.danaMasukBukanPendapatan.nilai} size="lg" autoNegatif />} sub={`${r.danaMasukBukanPendapatan.jumlah} catatan · modal & pinjaman/pendanaan pihak ketiga`} onPress={() => ke("dana")} />
      {r.danaMasukBukanPendapatan.rincian.length > 0 ? (
        <GlassCard style={{ marginBottom: 10 }}>{r.danaMasukBukanPendapatan.rincian.map((x) => <View key={x.sub} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 4 }}><Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{x.label} ({x.jumlah})</Text><MoneyText value={x.nilai} size="sm" autoNegatif /></View>)}</GlassCard>
      ) : null}
      {r.perluDitinjau.jumlah > 0 || r.pembayaranMasuk.belumDibukukan.jumlah > 0 ? (
        <PressableScale onPress={() => ke("ditinjau")} accessibilityLabel={`Perlu ditinjau, ${r.perluDitinjau.jumlah} baris. Buka daftar`} style={{ marginBottom: 10 }}>
          <KartuPeringatan judul={`Perlu ditinjau: ${r.perluDitinjau.jumlah} baris`} isi={`Tidak dihitung ke kategori mana pun sampai ditinjau.${r.pembayaranMasuk.belumDibukukan.jumlah > 0 ? ` ${r.pembayaranMasuk.belumDibukukan.jumlah} pembayaran terverifikasi belum masuk buku besar (rekening belum dipetakan).` : ""}`} />
        </PressableScale>
      ) : null}
      <GlassCard style={{ marginBottom: 10 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13, marginBottom: 4 }}>Dikecualikan (bukan pemasukan)</Text>
        {([["Transfer antar-rekening", r.dikecualikan.transfer], ["Saldo awal / koreksi saldo", r.dikecualikan.saldoAwal], ["Pembalikan pengeluaran", r.dikecualikan.pembalikanBiaya]] as const).map(([l, x]) => (
          <View key={l} style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, paddingVertical: 4 }}><Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{l} ({x.jumlah})</Text><MoneyText value={x.nilai} size="sm" autoNegatif /></View>
        ))}
      </GlassCard>
      {r.cutoff.celah ? (
        <KartuPeringatan nada="warning" judul="Celah pengakuan pendapatan (informasi)" isi={`Cutoff sistem ${r.cutoff.tanggal ? tanggalPendek(r.cutoff.tanggal) : ""}. ${r.cutoff.celah.jumlahOrder} order sistem (${tanggalPendek(r.cutoff.celah.dari)}–${tanggalPendek(r.cutoff.celah.sampai)}) belum punya pengakuan pendapatan di buku. Tidak dijumlahkan ke pendapatan gabungan.`} />
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 4 }}>{r.labelHistoris} Impor Data Sebelum Sistem, rekonsiliasi, dan posting dilakukan di web.</Text>
    </View>
  );
}

function KartuBaris({ b, onPress }: { b: BarisPemasukan; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={`${b.nomor}, ${b.kategoriLabel}, ${b.statusLabel}. Buka rincian`} style={{ marginBottom: 10 }}>
      <GlassCard padding={12}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ flexShrink: 1, color: colors.textFaint, fontFamily: font.regular, fontSize: 11 }}>{tanggalPendek(b.tanggal)} · {b.nomor}</Text>
          <StatusBadge label={b.statusLabel} tone={b.nada} />
        </View>
        <TeksSensitif numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, marginTop: 4 }}>{b.pihak ? `${b.pihak} · ` : ""}{b.keterangan}</TeksSensitif>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11, marginTop: 2 }}>{b.sumberLabel} · {b.rekening ?? "rekening —"}</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
          <View style={{ flexShrink: 1 }}><Text maxFontSizeMultiplier={1.3} style={{ color: colors.primary, fontFamily: font.medium, fontSize: 11 }}>{b.subLabel || b.kategoriLabel}</Text>{b.perluTinjau ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.semibold, fontSize: 11 }}>Perlu ditinjau</Text> : null}</View>
          <View style={{ maxWidth: "55%", flexShrink: 0 }}><MoneyText value={b.nilai} size="md" autoNegatif /></View>
        </View>
      </GlassCard>
    </PressableScale>
  );
}

function Pemasukan() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const [periodeId, setPeriodeId] = useState<string>("tahun-ini");
  const [tab, setTab] = useState<TabId>("ringkasan");
  const [cari, setCari] = useState("");
  const q = useDebounce(cari, 350);
  const [buka, setBuka] = useState<BarisPemasukan | null>(null);
  const periode = periodeBuku().find((p) => p.id === periodeId) ?? (periodeBuku()[0] as NonNullable<ReturnType<typeof periodeBuku>[number]>);
  const aktifTab = tab === "ditinjau" ? TAB_TINJAU : (TAB.find((t) => t.id === tab) ?? (TAB[0] as (typeof TAB)[number]));
  const ringkasan = useRingkasanPemasukan(periode.from, periode.to, tab === "ringkasan");
  const daftar = useDaftarPemasukan({ from: periode.from, to: periode.to, kategori: aktifTab.kategori, q }, tab !== "ringkasan");
  const items = daftar.data?.pages.flatMap((p) => p.items) ?? [];
  const pertama = daftar.data?.pages[0];
  const gerak = daftar.isPlaceholderData;
  const muatUlang = () => void (tab === "ringkasan" ? ringkasan.refetch() : daftar.refetch());

  function bukaTautan(b: BarisPemasukan, ke: "jurnal" | "pembayaran" | "dokumen") {
    setBuka(null);
    if (ke === "jurnal" && b.tautan.jurnal) router.push({ pathname: "/buku/jurnal/[id]", params: { id: b.tautan.jurnal.id } });
    else if (ke === "pembayaran" && b.tautan.pembayaran) router.push({ pathname: "/pembayaran/[id]", params: { id: b.tautan.pembayaran.id } });
    else if (ke === "dokumen" && b.tautan.dokumen?.modul === "pemasukan") router.push({ pathname: "/tx/[modul]/[id]", params: { modul: "pemasukan", id: b.tautan.dokumen.id } });
  }

  const header = (
    <View>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Kembali</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, marginBottom: 4 }}>Pemasukan</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 10 }}>Hanya baca. Dihitung server; tidak membuat transaksi atau jurnal.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 8 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {periodeBuku().map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={periodeId === p.id} onPress={() => setPeriodeId(p.id)} />)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 10 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
        {[...TAB, ...(tab === "ditinjau" ? [TAB_TINJAU] : [])].map((t) => <Chip key={t.id} label={t.label} aktif={tab === t.id} onPress={() => { setTab(t.id); setCari(""); }} />)}
      </ScrollView>
      {tab !== "ringkasan" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke, marginBottom: 10 }}>
          <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
          <TextInput value={cari} onChangeText={setCari} placeholder="Cari nomor, pelanggan, keterangan…" placeholderTextColor={colors.textFaint} accessibilityLabel="Cari pemasukan" autoCorrect={false} autoCapitalize="none" maxFontSizeMultiplier={1.4} style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, paddingVertical: 8 }} />
          {cari.length > 0 ? <PressableScale onPress={() => setCari("")} accessibilityLabel="Hapus pencarian" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><X size={18} color={colors.textMuted} strokeWidth={1.75} /></PressableScale> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        {tab === "ringkasan" ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }} refreshControl={<RefreshControl refreshing={ringkasan.isRefetching} onRefresh={muatUlang} tintColor={colors.primary} colors={[colors.primary]} />}>
            {header}
            {ringkasan.isLoading && !ringkasan.data ? (
              <View style={{ gap: 12 }} accessibilityLabel="Memuat ringkasan pemasukan" accessibilityLiveRegion="polite">{[0, 1, 2].map((i) => <Skeleton key={i} tinggi={100} style={{ borderRadius: 24 }} />)}</View>
            ) : !ringkasan.data ? (
              <GalatPenuh error={ringkasan.error} online={online} onCoba={muatUlang} nama="Ringkasan pemasukan" />
            ) : (
              <View style={{ opacity: ringkasan.isPlaceholderData ? 0.55 : 1 }}>
                {ringkasan.isError ? <BannerBasi error={ringkasan.error} online={online} onCoba={muatUlang} /> : null}
                {ringkasan.data.terpotong ? <KartuPeringatan nada="warning" judul="Data dipotong server" isi="Periode terlalu besar; persempit periode." /> : null}
                <TabRingkasan r={ringkasan.data} ke={setTab} />
              </View>
            )}
          </ScrollView>
        ) : daftar.isLoading && !daftar.data ? (
          <View>{header}<View style={{ gap: 12 }} accessibilityLabel="Memuat daftar pemasukan" accessibilityLiveRegion="polite">{[0, 1, 2].map((i) => <Skeleton key={i} tinggi={110} style={{ borderRadius: 24 }} />)}</View></View>
        ) : !daftar.data ? (
          <View>{header}<GalatPenuh error={daftar.error} online={online} onCoba={muatUlang} nama="Daftar pemasukan" /></View>
        ) : (
          <FlatList
            data={items} keyExtractor={(b) => b.key} renderItem={({ item }) => <KartuBaris b={item} onPress={() => setBuka(item)} />}
            contentContainerStyle={{ paddingBottom: 130, opacity: gerak ? 0.55 : 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
            initialNumToRender={8} windowSize={7} removeClippedSubviews
            refreshControl={<RefreshControl refreshing={daftar.isRefetching && !daftar.isFetchingNextPage && !gerak} onRefresh={muatUlang} tintColor={colors.primary} colors={[colors.primary]} />}
            onEndReachedThreshold={0.4} onEndReached={() => { if (daftar.hasNextPage && !daftar.isFetchingNextPage) void daftar.fetchNextPage(); }}
            ListHeaderComponent={<View>{header}{daftar.isError ? <BannerBasi error={daftar.error} online={online} onCoba={muatUlang} /> : null}{tab === "historis" ? <KartuPeringatan nada="warning" judul="Data sebelum sistem" isi="Berasal dari arsip lama dan belum memengaruhi buku besar sampai rekonsiliasi dan posting disetujui. Impor dan rekonsiliasi hanya di web." /> : null}</View>}
            ListEmptyComponent={<EmptyState judul={tab === "historis" ? "Belum ada data arsip" : "Tidak ada data"} isi={tab === "historis" ? "Arsip diimpor lewat web (Finance → Pemasukan → Data Sebelum Sistem)." : q ? "Ubah kata kunci pencarian." : "Tidak ada pemasukan pada periode ini."} />}
            ListFooterComponent={daftar.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} accessibilityLabel="Memuat halaman berikutnya" />
              : daftar.hasNextPage ? (
                <PressableScale onPress={() => void daftar.fetchNextPage()} accessibilityLabel="Muat lebih banyak" style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}><Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14 }}>Muat lebih banyak</Text></PressableScale>
              ) : items.length > 0 ? <Text style={{ textAlign: "center", color: colors.textFaint, fontFamily: font.regular, fontSize: 12, marginVertical: 14 }}>{pertama?.total ?? items.length} baris · sudah semua{pertama?.diperbaruiPada ? ` · diperbarui ${jam(pertama.diperbaruiPada)} WIB` : ""}</Text> : null}
          />
        )}
      </View>

      <Sheet visible={!!buka} onClose={() => setBuka(null)} judul={buka?.nomor ?? ""} sub={buka ? `${LABEL_KATEGORI[buka.kategori]} · ${buka.statusLabel}` : undefined}>
        {buka ? (
          <View>
            <BarisTeks label="Tanggal" isi={tanggalPendek(buka.tanggal)} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 7 }}><Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Nilai</Text><View style={{ maxWidth: "60%" }}><MoneyText value={buka.nilai} size="sm" autoNegatif /></View></View>
            <BarisTeks label="Sumber" isi={buka.sumberLabel} />
            <BarisTeks label="Pihak" isi={buka.pihak ?? "—"} />
            <BarisTeks label="Rekening" isi={buka.rekening ?? "—"} />
            <BarisTeks label="Klasifikasi" isi={`${buka.kategoriLabel}${buka.subLabel ? ` — ${buka.subLabel}` : ""}`} />
            {buka.catatan ? <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12, marginVertical: 6 }}>{buka.catatan}</Text> : null}
            {buka.tautan.invoice ? <BarisTeks label="Invoice" isi={buka.tautan.invoice.nomor} /> : null}
            <View style={{ gap: 8, marginTop: 10 }}>
              {buka.tautan.jurnal ? <Button label={`Buka jurnal ${buka.tautan.jurnal.nomor}`} variant="secondary" onPress={() => bukaTautan(buka, "jurnal")} /> : null}
              {buka.tautan.pembayaran ? <Button label="Buka pembayaran" variant="secondary" onPress={() => bukaTautan(buka, "pembayaran")} /> : null}
              {buka.tautan.dokumen?.modul === "pemasukan" ? <Button label="Buka Pemasukan Lain" variant="secondary" onPress={() => bukaTautan(buka, "dokumen")} /> : null}
              {buka.jenis === "historis" ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Arsip non-posting. Keputusan tinjau/impor/rekonsiliasi dilakukan di web.</Text> : null}
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

export default denganAkses(Pemasukan, "financeRead");
