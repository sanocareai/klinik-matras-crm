import React, { useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { Delete, Fingerprint } from "lucide-react-native";
import { useTheme } from "@/design/theme";
import { PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { PIN_LENGTH } from "@/auth/pin";

// PAPAN PIN 6 digit. Tidak menyimpan/mencatat PIN di mana pun selain state lokal komponen ini
// (dihapus begitu selesai dikirim ke `onSelesai`). Tombol ≥ 64 dp; label aksesibilitas Indonesia.

type Props = {
  judul: string;
  sub?: string;
  pesan?: { teks: string; tone: "error" | "info" } | null;
  onSelesai: (pin: string) => void | Promise<void>;
  sibuk?: boolean;
  /** Nonaktifkan papan (mis. saat jeda setelah terlalu banyak salah). */
  nonaktif?: boolean;
  biometrik?: { label: string; onPress: () => void } | null;
};

const BARIS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]];

export function PinPad({ judul, sub, pesan, onSelesai, sibuk, nonaktif, biometrik }: Props) {
  const { colors } = useTheme();
  const [pin, setPin] = useState("");
  const mati = !!sibuk || !!nonaktif;
  // Layar pendek (HP kecil / font besar): tombol & jarak dipadatkan supaya papan tidak terpotong.
  const kecil = useWindowDimensions().height < 720;
  const ukuran = kecil ? 60 : 72;
  const jarakBaris = kecil ? 10 : 14;
  const jarakKolom = kecil ? 18 : 22;

  function tekan(d: string) {
    if (mati || pin.length >= PIN_LENGTH) return;
    haptic.tick();
    const baru = pin + d;
    if (baru.length === PIN_LENGTH) {
      setPin("");
      void onSelesai(baru);
    } else {
      setPin(baru);
    }
  }

  const tombol = (isi: React.ReactNode, onPress: () => void, label: string, testID: string, tampil = true) => (
    <PressableScale
      key={testID}
      onPress={onPress}
      disabled={mati || !tampil}
      accessibilityLabel={label}
      style={{ width: ukuran, height: ukuran, borderRadius: ukuran / 2, alignItems: "center", justifyContent: "center", backgroundColor: tampil ? colors.glassFillStrong : "transparent", borderWidth: tampil ? 1 : 0, borderColor: colors.glassStroke }}
    >
      <View testID={testID} accessible={false} style={{ alignItems: "center", justifyContent: "center" }}>
        {tampil ? isi : null}
      </View>
    </PressableScale>
  );

  return (
    <View style={{ alignItems: "center", width: "100%" }}>
      {/* Tinggi tetap: judul/sub 1 atau 2 baris tidak boleh menggeser papan angka antar langkah. */}
      <View style={{ minHeight: 84, alignItems: "center" }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, textAlign: "center" }}>{judul}</Text>
        {sub ? <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 6 }}>{sub}</Text> : null}
      </View>

      <View style={{ flexDirection: "row", gap: 14, marginTop: 14, marginBottom: 14 }} accessibilityLabel={`${pin.length} dari ${PIN_LENGTH} digit terisi`} accessibilityLiveRegion="polite">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < pin.length ? colors.primary : "transparent", borderWidth: 1.5, borderColor: i < pin.length ? colors.primary : colors.textFaint }} />
        ))}
      </View>

      <View style={{ minHeight: kecil ? 34 : 40, justifyContent: "center", marginBottom: kecil ? 4 : 8 }}>
        {pesan ? (
          <Text accessibilityRole="alert" style={{ color: pesan.tone === "error" ? colors.danger : colors.textMuted, fontFamily: font.medium, fontSize: 13, lineHeight: 18, textAlign: "center" }}>{pesan.teks}</Text>
        ) : null}
      </View>

      <View style={{ gap: jarakBaris }}>
        {BARIS.map((baris) => (
          <View key={baris.join("")} style={{ flexDirection: "row", gap: jarakKolom }}>
            {baris.map((d) => tombol(<Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26 }}>{d}</Text>, () => tekan(d), `Angka ${d}`, `key-${d}`))}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: jarakKolom }}>
          {biometrik
            ? tombol(<Fingerprint size={28} color={colors.primary} strokeWidth={1.75} />, biometrik.onPress, biometrik.label, "key-bio")
            : tombol(null, () => {}, "", "key-kosong", false)}
          {tombol(<Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26 }}>0</Text>, () => tekan("0"), "Angka 0", "key-0")}
          {tombol(<Delete size={26} color={colors.text} strokeWidth={1.75} />, () => { haptic.tick(); setPin((p) => p.slice(0, -1)); }, "Hapus satu digit", "key-back")}
        </View>
      </View>
    </View>
  );
}
