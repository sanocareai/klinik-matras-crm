// Marker peta berisi FOTO driver + helper (19 September 2026, permintaan
// owner: "icon mobil ganti foto driver + helper").
//
// ⚠️ SENGAJA pakai <Image> bawaan react-native, BUKAN <Image> expo-image
// seperti components/Avatar.js. Marker react-native-maps di Android bukan
// View biasa — isinya di-SNAPSHOT jadi bitmap sekali lalu ditempel ke peta
// sebagai ikon native. expo-image menggambar lewat jalur render-nya sendiri
// yang sering BELUM selesai (atau tidak ikut terekam sama sekali) saat
// snapshot diambil — gejalanya marker jadi lingkaran kosong/putih. Image
// bawaan RN terekam dengan benar DAN memberi callback onLoad yang kita
// butuhkan untuk tahu kapan snapshot layak diambil.
//
// Pasangannya di sisi pemanggil: `tracksViewChanges` HARUS true sampai
// onSiap() dipanggil, lalu false. Kalau dibiarkan true selamanya, peta
// menggambar ulang ikon ini tiap frame (boros baterai & bikin peta patah-
// patah); kalau false dari awal, snapshot diambil sebelum foto termuat dan
// marker membeku dalam keadaan kosong.
//
// BUG NYATA (19 September 2026, laporan owner: "foto driver di maps
// tracking ga muncul") — Android SECARA TERPISAH lagi juga menghapus View
// pembungkus yang dianggap murni presentasional dari native view tree
// ("view flattening", optimisasi Yoga bawaan React Native), untuk
// memangkas kedalaman hierarki. Marker react-native-maps men-snapshot
// hierarki native yang SUNGGUHAN, jadi kalau View/Image di dalamnya
// keburu diratakan/dihapus SEBELUM snapshot diambil, hasilnya lingkaran
// kosong persis seperti yang dilaporkan — root cause BERBEDA dari (dan
// terjadi DI ATAS) masalah timing tracksViewChanges di atas, dua-duanya
// harus benar sekaligus. `collapsable={false}` di SETIAP View pembungkus
// foto memaksa Android mempertahankannya di native tree apa adanya.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { mediaUrl } from "../api";
import { initials, avatarColor } from "./Avatar";

// Jeda kecil setelah foto TERAKHIR selesai dimuat sebelum memberi tahu
// pemanggil untuk mematikan tracksViewChanges. onLoad menandakan "bitmap
// sudah siap", TAPI belum tentu sudah ter-layout & tergambar di frame
// berikutnya — mematikan tracksViewChanges di frame yang sama kadang
// membekukan marker tepat sebelum foto muncul. Satu putaran frame saja
// sering cukup; 350ms dipilih supaya aman juga di HP kentang.
const JEDA_SNAPSHOT_MS = 350;

function FotoBulat({ name, avatarUrl, size, borderColor, onLoad }) {
  const [gagal, setGagal] = useState(false);
  const uri = avatarUrl && !gagal ? mediaUrl(avatarUrl) : null;

  // Tidak ada foto (belum pernah pasang, atau gagal dimuat) — inisial
  // berwarna, warna & huruf SAMA dengan Avatar di kartu. Tidak ada yang
  // perlu ditunggu, jadi langsung lapor siap.
  useEffect(() => {
    if (!uri) onLoad?.();
  }, [uri, onLoad]);

  const dasar = {
    width: size, height: size, borderRadius: size / 2,
    borderWidth: 2, borderColor,
  };

  if (!uri) {
    return (
      <View collapsable={false} style={[dasar, styles.tengah, { backgroundColor: avatarColor(name) }]}>
        <Text style={[styles.inisial, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      </View>
    );
  }

  return (
    <Image
      collapsable={false}
      source={{ uri }}
      style={dasar}
      onLoad={() => onLoad?.()}
      onError={() => { setGagal(true); }}
    />
  );
}

/**
 * @param {{name: string, avatarUrl: string|null}[]} orang - 1-2 orang (driver, helper).
 * @param {() => void} onSiap - dipanggil sekali setelah SEMUA foto termuat.
 */
export default function DriverMapMarker({ orang, borderColor, size = 30, onSiap }) {
  const daftar = (orang || []).filter((o) => o && o.name).slice(0, 2);
  const sisa = useRef(daftar.length);
  const sudahLapor = useRef(false);

  // Tidak ada orang sama sekali (mis. rute belum punya driver) — tidak ada
  // yang perlu ditunggu.
  useEffect(() => {
    if (daftar.length === 0 && !sudahLapor.current) {
      sudahLapor.current = true;
      onSiap?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daftar.length]);

  function satuSelesai() {
    sisa.current -= 1;
    if (sisa.current > 0 || sudahLapor.current) return;
    sudahLapor.current = true;
    setTimeout(() => onSiap?.(), JEDA_SNAPSHOT_MS);
  }

  if (daftar.length === 0) return null;

  return (
    <View collapsable={false} style={styles.baris}>
      {daftar.map((o, i) => (
        <View key={`${o.name}-${i}`} collapsable={false} style={i > 0 ? { marginLeft: -size * 0.32 } : null}>
          <FotoBulat
            name={o.name}
            avatarUrl={o.avatarUrl}
            size={size}
            borderColor={borderColor}
            onLoad={satuSelesai}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Bayangan dipasang di BARIS (bukan tiap foto) supaya dua foto yang
  // bertumpuk tidak saling menjatuhkan bayangan satu sama lain.
  baris: {
    flexDirection: "row", alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 5,
  },
  tengah: { alignItems: "center", justifyContent: "center" },
  inisial: { color: "#fff", fontWeight: "700" },
});
