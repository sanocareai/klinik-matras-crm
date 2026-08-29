// Jaring pengaman render error — dibuat 29 Agustus 2026 setelah insiden
// "profil blank di semua chat".
//
// KENAPA PERLU: di React Native build PRODUKSI, satu render error yang tidak
// tertangkap akan meng-unmount SELURUH pohon komponen dan menyisakan LAYAR
// KOSONG polos — tanpa pesan, tanpa stack, tanpa petunjuk apa pun. Persis
// itu yang terjadi saat OrderFormModal di dalam bottom sheet memanggil
// useAuth()/useQuery() yang context-nya tidak terjangkau (lihat catatan
// panjang urutan provider di App.js). Bug-nya sendiri sudah diperbaiki di
// sana; komponen ini memastikan kelas masalah yang SAMA di masa depan
// muncul sebagai pesan yang bisa dibaca & dilaporkan, bukan layar hitam
// yang mustahil didiagnosis dari jarak jauh.
//
// SENGAJA memakai View/Text/Pressable polos + warna hardcode: komponen ini
// harus tetap bisa render walau context tema/provider apa pun sedang rusak —
// kalau dia sendiri bergantung pada context, dia ikut gagal saat paling
// dibutuhkan.
import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // console.* di-strip di build produksi (lihat babel.config.js), jadi ini
    // cuma berguna saat development — pesan untuk user ada di render().
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Ada yang error di bagian ini</Text>
        <Text style={styles.subtitle}>
          Tekan "Coba Lagi" untuk memuat ulang tampilan. Kalau terus berulang,
          tolong kirim tulisan di bawah ini ke tim teknis.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={{ padding: 12 }}>
          <Text style={styles.detailText} selectable>
            {String(error?.message || error)}
          </Text>
        </ScrollView>
        <Pressable style={styles.btn} onPress={this.handleReset}>
          <Text style={styles.btnText}>Coba Lagi</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#111827", padding: 24, justifyContent: "center" },
  title: { color: "#f9fafb", fontSize: 17, fontWeight: "700", marginBottom: 8 },
  subtitle: { color: "#9ca3af", fontSize: 13, lineHeight: 19, marginBottom: 16 },
  detailBox: {
    maxHeight: 220, backgroundColor: "#1f2937", borderRadius: 10,
    borderWidth: 1, borderColor: "#374151", marginBottom: 18,
  },
  detailText: { color: "#fca5a5", fontSize: 12, fontFamily: "monospace" },
  btn: {
    backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 13,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
