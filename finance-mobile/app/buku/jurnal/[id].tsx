import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { TeksSensitif } from "@/design/Samarkan";
import { EmptyState, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useJurnalDetail } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ApiError } from "@/api/errors";
import { ENV } from "@/lib/env";
import { tanggalPendek, waktuLengkap } from "@/lib/dates";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { LinimasaRiwayat } from "@/features/persetujuan/LampiranRiwayat";
import { BarisTeks, BarisUang, IndikatorSeimbang, KartuPeringatan, rentangBulan, tujuanDokumen } from "@/features/buku/Bagian";

function DetailJurnal() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useJurnalDetail(String(id));
  const d = q.data;
  const muatUlang = () => void q.refetch();
  const tidakAda = q.error instanceof ApiError && q.error.status === 404;
  const bukaJurnal = (jid: string) => router.push({ pathname: "/buku/jurnal/[id]", params: { id: jid } });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={muatUlang}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali ke daftar jurnal" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Jurnal</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}

      {q.isLoading && !d ? (
        <View style={{ gap: 12 }} accessibilityLabel="Memuat detail jurnal" accessibilityLiveRegion="polite"><Skeleton tinggi={110} style={{ borderRadius: radius.card }} /><Skeleton tinggi={220} style={{ borderRadius: radius.card }} /></View>
      ) : tidakAda ? (
        <EmptyState judul="Jurnal tidak ditemukan" isi="Jurnal ini mungkin sudah tidak ada." aksi="Kembali" onAksi={() => router.back()} />
      ) : !d ? (
        <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Detail jurnal" />
      ) : (
        <>
          {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 13 }}>{d.sumberLabel} · {d.nomor}</Text>
          <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 20, lineHeight: 26, marginTop: 6 }}>{d.keterangan}</TeksSensitif>
          <View style={{ marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge label={d.statusLabel} tone={d.nada} />
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>Tanggal buku {tanggalPendek(d.tanggal)}</Text>
          </View>

          {d.catatan ? <View style={{ marginTop: 14 }}><KartuPeringatan judul="Jurnal tidak seimbang" isi={d.catatan} /></View> : null}

          <SectionHeader judul="Keseimbangan" sub="Dihitung server." />
          <GlassCard>
            <BarisUang label="Total debit" nilai={d.totalDebit} />
            <BarisUang label="Total kredit" nilai={d.totalKredit} />
            <View style={{ paddingTop: 6 }}><IndikatorSeimbang seimbang={d.seimbang} selisih={d.selisih} /></View>
          </GlassCard>

          <SectionHeader judul="Baris jurnal" sub={`${d.jumlahBaris} baris — ketuk untuk melihat buku besar akun`} />
          <GlassCard padding={4}>
            {d.baris.map((b, i) => (
              <PressableScale key={`${b.no}-${b.akunId}`} onPress={() => { const r = rentangBulan(d.tanggal); router.push({ pathname: "/buku/akun/[id]", params: { id: b.akunId, from: r.from, to: r.to } }); }} accessibilityLabel={`Akun ${b.kodeAkun} ${b.namaAkun}. Buka buku besar`}>
                <View style={{ padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{b.kodeAkun} {b.namaAkun}</Text>
                    <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 6 }}>
                    <View accessible accessibilityLabel="Debit"><Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11 }}>Debit</Text><MoneyText value={b.debit} size="sm" /></View>
                    <View accessible accessibilityLabel="Kredit" style={{ alignItems: "flex-end" }}><Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11 }}>Kredit</Text><MoneyText value={b.kredit} size="sm" /></View>
                  </View>
                  {b.keterangan || b.rekening || b.order || b.pelanggan || b.supplier ? (
                    <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>
                      {[b.keterangan, b.rekening, b.order ? `Order ${b.order.nomor ?? ""}` : null, b.pelanggan, b.supplier].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
              </PressableScale>
            ))}
          </GlassCard>

          <SectionHeader judul="Dokumen terkait" />
          <GlassCard>
            {d.dokumen ? (
              <PressableScale onPress={() => router.push(tujuanDokumen(d.dokumen as NonNullable<typeof d.dokumen>))} accessibilityLabel={`Dokumen sumber ${d.dokumen.nomor}. Buka`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.primary, fontFamily: font.medium, fontSize: 14, flexShrink: 1 }}>{d.dokumen.nomor}</Text>
                  <ChevronRight size={16} color={colors.primary} strokeWidth={1.75} />
                </View>
              </PressableScale>
            ) : <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, paddingVertical: 6 }}>Tidak ada dokumen sumber di aplikasi ({d.sumberLabel}).</Text>}
            {d.membalik ? <PressableScale onPress={() => bukaJurnal((d.membalik as { id: string }).id)} accessibilityLabel={`Membalik jurnal ${d.membalik.nomor}. Buka`}><BarisTeks label="Membalik" isi={`${d.membalik.nomor} ›`} /></PressableScale> : null}
            {d.dibalikOleh ? <PressableScale onPress={() => bukaJurnal((d.dibalikOleh as { id: string }).id)} accessibilityLabel={`Dibalik oleh ${d.dibalikOleh.nomor}. Buka`}><BarisTeks label="Dibalik oleh" isi={`${d.dibalikOleh.nomor} ›`} /></PressableScale> : null}
            {d.alasanBalik ? <BarisTeks label="Alasan pembalikan" isi={d.alasanBalik} /> : null}
          </GlassCard>

          <SectionHeader judul="Pencatatan" />
          <GlassCard>
            <BarisTeks label="Dibuat oleh" isi={d.dibuatOleh?.name ?? "—"} />
            <BarisTeks label="Diposting oleh" isi={d.diposting.oleh?.name ?? "—"} />
            <BarisTeks label="Diposting pada" isi={d.diposting.pada ? waktuLengkap(d.diposting.pada) : "—"} />
          </GlassCard>

          {d.riwayat.length > 0 ? (<><SectionHeader judul="Riwayat" /><LinimasaRiwayat riwayat={d.riwayat} /></>) : null}
        </>
      )}
    </Screen>
  );
}

export default denganAkses(DetailJurnal, "financeRead");
