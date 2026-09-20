import React, { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Search, X, type LucideIcon } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Chip, EmptyState, ErrorState, IconCircle, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useTransaksi, BelumTersedia } from "@/hooks/data";
import { usePembayaranLencana } from "@/hooks/pembayaran";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { tanggalPendek } from "@/lib/dates";
import { S } from "@/lib/strings";
import type { TransaksiItem } from "@/api/types";
import { denganAkses } from "@/features/guard/RequireCapability";

type Segmen = "terbukukan" | "pengeluaran" | "pembelian" | "kasbon" | "pembayaran";
const SEGMEN: { id: Segmen; label: string }[] = [
  { id: "terbukukan", label: S.transaksi.segmen.terbukukan },
  { id: "pengeluaran", label: S.transaksi.segmen.pengeluaran },
  { id: "pembelian", label: S.transaksi.segmen.pembelian },
  { id: "kasbon", label: S.transaksi.segmen.kasbon },
  { id: "pembayaran", label: S.transaksi.segmen.pembayaran },
];

const JENIS_DARI_SEGMEN: Record<Segmen, TransaksiItem["jenis"]> = {
  terbukukan: "jurnal", pengeluaran: "pengeluaran", pembelian: "pembelian", kasbon: "kasbon", pembayaran: "pembayaran",
};

const IKON: Record<TransaksiItem["arah"], LucideIcon> = { keluar: ArrowUpRight, masuk: ArrowDownLeft, netral: ArrowLeftRight };

/** Normalisasi pencarian: "150.000" cocok dengan 150000 (perilaku web `cocok()`), tak sensitif huruf besar-kecil. */
function cocok(q: string, ...isi: string[]): boolean {
  const kata = q.trim().toLowerCase().split(/\s+/).filter(Boolean).map((k) => (/^[\d.]+$/.test(k) ? k.replace(/\./g, "") : k));
  if (kata.length === 0) return true;
  const gudang = isi.join(" ").toLowerCase();
  return kata.every((k) => gudang.includes(k));
}

function Transaksi() {
  const { colors } = useTheme();
  const online = useOnline();
  const router = useRouter();
  const [segmen, setSegmen] = useState<Segmen>("pengeluaran");
  const bayarMenunggu = usePembayaranLencana().data ?? 0;
  const [q, setQ] = useState("");
  const { data, isLoading, isError, error, refetch, isRefetching } = useTransaksi();

  const tampil = useMemo(
    () => (data ?? []).filter((t) => t.jenis === JENIS_DARI_SEGMEN[segmen]).filter((t) => cocok(q, t.nomor, t.judul, t.sub, t.amount.replace(/\.\d+$/, ""))),
    [data, segmen, q],
  );
  const jumlahPerSegmen = (id: Segmen) => (id === "pembayaran" ? bayarMenunggu : (data ?? []).filter((t) => t.jenis === JENIS_DARI_SEGMEN[id]).length);

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26, marginBottom: 12 }}>{S.transaksi.judul}</Text>

      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 48, borderRadius: radius.button, paddingHorizontal: 14, gap: 8, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke }}>
        <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
        <TextInput
          value={q} onChangeText={setQ} placeholder={S.transaksi.cariPlaceholder} placeholderTextColor={colors.textFaint}
          style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, minHeight: 44 }} accessibilityLabel={S.umum.cari} returnKeyType="search"
        />
        {q ? (
          <PressableScale onPress={() => setQ("")} accessibilityLabel="Hapus pencarian" hitSlop={10}>
            <X size={18} color={colors.textMuted} strokeWidth={1.75} />
          </PressableScale>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
        {SEGMEN.map((s) => (
          <Chip key={s.id} label={s.label} aktif={segmen === s.id && s.id !== "pembayaran"} onPress={() => (s.id === "pembayaran" ? router.push("/pembayaran") : setSegmen(s.id))} jumlah={jumlahPerSegmen(s.id)} />
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={{ gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} tinggi={72} style={{ borderRadius: radius.card }} />)}</View>
      ) : isError ? (
        <ErrorState
          judul={error instanceof BelumTersedia ? S.segera : "Transaksi belum bisa dimuat"}
          isi={error instanceof BelumTersedia ? S.segeraIsi : error instanceof Error ? error.message : undefined}
          onCoba={error instanceof BelumTersedia ? undefined : () => void refetch()}
        />
      ) : tampil.length === 0 ? (
        <EmptyState judul={S.transaksi.kosongJudul} isi={S.transaksi.kosongIsi} aksi={q ? S.umum.aturUlang : undefined} onAksi={() => setQ("")} />
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{tampil.length} dari {jumlahPerSegmen(segmen)} transaksi</Text>
          {tampil.map((t) => (
            <GlassCard key={t.id} padding={14}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <IconCircle icon={IKON[t.arah]} tone={t.arah === "masuk" ? "success" : t.arah === "keluar" ? "warning" : "info"} size={40} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>{t.judul}</Text>
                  <Text numberOfLines={1} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{t.sub}</Text>
                  <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 2 }}>{t.nomor} · {tanggalPendek(t.tanggal)}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <MoneyText value={t.amount} size="md" color={t.arah === "masuk" ? colors.success : colors.text} />
                  <StatusBadge status={t.status} />
                </View>
              </View>
            </GlassCard>
          ))}
        </View>
      )}
    </Screen>
  );
}

export default denganAkses(Transaksi, "financeRead");
