import React, { useState } from "react";
import { Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, CircleCheck, Share2, ShieldAlert, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { Button, Chip, EmptyState, ErrorState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useLaporanNyata } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { jam } from "@/lib/dates";
import { S } from "@/lib/strings";
import { JENIS_LAPORAN, LAPORAN_PER_TANGGAL, teksBagikan } from "@/api/laporan";
import type { BarisLaporanNyata, JenisLaporanNyata } from "@/api/types";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { periodeBuku } from "@/features/buku/Bagian";

function BarisLap({ b, periode, onBuka }: { b: BarisLaporanNyata; periode: { from: string; to: string }; onBuka: (b: BarisLaporanNyata, p: { from: string; to: string }) => void }) {
  const { colors } = useTheme();
  const isi = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 12 }}>
      <View style={{ flex: 1, flexShrink: 1 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{b.nama}</Text>
        {b.kode ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 1 }}>{b.kode}</Text> : null}
        {b.sub ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11, marginTop: 1 }}>{b.sub}</Text> : null}
      </View>
      <View style={{ maxWidth: "48%", flexShrink: 0 }}><MoneyText value={b.nilai} size="md" autoNegatif /></View>
      {b.drill ? <ChevronRight size={16} color={colors.textFaint} strokeWidth={1.75} /> : null}
    </View>
  );
  return b.drill ? <PressableScale onPress={() => onBuka(b, periode)} accessibilityLabel={`${b.nama}. Lihat rincian`}>{isi}</PressableScale> : <View accessible accessibilityLabel={b.nama}>{isi}</View>;
}

function DetailLaporan() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { jenis } = useLocalSearchParams<{ jenis: string }>();
  const valid = JENIS_LAPORAN.includes(jenis as JenisLaporanNyata);
  const [periodeId, setPeriodeId] = useState(periodeBuku()[0]?.id ?? "bulan-ini");
  const periode = periodeBuku().find((p) => p.id === periodeId) ?? (periodeBuku()[0] as NonNullable<ReturnType<typeof periodeBuku>[number]>);
  const q = useLaporanNyata(valid ? (jenis as JenisLaporanNyata) : "laba-rugi", { from: periode.from, to: periode.to });
  const data = q.data;
  const perTanggal = valid && LAPORAN_PER_TANGGAL.includes(jenis as JenisLaporanNyata);
  const muatUlang = () => void q.refetch();

  function buka(b: BarisLaporanNyata, p: { from: string; to: string }) {
    if (!b.drill) return;
    if (b.drill.tipe === "akun") router.push({ pathname: "/buku/akun/[id]", params: { id: b.drill.id, from: p.from, to: p.to } });
    else router.push({ pathname: "/tx/[modul]/[id]", params: { modul: b.drill.tipe, id: b.drill.id } });
  }

  return (
    <Screen refreshing={q.isRefetching} onRefresh={muatUlang}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>{S.laporan.judul}</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}

      {!valid ? (
        <ErrorState judul="Laporan tidak dikenal" />
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {periodeBuku().map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={periodeId === p.id} onPress={() => setPeriodeId(p.id)} />)}
          </View>
          {perTanggal ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 10 }}>Laporan ini per tanggal: memakai akhir periode ({periode.to}).</Text> : null}

          {q.isLoading && !data ? (
            <View style={{ gap: 12 }} accessibilityLabel="Memuat laporan" accessibilityLiveRegion="polite"><Skeleton tinggi={30} lebar="60%" /><Skeleton tinggi={140} style={{ borderRadius: radius.card }} /><Skeleton tinggi={220} style={{ borderRadius: radius.card }} /></View>
          ) : !data ? (
            <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Laporan" />
          ) : (
            <View style={{ opacity: q.isPlaceholderData ? 0.55 : 1 }}>
              {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26 }}>{data.judul}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginTop: 2 }}>{data.periode}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 2, marginBottom: 14 }}>Diperbarui {jam(data.diperbaruiPada)} WIB · dihitung server</Text>

              {data.seimbang === false ? (
                <GlassCard variant="flat" style={{ marginBottom: 12, borderColor: colors.danger }}>
                  <View accessible accessibilityRole="alert" style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                    <ShieldAlert size={20} color={colors.danger} strokeWidth={1.75} />
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.danger, fontFamily: font.semibold, fontSize: 13 }}>Laporan tidak seimbang</Text>
                      {data.selisih ? <View style={{ marginTop: 2 }}><MoneyText value={data.selisih} size="sm" color={colors.danger} autoNegatif /></View> : null}
                      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>Hubungi admin untuk memeriksa jurnal.</Text>
                    </View>
                  </View>
                </GlassCard>
              ) : data.seimbang === true ? (
                <View accessible accessibilityLabel="Seimbang" style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <CircleCheck size={16} color={colors.success} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.success, fontFamily: font.semibold, fontSize: 12 }}>Seimbang</Text>
                </View>
              ) : null}

              {data.bagianKosong.length > 0 ? (
                <GlassCard variant="flat" style={{ marginBottom: 12, borderColor: colors.warning }}>
                  <View accessible accessibilityRole="alert" style={{ flexDirection: "row", gap: 10 }}>
                    <TriangleAlert size={18} color={colors.warning} strokeWidth={1.75} />
                    <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 12, lineHeight: 17 }}>Data belum lengkap: {data.bagianKosong.join(", ")} tidak diterima dari server. Angka di bawah bisa belum utuh.</Text>
                  </View>
                </GlassCard>
              ) : null}

              <GlassCard variant="hero">
                {data.ringkasan.map((r, i) => (
                  <View key={r.label} accessible accessibilityLabel={r.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "rgba(255,255,255,0.14)" }}>
                    <Text maxFontSizeMultiplier={1.3} style={{ flexShrink: 1, color: colors.heroTextMuted, fontFamily: r.tebal ? font.semibold : font.regular, fontSize: 14 }}>{r.label}</Text>
                    <View style={{ maxWidth: "58%", flexShrink: 0 }}>
                      {r.nilai ? <MoneyText value={r.nilai} size={r.tebal ? "lg" : "md"} color={colors.heroText} autoNegatif /> : <Text style={{ color: colors.heroText, fontFamily: font.semibold, fontSize: 14 }}>{r.teks}</Text>}
                    </View>
                  </View>
                ))}
              </GlassCard>

              {data.bagian.length === 0 ? <View style={{ marginTop: 16 }}><EmptyState judul="Tidak ada data" isi="Tidak ada transaksi pada periode ini." /></View> : null}
              {data.bagian.map((k) => (
                <View key={k.judul}>
                  <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16, marginTop: 22, marginBottom: 10 }}>{k.judul}</Text>
                  <GlassCard padding={4}>
                    {k.baris.map((b, i) => (
                      <View key={b.kunci} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                        <BarisLap b={b} periode={{ from: periode.from, to: periode.to }} onBuka={buka} />
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
                      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13 }}>{S.beranda.catatan}</Text>
                      {data.catatan.map((c) => <Text key={c} maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{c}</Text>)}
                    </View>
                  </View>
                </GlassCard>
              ) : null}

              <Button label="Bagikan ringkasan" variant="secondary" icon={Share2} onPress={() => void Share.share({ message: teksBagikan(data) })} style={{ marginTop: 20 }} />
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 8, textAlign: "center" }}>Perbandingan periode dan ekspor berkas tersedia di web.</Text>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

export default denganAkses(DetailLaporan, "financeRead");
