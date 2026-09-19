import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  BadgeCheck, Banknote, Camera, CircleCheck, Eye, EyeOff, HandCoins, Landmark, Receipt, RefreshCw, ShoppingCart,
  ArrowLeftRight, TriangleAlert, Wallet, type LucideIcon,
} from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { BarTren, DonatEmber, Legenda, WARNA_EMBER } from "@/design/charts";
import { ErrorState, IconCircle, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { haptic } from "@/design/haptics";
import { useDashboard, useTren } from "@/hooks/data";
import { useOnline } from "@/hooks/useOnline";
import { useSession } from "@/auth/session";
import { ENV } from "@/lib/env";
import { hariIniWIB, labelBulan, sapaan, tanggalPendek, tanggalPanjang } from "@/lib/dates";
import { S } from "@/lib/strings";

type Aksi = { id: string; label: string; Icon: LucideIcon; perlu: "post" | "payment" | "any" };
const AKSI: Aksi[] = [
  { id: "foto", label: S.aksi.fotoNota, Icon: Camera, perlu: "post" },
  { id: "pengeluaran", label: S.aksi.pengeluaran, Icon: Receipt, perlu: "post" },
  { id: "pembelian", label: S.aksi.pembelian, Icon: ShoppingCart, perlu: "post" },
  { id: "kasbon", label: S.aksi.kasbon, Icon: HandCoins, perlu: "post" },
  { id: "transfer", label: S.aksi.transfer, Icon: ArrowLeftRight, perlu: "post" },
  { id: "pemasukan", label: S.aksi.pemasukan, Icon: Banknote, perlu: "post" },
  { id: "verifikasi", label: S.aksi.verifikasi, Icon: BadgeCheck, perlu: "payment" },
  { id: "refund", label: S.aksi.refund, Icon: RefreshCw, perlu: "post" },
];

const IKON_REKENING: Record<string, LucideIcon> = { BANK: Landmark, KAS: Wallet, EWALLET: Wallet };

export default function Beranda() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const user = useSession((s) => s.user);
  const caps = useSession((s) => s.capabilities);
  const sembunyi = usePrefs((s) => s.sembunyikanAngka);
  const setSembunyi = usePrefs((s) => s.setSembunyikanAngka);
  const { data, isLoading, isError, error, refetch, isRefetching } = useDashboard();
  const tren = useTren();

  // Owner: aksi catat bukan aksi cepat (PRD §12.4, preset OWNER menonjolkan baca + approve).
  const aksiTampil = AKSI.filter((a) => {
    if (a.perlu === "post") return !!caps?.financePost && caps.preset !== "OWNER";
    if (a.perlu === "payment") return !!caps?.paymentWrite;
    return true;
  });

  const menunggu = data ? data.antrean.pengeluaranMenunggu + data.antrean.pembelianMenunggu + data.antrean.tagihanMenunggu + data.antrean.refundMenunggu : 0;
  const verifikasi = data ? data.antrean.lunasBelumDicatat.jumlah + data.antrean.jumlahPembayaranBelumVerifikasi : 0;
  const gap = data?.catatan.gapTerbuka ?? 0;

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{tanggalPanjang(hariIniWIB())}</Text>
          <Text numberOfLines={1} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22 }}>{sapaan()}, {user?.name.split(" ")[0] ?? ""}</Text>
        </View>
        <PressableScale
          onPress={() => { haptic.tick(); setSembunyi(!sembunyi); }}
          accessibilityLabel={sembunyi ? "Tampilkan angka" : "Sembunyikan angka"}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.glassFill, borderWidth: 1, borderColor: colors.glassStroke, alignItems: "center", justifyContent: "center" }}
        >
          {sembunyi ? <EyeOff size={20} color={colors.text} strokeWidth={1.75} /> : <Eye size={20} color={colors.text} strokeWidth={1.75} />}
        </PressableScale>
      </View>

      {isLoading ? (
        <BerandaMemuat />
      ) : isError || !data ? (
        <ErrorState judul="Beranda belum bisa dimuat" isi={error instanceof Error ? error.message : undefined} onCoba={() => void refetch()} />
      ) : (
        <>
          {/* Hero: total kas & bank */}
          <GlassCard variant="hero" padding={20}>
            <Text style={{ color: colors.heroTextMuted, fontFamily: font.medium, fontSize: 13 }}>{S.beranda.totalKas}</Text>
            <View style={{ marginTop: 6 }}>
              <MoneyText value={data.totalKas} size="hero" color={colors.heroText} redupkanPecahan />
            </View>
            <Text style={{ color: colors.heroTextMuted, fontFamily: font.regular, fontSize: 12, marginTop: 10 }}>
              {data.kasBank.length} rekening · {labelBulan(data.periode.from)}
            </Text>
          </GlassCard>

          {/* Rekening */}
          <SectionHeader judul={S.beranda.rekening} aksi={S.umum.lihatSemua} onAksi={() => router.push("/aksi-cepat?aksi=kas")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }} style={{ marginHorizontal: -16, paddingHorizontal: 16 }}>
            {data.kasBank.map((k) => {
              const Ikon = IKON_REKENING[k.kind] ?? Wallet;
              return (
                <GlassCard key={k.id} padding={14} style={{ width: 176 }}>
                  <IconCircle icon={Ikon} tone="info" size={38} />
                  <Text numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 12 }}>{k.name}</Text>
                  <MoneyText value={k.saldo} size="md" ringkas autoNegatif style={{ marginTop: 2 }} />
                </GlassCard>
              );
            })}
          </ScrollView>

          {/* Aksi cepat */}
          {aksiTampil.length > 0 ? (
            <>
              <SectionHeader judul={S.beranda.aksiCepat} />
              <GlassCard padding={12}>
                <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                  {aksiTampil.map((a) => (
                    <PressableScale
                      key={a.id}
                      onPress={() => { haptic.ringan(); router.push({ pathname: "/aksi-cepat", params: { aksi: a.id } }); }}
                      accessibilityLabel={a.label}
                      style={{ width: "25%", alignItems: "center", paddingVertical: 10, gap: 6 }}
                    >
                      <IconCircle icon={a.Icon} tone="info" size={46} />
                      <Text numberOfLines={2} style={{ color: colors.text, fontFamily: font.medium, fontSize: 11, textAlign: "center", lineHeight: 14 }}>{a.label}</Text>
                    </PressableScale>
                  ))}
                </View>
              </GlassCard>
            </>
          ) : null}

          {/* Perlu tindakan */}
          {(menunggu > 0 || verifikasi > 0 || gap > 0) ? (
            <>
              <SectionHeader judul={S.beranda.perluTindakan} />
              <View style={{ flexDirection: "row", gap: 10 }}>
                {caps?.financeApprove ? (
                  <Tindakan ikon={CircleCheck} nilai={menunggu} label="Menunggu persetujuan" tone="warning" onPress={() => router.push("/persetujuan")} />
                ) : null}
                {caps?.paymentRead ? (
                  <Tindakan ikon={BadgeCheck} nilai={verifikasi} label="Menunggu verifikasi" tone="info" onPress={() => router.push("/transaksi")} />
                ) : null}
                {gap > 0 ? <Tindakan ikon={TriangleAlert} nilai={gap} label="Data belum lengkap" tone="danger" onPress={() => router.push("/lainnya")} /> : null}
              </View>
            </>
          ) : null}

          {/* Ringkasan periode */}
          <SectionHeader judul={S.beranda.periode} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Kpi label={S.beranda.labaBersih} nilai={data.labaRugi.labaBersih} autoNegatif />
            <Kpi label={S.beranda.piutang} nilai={data.piutang.total} />
            <Kpi label={S.beranda.utang} nilai={data.utang.total} />
          </View>

          {tren.data ? (
            <>
              <SectionHeader judul={S.beranda.tren} />
              <GlassCard><BarTren data={tren.data} /></GlassCard>
            </>
          ) : null}

          <SectionHeader judul={S.beranda.komposisiPiutang} />
          <GlassCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <DonatEmber
                ember={data.piutang.ember}
                totalServer={data.piutang.total}
                tengah={<><Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11 }}>Piutang</Text><MoneyText value={data.piutang.total} size="sm" ringkas /></>}
              />
              <View style={{ flex: 1, gap: 8 }}>
                {data.piutang.ember.map((e, i) => (
                  <View key={e.label} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Legenda warna={WARNA_EMBER(colors)[i % 5] ?? colors.primary} label={e.label} />
                    <MoneyText value={e.total} size="sm" ringkas />
                  </View>
                ))}
              </View>
            </View>
          </GlassCard>

          <SectionHeader judul={S.beranda.jurnalTerakhir} />
          <GlassCard padding={4}>
            {data.jurnalTerakhir.map((j, i) => (
              <View key={j.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14, lineHeight: 19 }}>{j.description}</Text>
                  <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{j.entryNumber} · {tanggalPendek(j.date)}</Text>
                </View>
                <MoneyText value={j.total} size="md" />
              </View>
            ))}
          </GlassCard>

          {data.catatan.pesan.length > 0 ? (
            <GlassCard variant="flat" style={{ marginTop: 16 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TriangleAlert size={18} color={colors.warning} strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 13 }}>{S.beranda.catatan}</Text>
                  {data.catatan.pesan.map((p) => (
                    <Text key={p} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 4 }}>{p}</Text>
                  ))}
                </View>
              </View>
            </GlassCard>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Tindakan({ ikon, nilai, label, tone, onPress }: { ikon: LucideIcon; nilai: number; label: string; tone: "warning" | "info" | "danger"; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={() => { haptic.tick(); onPress(); }} accessibilityLabel={`${label}: ${nilai}`} style={{ flex: 1 }}>
      <GlassCard padding={12}>
        <IconCircle icon={ikon} tone={tone} size={36} />
        <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, marginTop: 10 }}>{nilai}</Text>
        <Text numberOfLines={2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11, lineHeight: 14 }}>{label}</Text>
      </GlassCard>
    </PressableScale>
  );
}

function Kpi({ label, nilai, autoNegatif }: { label: string; nilai: string; autoNegatif?: boolean }) {
  const { colors } = useTheme();
  return (
    <GlassCard padding={12} style={{ flex: 1 }}>
      <Text numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 11 }}>{label}</Text>
      <MoneyText value={nilai} size="md" ringkas autoNegatif={autoNegatif} style={{ marginTop: 6 }} />
    </GlassCard>
  );
}

function BerandaMemuat() {
  return (
    <View style={{ gap: 14 }}>
      <Skeleton tinggi={150} style={{ borderRadius: radius.card }} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Skeleton tinggi={96} lebar={176} style={{ borderRadius: radius.card }} />
        <Skeleton tinggi={96} lebar={176} style={{ borderRadius: radius.card }} />
      </View>
      <Skeleton tinggi={140} style={{ borderRadius: radius.card }} />
      <Skeleton tinggi={200} style={{ borderRadius: radius.card }} />
    </View>
  );
}
