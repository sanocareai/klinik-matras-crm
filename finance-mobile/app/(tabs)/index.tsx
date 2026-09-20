import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { BarTren } from "@/design/charts";
import { EmptyState, IconCircle, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { haptic } from "@/design/haptics";
import { useDashboard, useTren } from "@/hooks/data";
import { useOnline } from "@/hooks/useOnline";
import { useSession } from "@/auth/session";
import { aksiUntuk } from "@/features/aksi";
import { denganAkses } from "@/features/guard/RequireCapability";
import { ENV } from "@/lib/env";
import { hariIniWIB, sapaan, tanggalPanjang } from "@/lib/dates";
import { isZero } from "@/lib/money";
import { S } from "@/lib/strings";
import { PeriodeBar } from "@/features/beranda/PeriodeBar";
import { usePeriode } from "@/features/beranda/periodeStore";
import { usePeriodeAktif } from "@/features/beranda/usePeriodeAktif";
import { BannerBasi, GalatPenuh } from "@/features/umum/StatusData";
import {
  BagianBelumTersedia, DaftarRekening, HeroKas, JurnalTerakhir, KartuLabaRugi, KartuUmur, KesehatanPembukuan, PekerjaanTertunda, daftarTindakan,
} from "@/features/beranda/Bagian";

function Beranda() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const user = useSession((s) => s.user);
  const caps = useSession((s) => s.capabilities);
  const sembunyi = usePrefs((s) => s.sembunyikanAngka);
  const setSembunyi = usePrefs((s) => s.setSembunyikanAngka);

  const setPeriodeId = usePeriode((s) => s.setId);
  const hari = hariIniWIB();
  const periode = usePeriodeAktif();

  const { data, isLoading, isError, error, refetch, isRefetching, isFetching, isPlaceholderData, dataUpdatedAt } = useDashboard(periode);
  const tren = useTren();
  const muatUlang = () => void refetch();

  const aksiTampil = aksiUntuk(caps);
  const gerakPeriode = isPlaceholderData; // periode baru sedang dimuat; data lama tampil redup

  return (
    <Screen refreshing={isRefetching && !isPlaceholderData} onRefresh={muatUlang}>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{tanggalPanjang(hari)}</Text>
          <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22 }}>
            {sapaan()}, {user?.name.split(" ")[0] ?? ""}
          </Text>
        </View>
        <PressableScale
          onPress={() => { haptic.tick(); setSembunyi(!sembunyi); }}
          accessibilityLabel={sembunyi ? "Tampilkan angka" : "Sembunyikan angka"}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.glassStroke, alignItems: "center", justifyContent: "center" }}
        >
          {sembunyi ? <EyeOff size={20} color={colors.text} strokeWidth={1.75} /> : <Eye size={20} color={colors.text} strokeWidth={1.75} />}
        </PressableScale>
      </View>

      <PeriodeBar periode={periode} onPilih={setPeriodeId} memuat={isLoading || gerakPeriode || (isFetching && !data)} diperbaruiMs={data && dataUpdatedAt ? dataUpdatedAt : null} />

      {isLoading && !data ? (
        <BerandaMemuat />
      ) : !data ? (
        <GalatPenuh error={error} online={online} onCoba={muatUlang} nama="Beranda" />
      ) : (
        <View style={{ opacity: gerakPeriode ? 0.55 : 1 }}>
          {isError ? <BannerBasi error={error} online={online} onCoba={muatUlang} /> : null}
          <IsiBeranda
            data={data}
            aksiTampil={aksiTampil}
            trenTampil={tren.data ?? null}
            onBuka={(tujuan) => router.push(tujuan as never)}
            onAksi={(id) => { haptic.ringan(); router.push({ pathname: "/aksi-cepat", params: { aksi: id } }); }}
            onCoba={muatUlang}
          />
        </View>
      )}
    </Screen>
  );
}

function IsiBeranda({
  data, aksiTampil, trenTampil, onBuka, onAksi, onCoba,
}: {
  data: NonNullable<ReturnType<typeof useDashboard>["data"]>;
  aksiTampil: ReturnType<typeof aksiUntuk>;
  trenTampil: ReturnType<typeof useTren>["data"] | null;
  onBuka: (tujuan: string) => void;
  onAksi: (id: string) => void;
  onCoba: () => void;
}) {
  const { colors } = useTheme();
  const caps = useSession((s) => s.capabilities);
  const tindakan = daftarTindakan(data.antrean, data.catatan?.gapTerbuka ?? 0, caps);
  const belumAdaData = data.kasBank.length === 0 && data.jurnalTerakhir.length === 0 && data.bagianHilang.length === 0
    && tindakan.length === 0 && data.labaRugi != null && isZero(data.labaRugi.pendapatanBersih);

  return (
    <>
      {belumAdaData ? (
        <EmptyState judul="Belum ada data keuangan" isi="Belum ada transaksi atau saldo rekening yang terbukukan. Tarik layar ke bawah untuk memuat ulang." aksi="Muat ulang" onAksi={onCoba} />
      ) : (
        <>
          {data.bagianHilang.includes("kasBank") ? <BagianBelumTersedia bagian="kasBank" onCoba={onCoba} /> : <HeroKas totalKas={data.totalKas} jumlahRekening={data.kasBank.length} />}

          <SectionHeader judul="Saldo per rekening" sub="Posisi saat ini" />
          {data.bagianHilang.includes("kasBank") ? null : <DaftarRekening rekening={data.kasBank} />}

          {aksiTampil.length > 0 ? (
            <>
              <SectionHeader judul={S.beranda.aksiCepat} />
              <GlassCard padding={12}>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {aksiTampil.map((a) => (
                    <PressableScale key={a.id} onPress={() => onAksi(a.id)} accessibilityLabel={a.label} style={{ width: "25%", alignItems: "center", paddingVertical: 10, gap: 6 }}>
                      <IconCircle icon={a.Icon} tone="info" size={46} />
                      <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ color: colors.text, fontFamily: font.medium, fontSize: 11, textAlign: "center", lineHeight: 14 }}>{a.label}</Text>
                    </PressableScale>
                  ))}
                </View>
              </GlassCard>
            </>
          ) : null}

          <SectionHeader judul="Pekerjaan tertunda" />
          {data.antrean ? <PekerjaanTertunda daftar={tindakan} onBuka={onBuka} /> : <BagianBelumTersedia bagian="antrean" onCoba={onCoba} />}
        </>
      )}

      <SectionHeader judul="Laba rugi" sub={`${tanggalPeriode(data.periode)}`} />
      {data.labaRugi ? <KartuLabaRugi data={data.labaRugi} /> : <BagianBelumTersedia bagian="labaRugi" onCoba={onCoba} />}

      <SectionHeader judul="Piutang" sub="Posisi saat ini · umur tagihan" />
      {data.piutang ? (
        <KartuUmur
          judul="Total piutang" total={data.piutang.total} ember={data.piutang.ember} kosongTeks="Tidak ada piutang berjalan."
          catatan={data.piutang.menungguVerifikasi && data.piutang.menungguVerifikasi.jumlah > 0 ? `${data.piutang.menungguVerifikasi.jumlah} pembayaran menunggu verifikasi.` : undefined}
        />
      ) : <BagianBelumTersedia bagian="piutang" onCoba={onCoba} />}

      <SectionHeader judul="Utang usaha" sub="Posisi saat ini · umur tagihan" />
      {data.utang ? <KartuUmur judul="Total utang usaha" total={data.utang.total} ember={data.utang.ember} kosongTeks="Tidak ada utang usaha berjalan." /> : <BagianBelumTersedia bagian="utang" onCoba={onCoba} />}

      <SectionHeader judul="Kesehatan pembukuan" />
      {data.catatan ? <KesehatanPembukuan catatan={data.catatan} gate={data.gate} /> : <BagianBelumTersedia bagian="catatan" onCoba={onCoba} />}

      {trenTampil ? (
        <>
          <SectionHeader judul={S.beranda.tren} />
          <GlassCard><BarTren data={trenTampil} /></GlassCard>
        </>
      ) : null}

      <SectionHeader judul={S.beranda.jurnalTerakhir} />
      {data.bagianHilang.includes("jurnal") ? <BagianBelumTersedia bagian="jurnal" onCoba={onCoba} /> : <JurnalTerakhir daftar={data.jurnalTerakhir} />}
    </>
  );
}

function tanggalPeriode(p: { from: string; to: string }): string {
  return p.from && p.to ? `${p.from.split("-").reverse().join("/")} – ${p.to.split("-").reverse().join("/")}` : "";
}

function BerandaMemuat() {
  return (
    <View style={{ gap: 14 }} accessibilityLabel="Memuat Beranda" accessibilityLiveRegion="polite">
      <Skeleton tinggi={140} style={{ borderRadius: radius.card }} />
      <Skeleton tinggi={16} lebar="40%" />
      <Skeleton tinggi={180} style={{ borderRadius: radius.card }} />
      <Skeleton tinggi={16} lebar="35%" />
      <Skeleton tinggi={120} style={{ borderRadius: radius.card }} />
      <Skeleton tinggi={200} style={{ borderRadius: radius.card }} />
    </View>
  );
}

export default denganAkses(Beranda, "financeRead");
