import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Plus, ReceiptText } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { ErrorState, IconCircle, MockBanner, OfflineBanner, PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { usePembayaranLencana } from "@/hooks/pembayaran";
import { useRingkasanModul } from "@/hooks/transaksi";
import { useOnline } from "@/hooks/useOnline";
import { useSession } from "@/auth/session";
import { ENV } from "@/lib/env";
import { S } from "@/lib/strings";
import { denganAkses } from "@/features/guard/RequireCapability";
import { KONFIG, URUTAN_MODUL, bisaBuat } from "@/features/transaksi/modul";
import type { ModulTx, RingkasanModul } from "@/api/types";

// TRANSAKSI — pintu ke semua modul S6–S8 (Pengeluaran, Pembelian, Kasbon, Pemasukan Lain, Piutang, Refund, Tagihan, Supplier, Pembayaran supplier)
// dan ke Pembayaran pelanggan (S5). Angka lencana dari server; tidak ada data tandingan di klien.

function lencana(r: RingkasanModul | undefined, m: ModulTx): { n: number; teks: string } | null {
  const x = r?.[m];
  if (!x) return null;
  const n = x.menunggu ?? x.aktif ?? 0;
  if (!n) return null;
  return { n, teks: x.menunggu != null ? `${n} menunggu` : `${n} aktif` };
}

function Transaksi() {
  const { colors } = useTheme();
  const online = useOnline();
  const router = useRouter();
  const caps = useSession((s) => s.capabilities);
  const bayarMenunggu = usePembayaranLencana().data ?? 0;
  const ringkasan = useRingkasanModul();

  return (
    <Screen refreshing={ringkasan.isRefetching} onRefresh={() => void ringkasan.refetch()}>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26, marginBottom: 4 }}>{S.transaksi.judul}</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, marginBottom: 14 }}>Semua data dan status resmi datang dari server.</Text>

      <PressableScale onPress={() => router.push("/pembayaran")} accessibilityLabel={`Pembayaran pelanggan${bayarMenunggu > 0 ? `, ${bayarMenunggu} menunggu verifikasi` : ""}`} style={{ marginBottom: 10 }}>
        <GlassCard padding={14}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <IconCircle icon={ReceiptText} tone="info" size={40} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15 }}>Pembayaran pelanggan</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{bayarMenunggu > 0 ? `${bayarMenunggu} menunggu verifikasi` : "Verifikasi & status order"}</Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} />
          </View>
        </GlassCard>
      </PressableScale>

      {ringkasan.isError && !ringkasan.data ? (
        <ErrorState judul="Ringkasan belum bisa dimuat" isi="Daftar di bawah tetap bisa dibuka." onCoba={() => void ringkasan.refetch()} />
      ) : null}

      {URUTAN_MODUL.map((m) => {
        const k = KONFIG[m];
        const badge = lencana(ringkasan.data, m);
        const buat = bisaBuat(caps, m);
        return (
          <View key={m} style={{ marginBottom: 10 }}>
            <GlassCard padding={14}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <PressableScale onPress={() => router.push({ pathname: "/tx/[modul]", params: { modul: m } })} accessibilityLabel={`${k.label}${badge ? `, ${badge.teks}` : ""}`} style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <IconCircle icon={k.ikon} tone="info" size={40} />
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15 }}>{k.label}</Text>
                      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: badge ? colors.warning : colors.textMuted, fontFamily: badge ? font.medium : font.regular, fontSize: 12, marginTop: 2 }}>{badge ? badge.teks : k.deskripsi}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} />
                  </View>
                </PressableScale>
                {buat ? (
                  <PressableScale onPress={() => router.push({ pathname: "/tx/[modul]/baru", params: { modul: m } })} accessibilityLabel={`Tambah ${k.tunggal}`} style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }}>
                    <Plus size={20} color={colors.primary} strokeWidth={2} />
                  </PressableScale>
                ) : null}
              </View>
            </GlassCard>
          </View>
        );
      })}
    </Screen>
  );
}

export default denganAkses(Transaksi, "financeRead");
