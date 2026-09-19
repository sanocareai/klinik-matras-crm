import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTheme } from "./theme";
import { usePrefs } from "./prefs";
import { font } from "./tokens";
import { formatRupiah, formatRupiahRingkas, isNegative, splitRupiah, type Money } from "@/lib/money";

type Ukuran = "hero" | "xl" | "lg" | "md" | "sm";

const UKURAN: Record<Ukuran, { fontSize: number; lineHeight: number; family: string }> = {
  hero: { fontSize: 40, lineHeight: 46, family: font.semibold },
  xl: { fontSize: 28, lineHeight: 34, family: font.semibold },
  lg: { fontSize: 20, lineHeight: 26, family: font.semibold },
  md: { fontSize: 15, lineHeight: 20, family: font.semibold },
  sm: { fontSize: 13, lineHeight: 18, family: font.medium },
};

type Props = {
  value: Money | string;
  size?: Ukuran;
  /** Warna dasar; default = teks tema. */
  color?: string;
  /** Negatif otomatis merah (kecuali `color` diberikan). */
  autoNegatif?: boolean;
  /** Pecahan sen dibuat redup (gaya "8.200,28" pada referensi). */
  redupkanPecahan?: boolean;
  /** Singkat untuk ruang sempit ("Rp 1,2 jt") — HANYA tampilan. */
  ringkas?: boolean;
  /** Paksa sembunyikan (mis. layar kunci) di luar preferensi pengguna. */
  sembunyikan?: boolean;
  /** Kecilkan huruf otomatis agar nominal panjang tidak terpotong (default nyala). */
  muat?: boolean;
  style?: StyleProp<TextStyle>;
};

export function MoneyText({ value, size = "md", color, autoNegatif = false, redupkanPecahan = false, ringkas = false, sembunyikan, muat = true, style }: Props) {
  const { colors } = useTheme();
  const prefSembunyi = usePrefs((s) => s.sembunyikanAngka);
  const u = UKURAN[size];
  const warna = color ?? (autoNegatif && isNegative(value) ? colors.danger : colors.text);
  const dasar: TextStyle = {
    fontFamily: u.family, fontSize: u.fontSize, lineHeight: u.lineHeight, color: warna,
    fontVariant: ["tabular-nums"], includeFontPadding: false,
  };

  // Satu baris + mengecil sampai 60% agar rupiah panjang / font besar tidak terpotong atau membungkus.
  const fit = muat ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.6, maxFontSizeMultiplier: 1.3 } : {};

  if (sembunyikan ?? prefSembunyi) {
    return <Text {...fit} style={[dasar, style]} accessibilityLabel="Nominal disembunyikan">Rp ••••••</Text>;
  }
  if (ringkas) {
    return <Text {...fit} style={[dasar, style]} accessibilityLabel={formatRupiah(value)}>{formatRupiahRingkas(value)}</Text>;
  }
  if (redupkanPecahan) {
    const { negatif, utuh, pecahan } = splitRupiah(value);
    return (
      <Text {...fit} style={[dasar, style]} accessibilityLabel={formatRupiah(value)}>
        {negatif ? "-" : ""}Rp {utuh}
        {pecahan ? <Text style={{ opacity: 0.55 }}>,{pecahan}</Text> : null}
      </Text>
    );
  }
  return <Text {...fit} style={[dasar, style]}>{formatRupiah(value)}</Text>;
}
