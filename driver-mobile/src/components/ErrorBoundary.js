// Jaring pengaman render error — port LANGSUNG dari mobile/src/components/
// ErrorBoundary.js (Sano Messenger), sama alasan: di build produksi RN,
// satu render error tak tertangkap meng-unmount SELURUH pohon komponen,
// menyisakan layar kosong tanpa petunjuk apa pun. Komponen ini generik,
// tidak ada logika chat, aman dipakai apa adanya.
//
// SENGAJA View/Text/Pressable polos + warna hardcode: harus tetap bisa
// render walau context/provider apa pun sedang rusak.
import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    // Debug sementara (D-198, 10 September 2026): ErrorBoundary v1 cuma
    // menampilkan error.message ("undefined is not a function" — tidak
    // cukup buat lacak lokasi bug tanpa akses adb logcat ke HP driver).
    // Ditambah stack + componentStack di layar supaya bisa dikirim balik
    // lewat screenshot, dorong lewat EAS Update (JS-only, tidak perlu
    // build APK baru).
    const detail = [
      String(error?.message || error),
      error?.stack ? `\n--- stack ---\n${error.stack}` : "",
      info?.componentStack ? `\n--- component stack ---\n${info.componentStack}` : "",
    ].join("");

    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Ada yang error di bagian ini</Text>
        <Text style={styles.subtitle}>
          Tekan "Coba Lagi" untuk memuat ulang tampilan. Kalau terus berulang,
          tolong kirim tulisan di bawah ini ke tim teknis.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={{ padding: 12 }}>
          <Text style={styles.detailText} selectable>
            {detail}
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
  wrap: { flex: 1, backgroundColor: "#0A0D16", padding: 24, justifyContent: "center" },
  title: { color: "#f9fafb", fontSize: 17, fontWeight: "700", marginBottom: 8 },
  subtitle: { color: "#9ca3af", fontSize: 13, lineHeight: 19, marginBottom: 16 },
  detailBox: {
    maxHeight: 220, backgroundColor: "#171B2E", borderRadius: 10,
    borderWidth: 1, borderColor: "#2a3350", marginBottom: 18,
  },
  detailText: { color: "#fca5a5", fontSize: 12, fontFamily: "monospace" },
  btn: {
    backgroundColor: "#2D64B6", borderRadius: 12, paddingVertical: 13,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
