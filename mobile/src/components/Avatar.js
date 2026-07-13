// Avatar inisial berwarna — sama gayanya dengan versi web. Kalau avatarUrl
// (foto profil user) tersedia, tampilkan foto asli; fallback ke inisial
// kalau avatarUrl kosong ATAU gagal dimuat (onError) — pola sama dengan
// Avatar.jsx web (imgError state).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Users } from "lucide-react-native";
import { initials, avatarColor } from "../utils/format";
import { mediaUrl } from "../api";

export default function Avatar({ name, size = 48, isGroup = false, avatarUrl = null }) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [avatarUrl]);
  const bg = isGroup ? "#6b7280" : avatarColor(name);
  const uri = avatarUrl && !imgError ? mediaUrl(avatarUrl) : null;

  if (uri) {
    // expo-image: downsampling + cache native (memory+disk) — jauh lebih
    // ringan dari RN Image core buat list avatar yang di-scroll terus-
    // terusan (Inbox, Pipeline Board), dan tetap membantu kasus foto profil
    // WA (profilePictureUrl dari CDN pps.whatsapp.net, tidak ada parameter
    // resize publik, file asli tetap ke-download penuh sekali lewat network
    // — tapi cache disk di sini cegah re-download tiap kali avatar yang
    // sama muncul lagi di list/scroll berikutnya).
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        cachePolicy="memory-disk"
        transition={150}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      {isGroup ? (
        <Users size={size * 0.5} color="#fff" strokeWidth={2} />
      ) : (
        <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700" },
});
