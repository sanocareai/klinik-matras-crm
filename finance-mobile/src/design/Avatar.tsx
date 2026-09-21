import React, { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "./theme";
import { font } from "./tokens";
import { alamatAvatar, inisial } from "@/lib/avatar";

/** Foto profil bulat; bila belum ada atau gagal dimuat → lingkaran berinisial (tidak pernah kosong/rusak). */
export function Avatar({ nama, avatarUrl, ukuran = 48 }: { nama: string | null | undefined; avatarUrl?: string | null; ukuran?: number }) {
  const { colors } = useTheme();
  const [gagal, setGagal] = useState<string | null>(null);
  const uri = alamatAvatar(avatarUrl);
  const tampil = uri && gagal !== uri;
  return (
    <View
      accessible accessibilityRole="image" accessibilityLabel={tampil ? `Foto profil ${nama ?? ""}` : `Inisial ${nama ?? ""}`}
      style={{ width: ukuran, height: ukuran, borderRadius: ukuran / 2, overflow: "hidden", backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}
    >
      {tampil ? (
        <Image source={{ uri }} style={{ width: ukuran, height: ukuran }} contentFit="cover" transition={150} onError={() => setGagal(uri)} recyclingKey={uri} />
      ) : (
        <Text maxFontSizeMultiplier={1.2} style={{ color: colors.onPrimary, fontFamily: font.semibold, fontSize: Math.round(ukuran * 0.38) }}>{inisial(nama)}</Text>
      )}
    </View>
  );
}
