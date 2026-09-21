import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, CircleCheck, ShieldAlert, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { Sheet } from "@/design/Sheet";
import { StatusBadge } from "@/design/StatusBadge";
import { TeksSensitif } from "@/design/Samarkan";
import { Button, Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useRekonDetail } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ApiError } from "@/api/errors";
import { ENV } from "@/lib/env";
import { PESAN_BACA_SAJA, bacaSaja } from "@/lib/bacaSaja";
import { jam, tanggalPendek } from "@/lib/dates";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { LinimasaRiwayat } from "@/features/persetujuan/LampiranRiwayat";
import { BarisTeks, BarisUang } from "@/features/buku/Bagian";
import { useAksiRekon, type HasilRekon } from "@/features/buku/useAksiRekon";
import type { BarisRekon, KandidatRekon } from "@/api/types";

type Pesan = { tone: "sukses" | "galat" | "info"; teks: string };
type Tab = "belum" | "cocok" | "semua";

function BannerPesan({ pesan }: { pesan: Pesan }) {
  const { colors } = useTheme();
  const w = pesan.tone === "sukses" ? { bg: colors.successSoft, fg: colors.success, I: CircleCheck } : pesan.tone === "galat" ? { bg: colors.dangerSoft, fg: colors.danger, I: TriangleAlert } : { bg: colors.infoSoft, fg: colors.info, I: ShieldAlert };
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.small, backgroundColor: w.bg, marginBottom: 12 }}>
      <w.I size={18} color={w.fg} strokeWidth={1.75} />
      <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 13, lineHeight: 18 }}>{pesan.teks}</Text>
    </View>
  );
}

function KartuBaris({ b, onCocok, onLepas, nonaktif, alasanNonaktif }: { b: BarisRekon; onCocok: () => void; onLepas: () => void; nonaktif: boolean; alasanNonaktif: string | null }) {
  const { colors } = useTheme();
  return (
    <GlassCard padding={12} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, flexShrink: 1 }}>{tanggalPendek(b.tanggal)}{b.referensi ? ` · ${b.referensi}` : ""}</Text>
        <StatusBadge label={b.statusLabel} tone={b.nada} />
      </View>
      <TeksSensitif numberOfLines={3} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, marginTop: 4 }}>{b.keterangan}</TeksSensitif>
      <View style={{ marginTop: 6 }}><MoneyText value={b.nominal} size="md" autoNegatif /></View>
      {b.cocokDengan ? (
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>Cocok dengan {b.cocokDengan.nomor} · {b.cocokDengan.keterangan}{b.dicocokkan?.oleh ? ` · oleh ${b.dicocokkan.oleh.name}` : ""}</Text>
      ) : null}
      {b.catatan ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>{b.catatan}</Text> : null}
      {b.status === "BELUM_COCOK" ? (
        b.aksi.cocokkan.boleh ? (
          <Button label={`Cocokkan (${b.kandidat.length} kandidat)`} variant="secondary" disabled={nonaktif} onPress={onCocok} style={{ marginTop: 10 }} />
        ) : <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 8 }}>{b.aksi.cocokkan.alasan ?? "Tidak tersedia."}</Text>
      ) : null}
      {b.status === "COCOK" && b.aksi.lepas.boleh ? <Button label="Lepas pencocokan" variant="ghost" disabled={nonaktif} onPress={onLepas} style={{ marginTop: 10 }} /> : null}
      {nonaktif && alasanNonaktif && (b.aksi.cocokkan.boleh || b.aksi.lepas.boleh) ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.medium, fontSize: 11, marginTop: 6 }}>{alasanNonaktif}</Text> : null}
    </GlassCard>
  );
}

function DetailRekon() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useRekonDetail(String(id));
  const { cocokkan, lepas, sibuk } = useAksiRekon();
  const [tab, setTab] = useState<Tab>("belum");
  const [pesan, setPesan] = useState<Pesan | null>(null);
  const [pilih, setPilih] = useState<BarisRekon | null>(null);
  const [konfirmasi, setKonfirmasi] = useState<{ baris: BarisRekon; kand: KandidatRekon } | null>(null);
  const [lepasBar, setLepasBar] = useState<BarisRekon | null>(null);
  const d = q.data;
  const muatUlang = () => void q.refetch();
  const tidakAda = q.error instanceof ApiError && q.error.status === 404;
  const nonaktif = sibuk || !online || bacaSaja();
  const alasanNonaktif = bacaSaja() ? PESAN_BACA_SAJA : !online ? "Tidak ada koneksi. Pencocokan tidak bisa dikirim." : null;

  function tampilkan(h: HasilRekon, sukses: string, bukaLagi?: () => void) {
    if (h.ok) { setPesan({ tone: "sukses", teks: sukses }); return; }
    if (h.info.jenis === "batal") { bukaLagi?.(); return; }
    setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
  }
  // Sheet (Modal) ditutup SEBELUM perintah dikirim agar layar step-up tidak tertutup.
  async function kirimCocok() {
    if (!konfirmasi) return;
    const { baris, kand } = konfirmasi;
    setKonfirmasi(null); setPilih(null);
    tampilkan(await cocokkan(baris.id, baris.aksi.cocokkan, kand.lineId), "Baris dicocokkan. Saldo dan selisih dimuat dari server.", () => setKonfirmasi({ baris, kand }));
  }
  async function kirimLepas() {
    if (!lepasBar) return;
    const baris = lepasBar;
    setLepasBar(null);
    tampilkan(await lepas(baris.id, baris.aksi.lepas), "Pencocokan dilepas.", () => setLepasBar(baris));
  }

  const tampil = (d?.baris ?? []).filter((b) => tab === "semua" || (tab === "belum" ? b.status === "BELUM_COCOK" : b.status === "COCOK"));

  return (
    <Screen refreshing={q.isRefetching} onRefresh={muatUlang}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Rekonsiliasi</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}

      {q.isLoading && !d ? (
        <View style={{ gap: 12 }} accessibilityLabel="Memuat rekonsiliasi" accessibilityLiveRegion="polite"><Skeleton tinggi={150} style={{ borderRadius: radius.card }} /><Skeleton tinggi={200} style={{ borderRadius: radius.card }} /></View>
      ) : tidakAda ? (
        <EmptyState judul="Rekonsiliasi tidak ditemukan" aksi="Kembali" onAksi={() => router.back()} />
      ) : !d ? (
        <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Rekonsiliasi" />
      ) : (
        <>
          {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
          {pesan ? <BannerPesan pesan={pesan} /> : null}
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 20 }}>{d.rekening.name}</Text>
          <View style={{ marginTop: 6, flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge label={d.statusLabel} tone={d.nada} />
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{d.periode.from} s/d {d.periode.to}{d.diperbaruiPada ? ` · diperbarui ${jam(d.diperbaruiPada)} WIB` : ""}</Text>
          </View>
          {d.status !== "DRAFT" ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>Rekonsiliasi sudah selesai — pencocokan terkunci.</Text> : null}

          <SectionHeader judul="Ringkasan" sub="Dihitung server." />
          <GlassCard>
            <BarisUang label="Saldo awal statement" nilai={d.saldoAwalKoran} />
            <BarisUang label="Saldo statement" nilai={d.saldoKoran} />
            <BarisUang label="Saldo buku" nilai={d.saldoBuku} />
            <BarisUang label={d.cocok ? "Selisih (cocok)" : "Selisih"} nilai={d.selisih} tebal warna={d.cocok ? colors.success : colors.danger} />
            <BarisTeks label="Belum cocok" isi={String(d.ringkasan.belumCocok)} />
            <BarisTeks label="Sudah cocok" isi={String(d.ringkasan.cocokBaris)} />
            <BarisTeks label="Mutasi buku belum dipasangkan" isi={String(d.ringkasan.mutasiBukuBelumDipasangkan)} />
          </GlassCard>

          <SectionHeader judul="Baris statement" sub={d.terpotong ? "Daftar dipotong server — tampil sebagian." : `${d.ringkasan.jumlahBaris} baris`} />
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Chip label="Belum cocok" aktif={tab === "belum"} jumlah={d.ringkasan.belumCocok} onPress={() => setTab("belum")} />
            <Chip label="Cocok" aktif={tab === "cocok"} jumlah={d.ringkasan.cocokBaris} onPress={() => setTab("cocok")} />
            <Chip label="Semua" aktif={tab === "semua"} onPress={() => setTab("semua")} />
          </View>
          {tampil.length === 0 ? <EmptyState judul={tab === "belum" ? "Semua baris sudah diproses" : "Tidak ada baris"} /> : tampil.map((b) => (
            <KartuBaris key={b.id} b={b} nonaktif={nonaktif} alasanNonaktif={alasanNonaktif} onCocok={() => setPilih(b)} onLepas={() => setLepasBar(b)} />
          ))}

          {d.riwayat.length > 0 ? (<><SectionHeader judul="Riwayat" /><LinimasaRiwayat riwayat={d.riwayat} /></>) : null}
        </>
      )}

      <Sheet visible={!!pilih && !konfirmasi} onClose={() => setPilih(null)} judul="Pilih mutasi buku" sub={pilih ? `Nominal dan arah sama dengan ${pilih.keterangan}` : undefined}>
        {(pilih?.kandidat ?? []).map((k) => (
          <PressableScale key={k.lineId} onPress={() => pilih && setKonfirmasi({ baris: pilih, kand: k })} accessibilityLabel={`Kandidat ${k.nomor}, ${k.keterangan}. Pilih`} style={{ paddingVertical: 10, minHeight: 48 }}>
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11 }}>{k.nomor} · {tanggalPendek(k.tanggal)} · {k.sumber}</Text>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{k.keterangan}</Text>
            <MoneyText value={k.nilai} size="sm" autoNegatif />
          </PressableScale>
        ))}
      </Sheet>
      <Sheet visible={!!konfirmasi} onClose={() => { if (!sibuk) setKonfirmasi(null); }} judul="Cocokkan mutasi ini?" sub="Pencocokan tercatat atas nama Anda dan memerlukan verifikasi ulang.">
        {konfirmasi ? (
          <View>
            <BarisTeks label="Statement" isi={konfirmasi.baris.keterangan} />
            <BarisTeks label="Jurnal" isi={`${konfirmasi.kand.nomor} · ${konfirmasi.kand.keterangan}`} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 7 }}><Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Nominal</Text><MoneyText value={konfirmasi.kand.nilai} size="sm" autoNegatif /></View>
            <Button label="Cocokkan" loading={sibuk} disabled={nonaktif} onPress={() => void kirimCocok()} style={{ marginTop: 10 }} />
            <Button label="Kembali" variant="ghost" disabled={sibuk} onPress={() => setKonfirmasi(null)} style={{ marginTop: 6 }} />
          </View>
        ) : null}
      </Sheet>
      <Sheet visible={!!lepasBar} onClose={() => { if (!sibuk) setLepasBar(null); }} judul="Lepas pencocokan?" sub="Baris kembali ke Belum cocok. Tindakan tercatat di riwayat.">
        <Button label="Lepas pencocokan" variant="danger" loading={sibuk} disabled={nonaktif} onPress={() => void kirimLepas()} style={{ marginTop: 10 }} />
        <Button label="Batal" variant="ghost" disabled={sibuk} onPress={() => setLepasBar(null)} style={{ marginTop: 6 }} />
      </Sheet>
    </Screen>
  );
}

export default denganAkses(DetailRekon, "financeRead");
