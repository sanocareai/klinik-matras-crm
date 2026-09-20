import React, { useState } from "react";
import { Image, Modal, Text, View } from "react-native";
import { EyeOff, ImageOff, Paperclip, TriangleAlert, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCard } from "@/design/GlassCard";
import { PressableScale } from "@/design/ui";
import { TeksSensitif, useSamarkan } from "@/design/Samarkan";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { urlMedia } from "@/api/approvals";
import { waktuLengkap } from "@/lib/dates";
import type { LampiranApproval, RiwayatApproval } from "@/api/types";

// LAMPIRAN — hanya tautan bertanda-tangan berumur pendek dari server (tidak ada URL luar). Bila "Sembunyikan nominal" aktif,
// foto (nota memuat nama & angka) ikut disembunyikan. Foto yang gagal dimuat (mis. tautan kedaluwarsa) menawarkan muat ulang detail.

const sumber = (jalur: string) => (jalur.startsWith("data:") ? jalur : urlMedia(jalur));

export function GaleriLampiran({ lampiran, ada, onMuatUlang }: { lampiran: LampiranApproval[]; ada: boolean; onMuatUlang: () => void }) {
  const { colors } = useTheme();
  const samar = useSamarkan();
  const [besar, setBesar] = useState<string | null>(null);
  const [gagal, setGagal] = useState<Record<string, boolean>>({});
  const insets = useSafeAreaInsets();

  if (!ada && lampiran.length === 0) {
    return (
      <GlassCard variant="flat">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TriangleAlert size={22} color={colors.warning} strokeWidth={1.75} />
          <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Tidak ada lampiran pada dokumen ini.</Text>
        </View>
      </GlassCard>
    );
  }
  if (samar) {
    return (
      <GlassCard variant="flat">
        <View accessible accessibilityLabel="Lampiran disembunyikan" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <EyeOff size={22} color={colors.textMuted} strokeWidth={1.75} />
          <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>Lampiran disembunyikan. Matikan “Sembunyikan angka” di Beranda untuk melihatnya.</Text>
        </View>
      </GlassCard>
    );
  }
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {lampiran.map((l, i) => {
          const uri = l.thumbUrl ?? l.url;
          if (!uri) {
            return (
              <View key={l.id} accessible accessibilityLabel="Lampiran tidak bisa ditampilkan di aplikasi" style={{ width: 132, minHeight: 132, borderRadius: radius.small, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.solidAlt, alignItems: "center", justifyContent: "center", padding: 10, gap: 6 }}>
                <Paperclip size={22} color={colors.textMuted} strokeWidth={1.75} />
                <Text maxFontSizeMultiplier={1.2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11, textAlign: "center" }}>Lampiran ada, tetapi hanya bisa dibuka di web</Text>
              </View>
            );
          }
          if (gagal[l.id]) {
            return (
              <PressableScale key={l.id} onPress={() => { setGagal({}); onMuatUlang(); }} accessibilityLabel="Foto gagal dimuat. Ketuk untuk memuat ulang" style={{ width: 132, height: 132, borderRadius: radius.small, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.solidAlt, alignItems: "center", justifyContent: "center", padding: 10, gap: 6 }}>
                <ImageOff size={24} color={colors.warning} strokeWidth={1.75} />
                <Text maxFontSizeMultiplier={1.2} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 11, textAlign: "center" }}>Gagal dimuat — ketuk untuk coba lagi</Text>
              </PressableScale>
            );
          }
          return (
            <PressableScale key={l.id} onPress={() => setBesar(l.url ?? uri)} accessibilityLabel={`Buka foto lampiran ${i + 1}`}>
              <Image
                source={{ uri: sumber(uri) }} onError={() => setGagal((g) => ({ ...g, [l.id]: true }))} resizeMode="cover" accessibilityIgnoresInvertColors
                style={{ width: 132, height: 132, borderRadius: radius.small, backgroundColor: colors.neutralSoft, borderWidth: 1, borderColor: colors.hairline }}
              />
            </PressableScale>
          );
        })}
      </View>
      <Modal visible={besar != null} transparent animationType="fade" onRequestClose={() => setBesar(null)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", paddingTop: insets.top, paddingBottom: insets.bottom }}>
          {besar ? <Image source={{ uri: sumber(besar) }} resizeMode="contain" style={{ width: "100%", height: "80%" }} accessibilityLabel="Foto lampiran ukuran penuh" /> : null}
          <PressableScale onPress={() => setBesar(null)} accessibilityLabel="Tutup foto" style={{ position: "absolute", top: insets.top + 12, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
            <X size={22} color="#FFFFFF" strokeWidth={2} />
          </PressableScale>
        </View>
      </Modal>
    </>
  );
}

// ─── Riwayat ───────────────────────────────────────────────────────────────────────────────
export function LinimasaRiwayat({ riwayat }: { riwayat: RiwayatApproval[] }) {
  const { colors } = useTheme();
  if (riwayat.length === 0) return null;
  return (
    <GlassCard>
      {riwayat.map((r, i) => {
        const terakhir = i === riwayat.length - 1;
        return (
          <View key={`${r.waktu}-${i}`} accessible accessibilityLabel={`${r.label}${r.oleh ? ` oleh ${r.oleh}` : ""}, ${waktuLengkap(r.waktu)}`} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ alignItems: "center", width: 14 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: r.peristiwa === "DOCUMENT_REJECTED" ? colors.danger : r.peristiwa === "DOCUMENT_APPROVED" ? colors.success : colors.primary }} />
              {!terakhir ? <View style={{ flex: 1, width: 2, backgroundColor: colors.hairline, marginTop: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: terakhir ? 0 : 14 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14 }}>{r.label}{r.oleh ? ` · ${r.oleh}` : ""}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 1 }}>{waktuLengkap(r.waktu)}</Text>
              {r.catatan ? <TeksSensitif maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.regular, fontSize: 13, lineHeight: 18, marginTop: 4 }}>“{r.catatan}”</TeksSensitif> : null}
            </View>
          </View>
        );
      })}
    </GlassCard>
  );
}
