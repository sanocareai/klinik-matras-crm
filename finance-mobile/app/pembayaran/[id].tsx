import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, CircleCheck, ShieldAlert, TriangleAlert, XCircle } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Sheet } from "@/design/Sheet";
import { TeksSensitif, useSamarkan } from "@/design/Samarkan";
import { Button, EmptyState, IconCircle, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { usePembayaranDetail } from "@/hooks/pembayaran";
import { useOnline } from "@/hooks/useOnline";
import { ApiError } from "@/api/errors";
import { ENV } from "@/lib/env";
import { formatRupiah, type Money } from "@/lib/money";
import { tanggalPendek, waktuLengkap } from "@/lib/dates";
import { S } from "@/lib/strings";
import { denganAkses } from "@/features/guard/RequireCapability";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import { AlasanSheet } from "@/features/persetujuan/Sheets";
import { LinimasaRiwayat } from "@/features/persetujuan/LampiranRiwayat";
import { BuktiPembayaran } from "@/features/pembayaran/BuktiPembayaran";
import { LABEL_JENIS_BAYAR, nadaStatusBayar } from "@/features/pembayaran/KartuPembayaran";
import { useKeputusanBayar } from "@/features/pembayaran/useKeputusanBayar";
import type { PembayaranDetail } from "@/api/types";

type Pesan = { tone: "sukses" | "galat" | "info"; teks: string };

const LABEL_BAYAR_ORDER: Record<string, string> = { BELUM_BAYAR: "Belum bayar", DP: "DP (sebagian)", LUNAS: "Lunas" };
const LABEL_TIDAK_TERCATAT: Record<string, string> = { referensi: "Nomor referensi", pengirim: "Pengirim / nama di bukti", catatan: "Catatan" };
const LABEL_INVOICE: Record<string, string> = { CANCELLED: "Dibatalkan", DRAFT: "Draf", SENT: "Terkirim", PAID: "Lunas", OVERDUE: "Jatuh tempo" };

function Baris({ label, isi, sensitif = false, redup = false }: { label: string; isi: string; sensitif?: boolean; redup?: boolean }) {
  const { colors } = useTheme();
  const gaya = { color: redup ? colors.textFaint : colors.text, fontFamily: redup ? font.regular : font.medium, fontSize: 13, flexShrink: 1, textAlign: "right" as const };
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingVertical: 8 }}>
      {/* Label tidak menyusut di bawah lebar katanya (font besar: "Invoice" tidak boleh pecah jadi "Invoic/e"); nilai mengisi sisanya. */}
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, flexShrink: 0, maxWidth: "46%" }}>{label}</Text>
      {sensitif ? <TeksSensitif maxFontSizeMultiplier={1.3} style={gaya}>{isi}</TeksSensitif> : <Text maxFontSizeMultiplier={1.3} style={gaya}>{isi}</Text>}
    </View>
  );
}

function BarisUang({ label, value, tebal = false }: { label: string; value: Money; tebal?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16, paddingVertical: 8 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: tebal ? font.medium : font.regular, fontSize: 13, flexShrink: 1 }}>{label}</Text>
      <View style={{ flexShrink: 0, maxWidth: "58%" }}><MoneyText value={value} size="sm" /></View>
    </View>
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

function Peringatan({ d }: { d: PembayaranDetail }) {
  const { colors } = useTheme();
  if (d.peringatan.length === 0 && !d.belumDibukukan) return null;
  return (
    <GlassCard variant="flat" style={{ marginTop: 16 }}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13, marginBottom: 6 }}>Perlu diperhatikan</Text>
      {d.peringatan.map((w) => (
        <View key={w.kode || w.pesan} accessible accessibilityLabel={`Peringatan: ${w.pesan}`} style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
          <TriangleAlert size={16} color={colors.warning} strokeWidth={1.75} />
          <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>{w.pesan}</Text>
        </View>
      ))}
      {d.belumDibukukan ? (
        <View accessible accessibilityLabel={`Belum dibukukan: ${d.belumDibukukan.pesan}`} style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
          <TriangleAlert size={16} color={colors.danger} strokeWidth={1.75} />
          <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>{d.belumDibukukan.pesan}</Text>
        </View>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 6 }}>Ini hanya informasi dari server. Sistem tidak memblokir verifikasi.</Text>
    </GlassCard>
  );
}

function DetailPembayaran() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const samar = useSamarkan();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = usePembayaranDetail(String(id));
  const { kirim, sibuk } = useKeputusanBayar();
  const [tolakBuka, setTolakBuka] = useState(false);
  const [verifBuka, setVerifBuka] = useState(false);
  const [pesan, setPesan] = useState<Pesan | null>(null);
  const [alasan, setAlasan] = useState("");
  const d = q.data;
  const muatUlang = () => void q.refetch();

  // PENTING: Sheet (Modal) ditutup SEBELUM perintah dikirim — layar kunci step-up digambar di root aplikasi dan tertutup Modal bila masih terbuka.
  async function verifikasi() {
    if (!d) return;
    setVerifBuka(false);
    const h = await kirim(d.id, "verifikasi", d.aksi.verifikasi);
    if (h.ok) setPesan({ tone: "sukses", teks: "Pembayaran diverifikasi. Status resmi dimuat dari server." });
    else if (h.info.jenis !== "batal") setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
  }

  async function tolak() {
    if (!d) return;
    setTolakBuka(false);
    const h = await kirim(d.id, "tolak", d.aksi.tolak, alasan);
    if (h.ok) { setAlasan(""); setPesan({ tone: "sukses", teks: "Pembayaran ditolak. Jurnal dibalik dan alasan tercatat." }); }
    else if (h.info.jenis === "batal") setTolakBuka(true); // step-up dibatalkan: alasan yang sudah ditulis tidak hilang
    else setPesan({ tone: h.info.jenis === "konflik" || h.info.jenis === "tidakPasti" ? "info" : "galat", teks: h.info.pesan });
  }

  const tidakAda = q.error instanceof ApiError && q.error.status === 404;
  const jenis = d?.jenis ? LABEL_JENIS_BAYAR[d.jenis] : null;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={muatUlang}>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali ke daftar pembayaran" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Pembayaran</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      {pesan ? <BannerPesan pesan={pesan} /> : null}

      {q.isLoading && !d ? (
        <View style={{ gap: 12 }} accessibilityLabel="Memuat detail pembayaran" accessibilityLiveRegion="polite">
          <Skeleton tinggi={110} style={{ borderRadius: radius.card }} />
          <Skeleton tinggi={220} style={{ borderRadius: radius.card }} />
        </View>
      ) : tidakAda ? (
        <EmptyState judul="Pembayaran tidak ditemukan" isi="Pembayaran ini mungkin sudah tidak ada." aksi="Kembali" onAksi={() => router.back()} />
      ) : !d ? (
        <GalatPenuh error={q.error} online={online} onCoba={muatUlang} nama="Detail pembayaran" />
      ) : (
        <>
          {q.isError ? <BannerBasi error={q.error} online={online} onCoba={muatUlang} /> : null}
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 13 }}>
            Pembayaran{jenis ? ` ${jenis}` : ""} · {d.order?.nomor ?? "Tanpa order"}
          </Text>
          <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, lineHeight: 28, marginTop: 6 }}>{d.pelanggan?.name ?? "(pelanggan tidak diketahui)"}</TeksSensitif>
          <View style={{ marginTop: 12 }}><MoneyText value={d.nominal} size="xl" /></View>
          <View style={{ marginTop: 10, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge label={d.statusLabel} tone={nadaStatusBayar(d.status)} />
            {jenis ? <StatusBadge label={jenis} tone="info" /> : null}
          </View>

          {d.status === "TERVERIFIKASI" || d.status === "DITOLAK" || d.status === "DIBATALKAN" ? (
            <GlassCard variant="flat" style={{ marginTop: 16 }}>
              <View accessible accessibilityRole="summary" style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <IconCircle icon={d.status === "TERVERIFIKASI" ? CircleCheck : XCircle} tone={d.status === "TERVERIFIKASI" ? "success" : d.status === "DITOLAK" ? "danger" : "neutral"} size={38} />
                <View style={{ flex: 1 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>
                    {d.status === "TERVERIFIKASI" ? "Sudah diverifikasi" : d.status === "DITOLAK" ? "Sudah ditolak" : "Sudah dibatalkan"}
                    {(d.verifikasi?.oleh ?? d.pembatalan?.oleh) ? ` oleh ${(d.verifikasi?.oleh ?? d.pembatalan?.oleh)?.name}` : ""}
                  </Text>
                  {(d.verifikasi?.pada ?? d.pembatalan?.pada) ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>{waktuLengkap((d.verifikasi?.pada ?? d.pembatalan?.pada) as string)}</Text> : null}
                  {d.pembatalan?.alasan ? <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.regular, fontSize: 13, marginTop: 4 }}>Alasan: {d.pembatalan.alasan}</TeksSensitif> : null}
                </View>
              </View>
            </GlassCard>
          ) : null}

          <Peringatan d={d} />

          <SectionHeader judul="Rincian" />
          <GlassCard>
            <Baris label="Order" isi={d.order?.nomor ?? "Tidak terhubung ke order"} />
            {d.invoice ? <Baris label="Invoice" isi={`${d.invoice.nomor} · ${LABEL_INVOICE[d.invoice.status] ?? d.invoice.status}`} /> : <Baris label="Invoice" isi="Belum ada invoice" redup />}
            {d.invoice?.jatuhTempo ? <Baris label="Jatuh tempo invoice" isi={tanggalPendek(d.invoice.jatuhTempo)} /> : null}
            <Baris label="Pelanggan" isi={d.pelanggan?.name ?? "—"} sensitif />
            {d.order ? <Baris label="Status bayar order (CRM)" isi={LABEL_BAYAR_ORDER[d.order.statusBayar] ?? d.order.statusBayar} /> : null}
            <Baris label="Jenis pembayaran" isi={jenis ?? "—"} />
            <Baris label="Cara bayar" isi={d.metodeLabel} />
            <Baris label="Rekening tujuan" isi={d.rekening?.name ?? "Tidak dipilih (mengikuti pemetaan metode)"} />
            <Baris label="Tanggal dicatat" isi={d.dicatatPada ? waktuLengkap(d.dicatatPada) : "—"} />
            <Baris label="Dicatat oleh" isi={`${d.pencatat?.name ?? "—"}${d.sumber === "PENGIRIMAN" ? " (saat pengiriman)" : ""}`} />
            {d.tidakTercatat.map((k) => <Baris key={k} label={LABEL_TIDAK_TERCATAT[k] ?? k} isi="Tidak tercatat di sistem" redup />)}
          </GlassCard>

          {d.tagihan ? (
            <>
              <SectionHeader judul="Tagihan order" sub="Angka dihitung server." />
              <GlassCard>
                <BarisUang label="Nilai order" value={d.tagihan.nilaiOrder} />
                <BarisUang label="Sudah terhitung dibayar" value={d.tagihan.terbayarTerhitung} />
                <BarisUang label="Sisa tagihan" value={d.tagihan.sisa} tebal />
                {d.status === "MENUNGGU" && !d.tagihan.terhitungSebelumVerifikasi ? <BarisUang label="Sisa jika pembayaran ini ikut dihitung" value={d.tagihan.sisaSetelahIni} /> : null}
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
                  {d.tagihan.terhitungSebelumVerifikasi ? "Pembayaran ini sudah terhitung di status bayar order sebelum diverifikasi (aturan verifikasi belum berlaku untuknya)."
                    : d.tagihan.gerbangVerifikasi ? "Status bayar order di CRM baru berubah setelah pembayaran diverifikasi."
                    : "Verifikasi belum diwajibkan: pembayaran sudah terhitung sebelum diverifikasi."}
                </Text>
              </GlassCard>
            </>
          ) : null}

          <SectionHeader judul="Alokasi" />
          {d.alokasi.length > 0 ? (
            <GlassCard>
              {d.alokasi.map((a) => <BarisUang key={a.orderId} label={`Order ${a.nomor ?? "—"}`} value={a.nominal} />)}
            </GlassCard>
          ) : (
            <GlassCard variant="flat">
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>
                Tanpa alokasi khusus — seluruh nominal dianggap milik order {d.order?.nomor ?? "ini"}.
              </Text>
            </GlassCard>
          )}

          <SectionHeader judul="Jurnal" />
          <GlassCard variant="flat">
            <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 18 }}>
              {d.jurnal
                ? `${d.jurnal.nomor ?? "Jurnal"} · ${d.jurnal.status === "POSTED" ? "Terbukukan" : d.jurnal.status}${d.jurnal.tanggal ? ` · ${tanggalPendek(d.jurnal.tanggal)}` : ""}`
                : d.status === "DITOLAK" || d.status === "DIBATALKAN" ? "Jurnal penerimaan dibalik saat pembayaran dibatalkan." : "Belum ada jurnal untuk pembayaran ini."}
            </Text>
          </GlassCard>

          <SectionHeader judul="Bukti pembayaran" />
          <BuktiPembayaran bukti={d.bukti} ada={d.adaBukti} tunai={d.metode === "CASH"} onMuatUlang={muatUlang} />

          <SectionHeader judul="Riwayat" />
          <LinimasaRiwayat riwayat={d.riwayat} />

          {d.status === "MENUNGGU" ? (
            <View style={{ marginTop: 22 }}>
              {!d.aksi.verifikasi.boleh && d.aksi.verifikasi.alasan ? (
                <View accessible accessibilityLabel={`Verifikasi tidak tersedia: ${d.aksi.verifikasi.alasan}`} style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <TriangleAlert size={16} color={colors.warning} strokeWidth={1.75} />
                  <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17 }}>{d.aksi.verifikasi.alasan}</Text>
                </View>
              ) : null}
              {!online ? <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12, marginBottom: 10 }}>{S.offline.aksiNonaktif}</Text> : null}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Button label="Tolak" variant="danger" disabled={!d.aksi.tolak.boleh || sibuk || !online} onPress={() => setTolakBuka(true)} style={{ flex: 1 }} />
                <Button label="Verifikasi" disabled={!d.aksi.verifikasi.boleh || sibuk || !online} loading={sibuk && verifBuka} onPress={() => setVerifBuka(true)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : null}

          <Sheet visible={verifBuka} onClose={() => { if (!sibuk) setVerifBuka(false); }} judul="Verifikasi pembayaran?" sub="Pastikan uangnya benar-benar sudah masuk. Verifikasi dicatat atas nama Anda dan tidak bisa dibatalkan dari aplikasi. Anda mungkin diminta PIN atau biometrik.">
            <View accessible style={{ paddingVertical: 8 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{jenis ? `${jenis} · ` : ""}{d.order?.nomor ?? "Tanpa order"} · {d.metodeLabel}{d.rekening ? ` · ${d.rekening.name}` : ""}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 20, marginTop: 2 }} accessibilityLabel={samar ? "Nominal disembunyikan" : formatRupiah(d.nominal)}>{samar ? "Rp ••••••" : formatRupiah(d.nominal)}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <Button label={S.umum.batal} variant="ghost" disabled={sibuk} onPress={() => setVerifBuka(false)} style={{ flex: 1 }} />
              <Button label="Verifikasi" loading={sibuk} disabled={sibuk} onPress={() => { void verifikasi(); }} style={{ flex: 1 }} />
            </View>
          </Sheet>
          <AlasanSheet
            visible={tolakBuka} sibuk={sibuk} nomor={d.order?.nomor ?? "pembayaran ini"} alasan={alasan} onUbah={setAlasan} onTutup={() => setTolakBuka(false)} onKirim={() => { void tolak(); }}
            judul="Tolak pembayaran" tombol="Tolak pembayaran" placeholder="Contoh: uang belum masuk di mutasi rekening"
            sub={`Tulis alasan penolakan. Pembayaran dibatalkan, jurnal penerimaan dibalik, dan status bayar order dihitung ulang. Alasan tercatat di riwayat.`}
          />
        </>
      )}
    </Screen>
  );
}

export default denganAkses(DetailPembayaran, "financeRead");
