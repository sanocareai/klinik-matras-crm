import React, { useEffect, useState } from "react";
import { AppState, Linking, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, ErrorState, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { useSession } from "@/auth/session";
import { has, type Need } from "@/auth/capabilities";
import { aktifkanNotifikasi, statusIzin, type StatusIzin } from "@/auth/push";
import { ambilPreferensi, simpanPreferensi, type KategoriNotif } from "@/api/notifikasi";
import { pesanUntukPengguna } from "@/api/errors";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";

// NOTIFIKASI (Lainnya → Notifikasi). Izin sistem diminta DI SINI, oleh pengguna, bukan saat aplikasi dibuka. Notifikasi tidak memuat nominal/nama:
// di layar kunci hanya tampil kalimat umum; rincian ada setelah aplikasi dibuka dan kunci aplikasi terbuka.

const DAFTAR: { id: KategoriNotif; judul: string; isi: string; perlu?: Need }[] = [
  { id: "approval", judul: "Persetujuan", isi: "Pengajuan baru yang menunggu keputusan dan hasil keputusan atas pengajuan Anda." },
  { id: "pembayaran", judul: "Pembayaran", isi: "Pembayaran pelanggan menunggu verifikasi atau ditolak.", perlu: "paymentWrite" },
  { id: "piutang", judul: "Piutang jatuh tempo", isi: "Pengingat piutang pelanggan yang jatuh tempo hari ini atau besok.", perlu: "financeRead" },
  { id: "supplier", judul: "Tagihan supplier jatuh tempo", isi: "Pengingat tagihan supplier yang jatuh tempo hari ini atau besok.", perlu: "financeRead" },
  { id: "sensitif", judul: "Transaksi sensitif", isi: "Pembatalan transaksi oleh admin yang perlu diketahui pemilik/admin keuangan.", perlu: "financeAdmin" },
];

function Notifikasi() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const qc = useQueryClient();
  const caps = useSession((s) => s.capabilities);
  const [izin, setIzin] = useState<StatusIzin>("undetermined");
  const [pesan, setPesan] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["notif-prefs", ENV.useMocks], queryFn: ambilPreferensi, retry: 1 });
  const simpan = useMutation({
    mutationFn: (c: Partial<Record<KategoriNotif, boolean>>) => simpanPreferensi(c),
    onSuccess: (d) => { qc.setQueryData(["notif-prefs", ENV.useMocks], d); setPesan(null); },
    onError: (e) => setPesan(pesanUntukPengguna(e)),
  });

  useEffect(() => {
    void statusIzin().then(setIzin);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void statusIzin().then(setIzin); });
    return () => sub.remove();
  }, []);

  async function aktifkan() {
    const h = await aktifkanNotifikasi();
    setIzin(await statusIzin());
    setPesan(h === "ok" ? null : h === "ditolak" ? "Izin notifikasi ditolak. Anda bisa mengizinkannya lewat Pengaturan HP." : "Notifikasi belum bisa diaktifkan di perangkat ini.");
  }

  const tersedia = izin !== "tidak_tersedia";
  return (
    <Screen>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Lainnya</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, marginBottom: 4 }}>Notifikasi</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginBottom: 12 }}>Hanya hal penting. Tanpa nominal atau nama di layar kunci.</Text>

      {izin !== "granted" ? (
        <GlassCard style={{ marginBottom: 12 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>Notifikasi belum aktif di HP ini</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 4 }}>
            {tersedia ? "Aktifkan supaya Anda tahu ada pengajuan atau pengingat penting. Anda bisa mematikannya kapan saja." : "Perangkat atau build ini belum mendukung notifikasi."}
          </Text>
          {tersedia ? (
            izin === "denied"
              ? <Button label="Buka pengaturan HP" variant="secondary" onPress={() => void Linking.openSettings()} style={{ marginTop: 10 }} />
              : <Button label="Aktifkan notifikasi" onPress={() => void aktifkan()} style={{ marginTop: 10 }} />
          ) : null}
        </GlassCard>
      ) : null}

      {pesan ? <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={{ color: colors.danger, fontFamily: font.medium, fontSize: 12, marginBottom: 10 }}>{pesan}</Text> : null}

      <SectionHeader judul="Kategori" />
      {q.isLoading ? (
        <Skeleton tinggi={200} style={{ borderRadius: 24 }} />
      ) : !q.data ? (
        <ErrorState judul="Preferensi belum bisa dimuat" isi={pesanUntukPengguna(q.error)} onCoba={() => void q.refetch()} />
      ) : (
        <GlassCard padding={4}>
          {DAFTAR.filter((k) => !k.perlu || has(caps, k.perlu)).map((k, i) => (
            <View key={k.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{k.judul}</Text>
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{k.isi}</Text>
              </View>
              <Switch
                accessibilityLabel={`Notifikasi ${k.judul}`} value={q.data.categories[k.id]} disabled={simpan.isPending || !online}
                onValueChange={(v) => simpan.mutate({ [k.id]: v })} trackColor={{ true: colors.primary }}
              />
            </View>
          ))}
        </GlassCard>
      )}
      {q.data && !q.data.pushEnabled ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, marginTop: 10 }}>Pengiriman notifikasi dari server belum diaktifkan. Pilihan Anda tetap tersimpan.</Text> : null}
    </Screen>
  );
}

export default Notifikasi;
