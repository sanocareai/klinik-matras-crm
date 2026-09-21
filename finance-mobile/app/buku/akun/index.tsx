import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Chip, EmptyState, MockBanner, OfflineBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useAkun } from "@/hooks/buku";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { periodePreset } from "@/lib/periode";
import { denganAkses } from "@/features/guard/RequireCapability";
import { GalatPenuh } from "@/features/umum/StatusData";
import { periodeBuku } from "@/features/buku/Bagian";

function useDebounce<T>(nilai: T, ms: number): T {
  const [v, setV] = useState(nilai);
  useEffect(() => { const t = setTimeout(() => setV(nilai), ms); return () => clearTimeout(t); }, [nilai, ms]);
  return v;
}

const LABEL_TIPE: Record<string, string> = { ASET: "Aset", KEWAJIBAN: "Kewajiban", EKUITAS: "Ekuitas", PENDAPATAN: "Pendapatan", BEBAN_POKOK: "Beban pokok", BEBAN: "Beban" };

function PilihAkun() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const [cari, setCari] = useState("");
  const q = useDebounce(cari, 350);
  const [periodeId, setPeriodeId] = useState<string>(periodePreset()[0]?.id ?? "bulan-ini");
  const akun = useAkun(q);
  const periode = periodeBuku().find((p) => p.id === periodeId) ?? periodePreset()[0];

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1 }}>
        <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4, minHeight: 44 }}>
          <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
          <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Kembali</Text>
        </PressableScale>
        {ENV.useMocks ? <MockBanner /> : null}
        {!online ? <OfflineBanner /> : null}
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, marginBottom: 4 }}>Buku Besar</Text>
        <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 10 }}>Pilih periode lalu akun. Saldo awal, mutasi, dan saldo berjalan dihitung server.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 10 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {periodeBuku().map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={periodeId === p.id} onPress={() => setPeriodeId(p.id)} />)}
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: radius.button, backgroundColor: colors.glassFillStrong, borderWidth: 1, borderColor: colors.glassStroke, marginBottom: 12 }}>
          <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
          <TextInput value={cari} onChangeText={setCari} placeholder="Cari kode atau nama akun…" placeholderTextColor={colors.textFaint} accessibilityLabel="Cari akun" autoCorrect={false} autoCapitalize="none" maxFontSizeMultiplier={1.4}
            style={{ flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, paddingVertical: 8 }} />
          {cari.length > 0 ? <PressableScale onPress={() => setCari("")} accessibilityLabel="Hapus pencarian" style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><X size={18} color={colors.textMuted} strokeWidth={1.75} /></PressableScale> : null}
        </View>

        {akun.isLoading && !akun.data ? (
          <View style={{ gap: 10 }} accessibilityLabel="Memuat daftar akun">{[0, 1, 2, 3].map((i) => <Skeleton key={i} tinggi={60} style={{ borderRadius: 20 }} />)}</View>
        ) : !akun.data ? (
          <GalatPenuh error={akun.error} online={online} onCoba={() => void akun.refetch()} nama="Daftar akun" />
        ) : (
          <FlatList
            data={akun.data} keyExtractor={(a) => a.id} contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            ListHeaderComponent={akun.isFetching ? <ActivityIndicator style={{ marginBottom: 8 }} color={colors.primary} accessibilityLabel="Memuat" /> : null}
            ListEmptyComponent={<EmptyState judul="Akun tidak ditemukan" isi="Ubah kata kunci pencarian." />}
            renderItem={({ item }) => (
              <PressableScale onPress={() => router.push({ pathname: "/buku/akun/[id]", params: { id: item.id, from: periode?.from ?? "", to: periode?.to ?? "" } })} accessibilityLabel={`Akun ${item.code} ${item.name}, ${LABEL_TIPE[item.type] ?? item.type}. Buka buku besar`} style={{ marginBottom: 10 }}>
                <GlassCard padding={14}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>{item.code} {item.name}</Text>
                      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{LABEL_TIPE[item.type] ?? item.type} · saldo normal {item.normalBalance === "DEBIT" ? "debit" : "kredit"}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textMuted} strokeWidth={1.75} />
                  </View>
                </GlassCard>
              </PressableScale>
            )}
          />
        )}
      </View>
    </Screen>
  );
}

export default denganAkses(PilihAkun, "financeRead");
