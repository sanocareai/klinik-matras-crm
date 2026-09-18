// Avatar inisial berwarna — port dari mobile/src/components/Avatar.js
// (Sano Messenger), disederhanakan (tidak ada mode "isGroup" — driver app
// tidak punya grup). Kalau avatarUrl (foto profil, User.avatarUrl) ada,
// tampilkan foto asli; fallback ke inisial kalau kosong ATAU gagal dimuat.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { mediaUrl } from "../api";

// Sama persis dengan avatarColors di mobile/src/theme.js — satu sumber
// visual "warna avatar per nama" di seluruh app Klinik Matras (web/
// Messenger/driver), supaya orang yang sama terasa konsisten warnanya
// lintas app walau tiap app punya kode terpisah.
const AVATAR_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#f97316", "#0891b2"];

// initials/avatarColor di-EXPORT (19 September 2026) supaya marker peta
// (components/DriverMapMarker.js) memakai inisial & warna yang SAMA PERSIS
// dengan avatar di kartu — marker tidak bisa memakai komponen ini apa adanya
// karena butuh Image bawaan react-native + callback onLoad (lihat catatan di
// file itu), tapi orang yang sama HARUS tetap berwarna sama di peta & kartu.
export function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

export function avatarColor(name) {
  let hash = 0;
  for (const ch of name || "?") hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function Avatar({ name, avatarUrl = null, size = 48 }) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [avatarUrl]);
  const uri = avatarUrl && !imgError ? mediaUrl(avatarUrl) : null;

  if (uri) {
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
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(name) }]}>
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700" },
});
