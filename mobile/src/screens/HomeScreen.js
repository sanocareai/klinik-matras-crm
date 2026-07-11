// Placeholder tab Home — isi sebenarnya (dashboard ringkas dsb) dikerjakan
// di prompt berikutnya. Sengaja MINIMAL sekarang, cuma penanda "Segera".
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Sparkles } from "lucide-react-native";
import { tokens } from "../constants/theme";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Sparkles size={28} color={tokens.color.accent} strokeWidth={2} />
      </View>
      <Text style={styles.title}>Segera Hadir</Text>
      <Text style={styles.subtitle}>Ringkasan aktivitas harian akan tampil di sini.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.color.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: tokens.color.accentSoft,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  title: { fontFamily: tokens.font.semiBold, fontSize: 18, color: tokens.color.textPrimary, marginBottom: 6 },
  subtitle: { fontFamily: tokens.font.regular, fontSize: 14, color: tokens.color.textSecondary, textAlign: "center" },
});
