// Layar "Kirim Lokasi" — sebelumnya menekan "Lokasi" LANGSUNG mengirim
// posisi saat itu juga, tanpa konfirmasi. Sekarang ada jeda tinjau dulu,
// menampilkan alamat hasil terjemahan koordinat, sebelum benar-benar kirim.
//
// TIDAK ADA peta visual atau daftar "tempat terdekat" di sini — dua-duanya
// butuh Google Maps/Places API key BERBAYAR dari akun Google Cloud yang
// belum ada di sistem ini (dikonfirmasi ke user, user memilih jalan tanpa
// API key). Alamat di bawah didapat dari expo-location#reverseGeocodeAsync
// — pakai geocoder NATIF perangkat (Android/iOS bawaan), GRATIS, tanpa API
// key sama sekali. Kalau nanti API key tersedia, tempat paling wajar
// menambah peta+nearby places adalah di sini, bukan bikin komponen baru.
import React, { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import * as Location from "expo-location";
import { X, MapPin, Navigation } from "lucide-react-native";
import { useTokens } from "../constants/theme";

// Susun alamat dari bagian-bagian yang tersedia — expo-location TIDAK
// menjamin semua field terisi (tergantung data peta OS & lokasi), jadi
// filter bagian kosong daripada menampilkan "null, null, Jakarta".
function susunAlamat(a) {
  if (!a) return null;
  const bagian = [
    [a.street, a.streetNumber].filter(Boolean).join(" "),
    a.district,
    a.city,
    a.region,
  ].filter(Boolean);
  return bagian.length ? bagian.join(", ") : null;
}

export default function KirimLokasiModal({ visible, onClose, onKirim }) {
  const tokens = useTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);
  const [status, setStatus] = useState("memuat"); // memuat | siap | error
  const [pesanError, setPesanError] = useState("");
  const [koordinat, setKoordinat] = useState(null); // { lat, lng, akurasi }
  const [alamat, setAlamat] = useState(null);
  const [mengirim, setMengirim] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setStatus("memuat");
    setAlamat(null);

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        if (alive) { setStatus("error"); setPesanError("Izin lokasi diperlukan untuk membagikan titik lokasi"); }
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!alive) return;
        setKoordinat({ lat: pos.coords.latitude, lng: pos.coords.longitude, akurasi: pos.coords.accuracy });
        setStatus("siap");
        // Alamat dimuat TERPISAH (tidak memblokir tombol kirim) — geocoder
        // natif kadang lambat/gagal, tapi koordinatnya sendiri sudah cukup
        // untuk dikirim. Gagal di sini WAJAR, jangan sampai memblokir kirim.
        Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
          .then((hasil) => { if (alive) setAlamat(susunAlamat(hasil?.[0])); })
          .catch(() => {});
      } catch (err) {
        if (alive) { setStatus("error"); setPesanError(err.message || "Gagal mengambil lokasi"); }
      }
    })();

    return () => { alive = false; };
  }, [visible]);

  async function handleKirim() {
    if (!koordinat || mengirim) return;
    setMengirim(true);
    try {
      await onKirim({ lat: koordinat.lat, lng: koordinat.lng, name: alamat });
    } finally {
      setMengirim(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={tokens.color.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.title}>Kirim Lokasi</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.body}>
          {status === "memuat" && (
            <View style={styles.centerBox}>
              <ActivityIndicator color={tokens.color.accent} size="large" />
              <Text style={styles.centerText}>Mengambil lokasi saat ini…</Text>
            </View>
          )}

          {status === "error" && (
            <View style={styles.centerBox}>
              <MapPin size={32} color={tokens.color.danger} strokeWidth={1.6} />
              <Text style={[styles.centerText, { color: tokens.color.danger }]}>{pesanError}</Text>
            </View>
          )}

          {status === "siap" && (
            <View style={styles.kartu}>
              <View style={styles.kartuIconWrap}>
                <Navigation size={22} color="#fff" strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.kartuTitle}>Lokasi Saat Ini</Text>
                {alamat ? (
                  <Text style={styles.kartuAlamat} numberOfLines={3}>{alamat}</Text>
                ) : (
                  <Text style={styles.kartuAlamatMemuat}>Mencari alamat…</Text>
                )}
                {Number.isFinite(koordinat?.akurasi) && (
                  <Text style={styles.kartuAkurasi}>Akurasi ±{Math.round(koordinat.akurasi)} m</Text>
                )}
              </View>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.kirimBtn, (status !== "siap" || mengirim) && styles.kirimBtnDisabled]}
            onPress={handleKirim}
            disabled={status !== "siap" || mengirim}
          >
            {mengirim
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.kirimBtnText}>Kirim Lokasi Ini</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: tokens.color.bg },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 8, paddingTop: 54, paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    closeBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
    body: { flex: 1, padding: 16, justifyContent: "center" },
    centerBox: { alignItems: "center", gap: 12, paddingHorizontal: 24 },
    centerText: { fontSize: 13.5, color: tokens.color.textMuted, textAlign: "center" },
    kartu: {
      flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: tokens.color.card,
      borderRadius: 14, padding: 16, borderWidth: 1, borderColor: tokens.color.border,
    },
    kartuIconWrap: {
      width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
      backgroundColor: tokens.color.accent,
    },
    kartuTitle: { fontSize: 14.5, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 4 },
    kartuAlamat: { fontSize: 13, color: tokens.color.textSecondary, lineHeight: 18 },
    kartuAlamatMemuat: { fontSize: 13, color: tokens.color.textMuted, fontStyle: "italic" },
    kartuAkurasi: { fontSize: 11.5, color: tokens.color.textMuted, marginTop: 6 },
    footer: { padding: 16, paddingBottom: 28 },
    kirimBtn: {
      backgroundColor: tokens.color.accent, borderRadius: 26, paddingVertical: 14, alignItems: "center",
    },
    kirimBtnDisabled: { opacity: 0.5 },
    kirimBtnText: { color: "#fff", fontWeight: "700", fontSize: 14.5 },
  });
}
