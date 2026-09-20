import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CircleCheck, ChevronLeft, ShieldAlert, TriangleAlert, XCircle } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Sheet } from "@/design/Sheet";
import { TeksSensitif, useSamarkan } from "@/design/Samarkan";
import { Button, EmptyState, IconCircle, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useApprovalDetail } from "@/hooks/approvals";
import { useOnline } from "@/hooks/useOnline";
import { ApiError } from "@/api/errors";
import { ENV } from "@/lib/env";
import { formatRupiah } from "@/lib/money";
import { tanggalPendek, waktuLengkap } from "@/lib/dates";
import { S } from "@/lib/strings";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { AlasanSheet } from "@/features/persetujuan/Sheets";
import { GaleriLampiran, LinimasaRiwayat } from "@/features/persetujuan/LampiranRiwayat";
import { labelUmur } from "@/features/persetujuan/KartuItem";
import { useKeputusan } from "@/features/persetujuan/useKeputusan";
import type { ApprovalDetail } from "@/api/types";

type Pesan = { tone: "sukses" | "galat" | "info"; teks: string };

const LABEL_MODE: Record<string, string> = { LANGSUNG: "Langsung dari kas/bank", REIMBURSEMENT: "Reimbursement (ditalangi)", UTANG: "Utang" };

function Baris({ label, isi, sensitif = false }: { label: string; isi: string; sensitif?: boolean }) {
  const { colors } = useTheme();
  const gaya = { color: colors.text, fontFamily: font.medium, fontSize: 13, flexShrink: 1, textAlign: "right" as const };
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingVertical: 8 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{label}</Text>
      {sensitif ? <TeksSensitif maxFontSizeMultiplier={1.3} style={gaya}>{isi}</TeksSensitif> : <Text maxFontSizeMultiplier={1.3} style={gaya}>{isi}</Text>}
    </View>
  );
}

function RincianKartu({ d }: { d: ApprovalDetail }) {
  const r = d.rincian;
  const teks = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return (
    <GlassCard>
      <Baris label="Diajukan oleh" isi={d.pemohon?.name ?? "—"} />
      <Baris label="Tanggal dokumen" isi={tanggalPendek(d.tanggal)} />
      <Baris label="Umur pengajuan" isi={labelUmur(d.umurHari)} />
      {d.kategori ? <Baris label="Kategori" isi={d.kategori} /> : null}
      {d.rekening ? <Baris label="Rekening" isi={d.rekening} /> : null}
      {d.pihak ? <Baris label={d.jenis === "refund" ? "Pelanggan" : d.jenis === "bill" ? "Supplier" : "Penerima"} isi={d.pihak} sensitif /> : null}
      {d.nomorOrder ? <Baris label="Nomor order" isi={d.nomorOrder} /> : null}
      {d.mode ? <Baris label="Cara bayar" isi={LABEL_MODE[d.mode] ?? d.mode} /> : null}
      {teks("divisi") ? <Baris label="Divisi" isi={teks("divisi") as string} /> : null}
      {teks("nomorFakturSupplier") ? <Baris label="Faktur supplier" isi={teks("nomorFakturSupplier") as string} /> : null}
      {teks("jatuhTempo") ? <Baris label="Jatuh tempo" isi={tanggalPendek(teks("jatuhTempo"))} /> : null}
      {teks("diganti") ? <Baris label="Diganti kepada" isi={teks("diganti") as string} /> : null}
      {teks("dibayarPada") ? <Baris label="Dibayar" isi={`${waktuLengkap(teks("dibayarPada") as string)}${teks("dibayarOleh") ? ` · ${teks("dibayarOleh")}` : ""}`} /> : null}
      {typeof r.buktiTerverifikasi === "boolean" ? <Baris label="Bukti" isi={r.buktiTerverifikasi ? "Sudah diverifikasi" : "Belum diverifikasi"} /> : null}
      {teks("catatan") ? <Baris label="Catatan" isi={teks("catatan") as string} sensitif /> : null}
    </GlassCard>
  );
}

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

function DetailPersetujuan() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const samar = useSamarkan();
  const { jenis, id } = useLocalSearchParams<{ jenis: string; id: string }>();
  const q = useApprovalDetail(String(jenis), String(id));
  const { kirim, sibuk } = useKeputusan();
  const [tolakBuka, setTolakBuka] = useState(false);
  const [setujuBuka, setSetujuBuka] = useState(false);
  const [pesan, setPesan] = useState<Pesan | null>(null);
  const [alasan, setAlasan] = useState("");
  const d = q.data;
  const muatUlang = () => void q.refetch();

  // PENTING: Sheet (Modal) ditutup SEBELUM perintah dikirim — layar kunci step-up digambar di root aplikasi dan tertutup Modal bila masih terbuka.
  async function setuju() {
    if (!d) return;
    setSetujuBuka(false);
    const h = await kirim(d.id, "setujui", d.aksi.setujui);
    if (h.ok) setPesan({ tone: "sukses", teks: `${d.jenisLabel} ${d.nomor} disetujui. Status resmi dimuat dari server.` });
    else if (h.info.jenis !== "batal") setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
  }

  async function tolak() {
    if (!d) return;
    setTolakBuka(false);
    const h = await kirim(d.id, "tolak", d.aksi.tolak, alasan);
    if (h.ok) { setAlasan(""); setPesan({ tone: "sukses", teks: `${d.jenisLabel} ${d.nomor} ditolak. Alasan tercatat.` }); }
    else if (h.info.jenis === "batal") setTolakBuka(true); // step-up dibatalkan: alasan yang sudah ditulis tidak hilang
    else setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
  }

  const tidakAda = q.error instanceof ApiError && q.error.status === 404;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={muatUlang}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali ke daftar persetujuan" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>{S.persetujuan.judul}</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      {pesan ? <BannerPesan pesan={pesan} /> : null}

      {q.isLoading && !d ? (
        <View style={{ gap: 12 }} accessibilityLabel="Memuat detail persetujuan" accessibilityLiveRegion="polite">
          <Skeleton tinggi={110} style={{ borderRadius: radius.card }} />
          <Skeleton tinggi={220} style={{ borderRadius: radius.card }} />
        </View>
      ) : tidakAda ? (
        <EmptyState judul="Dokumen tidak ditemukan" isi="Dokumen ini mungkin sudah tidak ada di daftar persetujuan." aksi="Kembali" onAksi={() => router.back()} />
      ) : !d ? (
        <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Detail persetujuan" />
      ) : (
        <>
          {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 13 }}>{d.jenisLabel} · {d.nomor}</Text>
          <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, lineHeight: 28, marginTop: 6 }}>{d.keterangan || "(tanpa keterangan)"}</TeksSensitif>
          <View style={{ marginTop: 12 }}><MoneyText value={d.nominal} size="xl" /></View>
          <View style={{ marginTop: 10 }}>
            <StatusBadge label={d.statusLabel} tone={d.tahap === "DITOLAK" ? "danger" : d.tahap === "DISETUJUI" ? "success" : d.tahap === "DIPROSES" ? "info" : "warning"} />
          </View>

          {d.tahap !== "MENUNGGU" ? (
            <GlassCard variant="flat" style={{ marginTop: 16 }}>
              <View accessible accessibilityRole="summary" style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <IconCircle icon={d.tahap === "DITOLAK" ? XCircle : CircleCheck} tone={d.tahap === "DITOLAK" ? "danger" : "success"} size={38} />
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>
                    {d.tahap === "DITOLAK" ? "Sudah ditolak" : "Sudah diputuskan"}{d.diputuskanOleh ? ` oleh ${d.diputuskanOleh.name}` : ""}
                  </Text>
                  {d.diputuskanPada ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>{waktuLengkap(d.diputuskanPada)}</Text> : null}
                  {d.alasanTolak ? <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.regular, fontSize: 13, marginTop: 4 }}>Alasan: {d.alasanTolak}</TeksSensitif> : null}
                </View>
              </View>
            </GlassCard>
          ) : null}

          <View style={{ marginTop: 16 }}><RincianKartu d={d} /></View>

          <SectionHeader judul="Lampiran" />
          <GaleriLampiran lampiran={d.lampiran} ada={d.adaLampiran} onMuatUlang={muatUlang} />

          <SectionHeader judul="Riwayat" />
          <LinimasaRiwayat riwayat={d.riwayat} />

          {d.tahap === "MENUNGGU" ? (
            <View style={{ marginTop: 22 }}>
              {!d.aksi.setujui.boleh && d.aksi.setujui.alasan ? (
                <View accessible accessibilityLabel={`Persetujuan tidak tersedia: ${d.aksi.setujui.alasan}`} style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <TriangleAlert size={16} color={colors.warning} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17 }}>{d.aksi.setujui.alasan}</Text>
                </View>
              ) : null}
              {!online ? <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12, marginBottom: 10 }}>{S.offline.aksiNonaktif}</Text> : null}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Button label={S.persetujuan.tolak} variant="danger" disabled={!d.aksi.tolak.boleh || sibuk || !online} onPress={() => setTolakBuka(true)} style={{ flex: 1 }} />
                <Button label={S.persetujuan.setujui} disabled={!d.aksi.setujui.boleh || sibuk || !online} loading={sibuk && setujuBuka} onPress={() => setSetujuBuka(true)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : null}

          <Sheet visible={setujuBuka} onClose={() => { if (!sibuk) setSetujuBuka(false); }} judul="Setujui pengajuan?" sub="Persetujuan akan dicatat atas nama Anda dan tidak bisa dibatalkan dari aplikasi. Anda mungkin diminta PIN atau biometrik.">
            <View accessible style={{ paddingVertical: 8 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{d.jenisLabel} · {d.nomor}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 20, marginTop: 2 }} accessibilityLabel={samar ? "Nominal disembunyikan" : formatRupiah(d.nominal)}>{samar ? "Rp ••••••" : formatRupiah(d.nominal)}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <Button label={S.umum.batal} variant="ghost" disabled={sibuk} onPress={() => setSetujuBuka(false)} style={{ flex: 1 }} />
              <Button label="Setujui" loading={sibuk} disabled={sibuk} onPress={() => { void setuju(); }} style={{ flex: 1 }} />
            </View>
          </Sheet>
          <AlasanSheet visible={tolakBuka} sibuk={sibuk} nomor={d.nomor} alasan={alasan} onUbah={setAlasan} onTutup={() => setTolakBuka(false)} onKirim={() => { void tolak(); }} />
        </>
      )}
    </Screen>
  );
}

export default denganAkses(DetailPersetujuan, "financeApprove");
