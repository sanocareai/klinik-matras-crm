// Marker driver/helper di Live Tracking — REVISI KE-2 (19 September 2026).
//
// RIWAYAT KEGAGALAN — dicatat panjang supaya tidak ada yang mencoba
// mengulang jalur yang sama:
//   Percobaan 1: children biasa (View+Image) di dalam <Marker>, react-
//   native-maps Android men-SNAPSHOT hasil render children itu jadi bitmap
//   sekali (dikontrol lewat prop tracksViewChanges). Gejala: lingkaran
//   kosong. Diagnosis pertama: Android "view flattening" menghapus View/
//   Image yang dianggap presentasional dari native tree sebelum snapshot
//   sempat diambil → fix: collapsable={false} di semua pembungkus.
//   Percobaan 2: gejala SAMA tetap muncul ("masih circle putih stroke").
//   Diagnosis kedua: <Image> bawaan React Native di Android diam-diam
//   memberi animasi fade-in ~300ms ke gambar network — snapshot yang
//   diambil sebelum fade selesai menangkap frame TRANSPARAN. Fix:
//   fadeDuration={0} + jeda snapshot dinaikkan.
//   MASIH gagal di lapangan. Kesimpulan: masalahnya BUKAN satu race
//   condition spesifik yang bisa ditambal satu-satu — snapshot native
//   Android utk children Marker pada dasarnya BERPACU dengan proses async
//   apa pun di dalamnya (network, decode, commit bitmap lintas-bridge),
//   dan tidak ada jumlah tambal-timing yang menjamin menang setiap saat di
//   HP manapun.
//
// PENDEKATAN INI TIDAK MENYENTUH children Marker sama sekali kalau ada
// foto — pakai prop `icon` yang dimuat SENDIRI oleh Google Maps SDK
// sebagai bitmap NATIF, bukan snapshot JS view. Tidak ada race condition
// apa pun karena tidak ada view JS yang perlu "sempat" digambar. Satu
// syarat react-native-maps (react-native-maps/dist/src/MapMarker.d.ts):
// `icon` HANYA menerima file LOKAL, bukan https URL langsung — makanya
// foto diproses dulu lewat lib/localImageCache.js (unduh + resize jadi
// file lokal) sebelum dipakai di sini.
//
// TRADE-OFF YANG DITERIMA SADAR: ikon native ini TIDAK bisa dibuat
// lingkaran/diberi border seperti Avatar di kartu (itu perlu masking alpha
// channel — sharp di backend atau Skia di app, dua-duanya di luar cakupan
// perbaikan bug ini) — hasilnya foto PERSEGI polos. Diterima karena tujuan
// utamanya "admin tahu siapa driver-nya sekilas lihat" tetap tercapai,
// dan keandalan (tidak pernah blank) lebih penting daripada kecantikan
// bentuk untuk fitur yang baru saja gagal 2x. Kartu di bawah peta TETAP
// pakai Avatar bulat biasa (components/Avatar.js, expo-image) — TIDAK
// terdampak sama sekali, itu bukan children Marker.
//
// Kalau driver+helper SAMA-SAMA punya foto, cuma SATU yang dipakai (foto
// TIDAK bisa digabung dua wajah dalam satu ikon native tanpa compositing
// terpisah) — driver diutamakan, fallback ke foto helper kalau driver
// belum pasang foto. Ini beda dari kartu di bawah peta yang tetap
// menampilkan foto KEDUANYA (itu View biasa, tidak lewat jalur ini).
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Marker } from "react-native-maps";
import { getLocalAvatarIconUri } from "../lib/localImageCache";
import { initials, avatarColor } from "./Avatar";

export default function VehicleMarker({ coordinate, title, description, driverName, helperName, driverAvatarUrl, helperAvatarUrl, zIndex }) {
  const avatarUrlUtama = driverAvatarUrl || helperAvatarUrl || null;
  const namaUtama = driverName || helperName || "?";
  const [localUri, setLocalUri] = useState(null);

  useEffect(() => {
    let batal = false;
    setLocalUri(null); // reset dulu — kalau foto berganti, jangan sempat tampilkan foto LAMA sambil menunggu yang baru siap
    if (!avatarUrlUtama) return undefined;
    getLocalAvatarIconUri(avatarUrlUtama).then((uri) => { if (!batal) setLocalUri(uri); });
    return () => { batal = true; };
  }, [avatarUrlUtama]);

  if (localUri) {
    return (
      <Marker
        coordinate={coordinate}
        title={title}
        description={description}
        icon={{ uri: localUri }}
        anchor={{ x: 0.5, y: 0.5 }}
        zIndex={zIndex}
      />
    );
  }

  // Belum ada foto (belum pernah pasang, masih diproses, atau gagal) —
  // dot inisial berwarna. TANPA Image sama sekali, jadi snapshot-nya
  // (tracksViewChanges) aman — tidak ada apa pun yang async di sini.
  return (
    <Marker
      coordinate={coordinate}
      title={title}
      description={description}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={zIndex}
    >
      <View style={[styles.dot, { backgroundColor: avatarColor(namaUtama) }]}>
        <Text style={styles.inisial}>{initials(namaUtama)}</Text>
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  inisial: { color: "#fff", fontWeight: "700", fontSize: 12 },
});
