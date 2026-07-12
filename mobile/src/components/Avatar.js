// Avatar inisial berwarna — sama gayanya dengan versi web. Kalau avatarUrl
// (foto profil user) tersedia, tampilkan foto asli; fallback ke inisial
// kalau avatarUrl kosong ATAU gagal dimuat (onError) — pola sama dengan
// Avatar.jsx web (imgError state).
import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Users } from "lucide-react-native";
import { initials, avatarColor } from "../utils/format";
import { mediaUrl } from "../api";

export default function Avatar({ name, size = 48, isGroup = false, avatarUrl = null }) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [avatarUrl]);
  const bg = isGroup ? "#6b7280" : avatarColor(name);
  const uri = avatarUrl && !imgError ? mediaUrl(avatarUrl) : null;

  if (uri) {
    // width/height DI SINI sudah proporsional ke `size` (26-72px tergantung
    // caller, bukan angka besar tetap) — RN Image sendiri men-decode ke
    // ukuran render ini, TIDAK menyimpan bitmap penuh di memori.
    // KETERBATASAN YANG BELUM BISA DIPERBAIKI TANPA DEPENDENCY BARU: profil
    // foto WA (profilePictureUrl) datang dari CDN WhatsApp (pps.whatsapp.net)
    // yang TIDAK punya parameter resize publik — file ASLI (bisa >100KB)
    // tetap ke-download penuh lewat network walau tampil kecil di sini,
    // RN Image core tidak bisa cegah itu (beda dari expo-image yang punya
    // downsampling+cache native lebih baik, TAPI itu native module baru →
    // butuh EAS rebuild, sengaja di-hold dulu sampai rebuild berikutnya
    // yang sudah direncanakan bareng Gilang).
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
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
