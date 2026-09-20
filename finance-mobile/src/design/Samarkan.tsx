import React from "react";
import { Text, type TextProps } from "react-native";
import { usePrefs } from "./prefs";

// "Sembunyikan nominal" juga menyamarkan teks sensitif (nama pelanggan/vendor, keterangan, alasan, catatan) — bukan hanya angka.
// Samaran berpanjang tetap (tidak membocorkan panjang teks aslinya) dan dibaca "Disamarkan" oleh pembaca layar.

export const SAMARAN = "•••••• ••••";

export function useSamarkan(): boolean {
  return usePrefs((s) => s.sembunyikanAngka);
}

export function TeksSensitif({ children, ...rest }: TextProps & { children?: React.ReactNode }) {
  const samar = useSamarkan();
  if (samar) {
    return <Text {...rest} accessibilityLabel="Disamarkan">{SAMARAN}</Text>;
  }
  return <Text {...rest}>{children}</Text>;
}

/** Untuk nilai yang dipakai di luar <Text> (mis. label aksesibilitas): kembalikan samaran bila mode sembunyi aktif. */
export function samarkanBila(samar: boolean, teks: string | null | undefined): string {
  return samar ? SAMARAN : teks ?? "";
}
