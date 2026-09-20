import React, { useState } from "react";
import { Linking, Text, View } from "react-native";
import { EyeOff, FileText, Paperclip, TriangleAlert } from "lucide-react-native";
import { GlassCard } from "@/design/GlassCard";
import { Button } from "@/design/ui";
import { useSamarkan } from "@/design/Samarkan";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { urlMedia } from "@/api/approvals";
import { GaleriLampiran } from "@/features/persetujuan/LampiranRiwayat";
import type { BuktiBayar } from "@/api/types";

// BUKTI PEMBAYARAN — hanya tautan bertanda-tangan berumur pendek dari server (gambar/PDF). Gambar memakai galeri yang sama dengan
// lampiran persetujuan (tampil di dalam aplikasi, layar penuh). PDF dibuka di penampil bawaan perangkat lewat tautan bertanda-tangan
// (tidak diunduh ke penyimpanan aplikasi). Bila "Sembunyikan nominal" aktif, bukti (memuat nama & angka) ikut disembunyikan.

const kedaluwarsa = (b: BuktiBayar) => !!b.kedaluwarsa && Date.parse(b.kedaluwarsa) <= Date.now();

export function BuktiPembayaran({ bukti, ada, tunai, onMuatUlang }: { bukti: BuktiBayar | null; ada: boolean; tunai: boolean; onMuatUlang: () => void }) {
  const { colors } = useTheme();
  const samar = useSamarkan();
  const [pesan, setPesan] = useState<string | null>(null);

  const kartu = (ikon: React.ReactNode, isi: string, aksi?: React.ReactNode) => (
    <GlassCard variant="flat">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {ikon}
        <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{isi}</Text>
      </View>
      {aksi}
    </GlassCard>
  );

  if (!ada || !bukti) {
    return kartu(<TriangleAlert size={22} color={colors.warning} strokeWidth={1.75} />, tunai ? "Pembayaran tunai — tidak ada foto bukti." : "Belum ada bukti pembayaran terlampir.");
  }
  if (samar) {
    return (
      <View accessible accessibilityLabel="Bukti pembayaran disembunyikan">
        {kartu(<EyeOff size={22} color={colors.textMuted} strokeWidth={1.75} />, "Bukti disembunyikan. Matikan “Sembunyikan angka” di Beranda untuk melihatnya.")}
      </View>
    );
  }
  if (bukti.jenis === "gambar") {
    return <GaleriLampiran lampiran={[{ id: "bukti", jenis: "foto", url: bukti.url, thumbUrl: bukti.thumbUrl, kedaluwarsa: bukti.kedaluwarsa }]} ada onMuatUlang={onMuatUlang} />;
  }
  if (bukti.jenis === "pdf" && bukti.url) {
    const buka = async () => {
      // Tautan bertanda-tangan berumur 10 menit: yang sudah lewat diganti dulu dengan detail terbaru dari server.
      if (kedaluwarsa(bukti)) { setPesan("Tautan bukti sudah kedaluwarsa. Detail dimuat ulang — ketuk “Buka PDF” sekali lagi."); onMuatUlang(); return; }
      setPesan(null);
      try { await Linking.openURL(urlMedia(bukti.url as string)); } catch { setPesan("PDF tidak bisa dibuka. Pastikan ada aplikasi penampil PDF, lalu coba lagi."); }
    };
    return kartu(
      <FileText size={22} color={colors.primary} strokeWidth={1.75} />, "Bukti berupa berkas PDF.",
      <View style={{ marginTop: 12 }}>
        <Button label="Buka PDF" variant="ghost" onPress={() => { void buka(); }} />
        {pesan ? <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.regular, fontSize: 12, marginTop: 8 }}>{pesan}</Text> : null}
      </View>,
    );
  }
  return kartu(<Paperclip size={22} color={colors.textMuted} strokeWidth={1.75} />, "Bukti ada, tetapi hanya bisa dibuka di web.");
}
