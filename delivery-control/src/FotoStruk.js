import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { biayaArmadaApi, client } from "./client";
import { useTheme } from "./theme";

// Foto struk lewat URL BERTANDA-TANGAN berumur pendek (server: POST /finance/media/sign), bukan Bearer di
// header gambar dan bukan path penyimpanan. Bila URL kedaluwarsa (gambar gagal dimuat) diminta ulang SEKALI
// otomatis; bila tetap gagal tampil pesan + tombol "Coba lagi".
export function FotoStruk({ url, style }) {
  const t = useTheme();
  const [uri, setUri] = useState(null);
  const [status, setStatus] = useState("memuat"); // memuat | siap | gagal
  const sudahUlang = useRef(false);

  const muat = useCallback(async () => {
    setStatus("memuat");
    try {
      const r = await biayaArmadaApi.signMedia([url]);
      const info = r.signed?.[url];
      if (!info) throw new Error("tidak berizin");
      setUri(client.mediaUrl(info.url));
      setStatus("siap");
    } catch {
      setStatus("gagal");
    }
  }, [url]);
  useEffect(() => { sudahUlang.current = false; muat(); }, [muat]);

  if (status === "memuat") return <View style={[style, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={t.accent} /></View>;
  if (status === "gagal") {
    return (
      <View style={[style, { alignItems: "center", justifyContent: "center", gap: 6 }]}>
        <Text style={{ color: t.ink3, fontSize: 13 }}>Foto tidak dapat ditampilkan.</Text>
        <Pressable onPress={muat} accessibilityRole="button"><Text style={{ color: t.accent, fontWeight: "700" }}>Coba lagi</Text></Pressable>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }} style={style} resizeMode="contain" accessibilityLabel="Foto struk"
      onError={() => { if (!sudahUlang.current) { sudahUlang.current = true; muat(); } else setStatus("gagal"); }}
    />
  );
}
