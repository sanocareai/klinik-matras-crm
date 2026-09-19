import React, { useState } from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Image as ImageIcon, TriangleAlert } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { StatusBadge } from "@/design/StatusBadge";
import { Sheet } from "@/design/Sheet";
import { Button, EmptyState, ErrorState, MockBanner, PressableScale, Skeleton } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { useApprovals, BelumTersedia } from "@/hooks/data";
import { ENV } from "@/lib/env";
import { tanggalPendek } from "@/lib/dates";
import { S } from "@/lib/strings";
import { denganAkses } from "@/features/guard/RequireCapability";
import { jalankanPerintah, StepUpDibatalkan } from "@/api/command";
import { AksesDitolak } from "@/auth/capabilities";

function Baris({ label, isi }: { label: string; isi: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 9 }}>
      <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 13, flexShrink: 1, textAlign: "right" }}>{isi}</Text>
    </View>
  );
}

function DetailPersetujuan() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useApprovals();
  const [tolak, setTolak] = useState(false);
  const [alasan, setAlasan] = useState("");

  const item = data?.find((a) => a.id === id);

  // Keputusan lewat jalankanPerintah: capability guard + step-up (biometrik/PIN) + Idempotency-Key. Di scaffold ini
  // hanya simulasi (mode contoh); versi nyata: POST /api/finance/{jenis}/:id/approve (slice S4).
  async function eksekusiSetuju() {
    try {
      await jalankanPerintah({
        need: "financeApprove",
        stepUp: true,
        run: async () => {
          if (!ENV.useMocks) throw new BelumTersedia("Persetujuan");
          haptic.sukses();
          router.back();
        },
      });
    } catch (e) {
      if (e instanceof StepUpDibatalkan) return;
      haptic.galat();
      Alert.alert("Belum bisa menyetujui", e instanceof AksesDitolak || e instanceof BelumTersedia ? e.message : "Terjadi kesalahan. Coba lagi.");
    }
  }

  function setuju() {
    Alert.alert(
      "Setujui pengajuan?",
      ENV.useMocks ? "Ini mode contoh — tidak ada data yang berubah." : "Persetujuan akan dicatat atas nama Anda.",
      [
        { text: S.umum.batal, style: "cancel" },
        { text: "Setujui", onPress: () => { void eksekusiSetuju(); } },
      ],
    );
  }

  return (
    <Screen>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>{S.persetujuan.judul}</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}

      {isLoading ? (
        <View style={{ gap: 12 }}><Skeleton tinggi={90} style={{ borderRadius: radius.card }} /><Skeleton tinggi={220} style={{ borderRadius: radius.card }} /></View>
      ) : isError ? (
        <ErrorState
          judul={error instanceof BelumTersedia ? S.segera : "Belum bisa dimuat"}
          isi={error instanceof BelumTersedia ? S.segeraIsi : undefined}
          onCoba={error instanceof BelumTersedia ? undefined : () => void refetch()}
        />
      ) : !item ? (
        <EmptyState judul="Sudah tidak menunggu" isi="Pengajuan ini mungkin sudah diputuskan orang lain." aksi="Kembali" onAksi={() => router.back()} />
      ) : (
        <>
          <Text style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 13 }}>{S.persetujuan.jenis[item.jenis] ?? item.jenis} · {item.nomor}</Text>
          <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, lineHeight: 28, marginTop: 6 }}>{item.keterangan}</Text>
          <View style={{ marginTop: 12 }}><MoneyText value={item.amount} size="xl" /></View>
          <View style={{ marginTop: 10 }}><StatusBadge status="MENUNGGU_APPROVAL" /></View>

          <GlassCard style={{ marginTop: 18 }}>
            <Baris label="Diajukan oleh" isi={item.diajukanOleh} />
            <Baris label="Tanggal" isi={tanggalPendek(item.tanggal)} />
            {item.kategori ? <Baris label="Kategori" isi={item.kategori} /> : null}
            {item.divisi ? <Baris label="Divisi" isi={item.divisi} /> : null}
            {item.mode ? <Baris label="Cara bayar" isi={item.mode === "LANGSUNG" ? "Langsung dari kas/bank" : item.mode === "REIMBURSEMENT" ? "Reimbursement (ditalangi)" : "Utang"} /> : null}
          </GlassCard>

          <GlassCard variant="flat" style={{ marginTop: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {item.adaBukti ? <ImageIcon size={22} color={colors.primary} strokeWidth={1.75} /> : <TriangleAlert size={22} color={colors.warning} strokeWidth={1.75} />}
              <Text style={{ flex: 1, color: item.adaBukti ? colors.text : colors.warning, fontFamily: font.medium, fontSize: 13 }}>
                {item.adaBukti ? "Foto bukti terlampir (penampil foto di slice S4)" : "Belum ada foto bukti. Server bisa menolak persetujuan bila nota wajib."}
              </Text>
            </View>
          </GlassCard>

          {!item.bolehDisetujuiSaya ? (
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 14, lineHeight: 17 }}>
              Ini pengajuan Anda sendiri. Persetujuan harus dari orang lain supaya ada pemisahan tugas.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", gap: 12, marginTop: 22 }}>
              <Button label={S.persetujuan.tolak} variant="danger" onPress={() => setTolak(true)} style={{ flex: 1 }} />
              <Button label={S.persetujuan.setujui} onPress={setuju} style={{ flex: 1 }} />
            </View>
          )}

          <Sheet visible={tolak} onClose={() => setTolak(false)} judul="Tolak pengajuan" sub="Tulis alasannya. Pengaju akan melihat alasan ini.">
            <TextInput
              value={alasan} onChangeText={setAlasan} multiline placeholder="Contoh: nota tidak terbaca, mohon unggah ulang"
              placeholderTextColor={colors.textFaint} accessibilityLabel="Alasan penolakan"
              style={{ minHeight: 96, textAlignVertical: "top", color: colors.text, fontFamily: font.regular, fontSize: 15, padding: 12, borderRadius: radius.button, backgroundColor: colors.solidAlt, borderWidth: 1, borderColor: colors.hairline }}
            />
            <Button
              label="Tolak pengajuan" variant="danger" disabled={alasan.trim().length < 3} style={{ marginTop: 14 }}
              onPress={() => { haptic.galat(); setTolak(false); setAlasan(""); router.back(); }}
            />
          </Sheet>
        </>
      )}
    </Screen>
  );
}

export default denganAkses(DetailPersetujuan, "financeApprove");
