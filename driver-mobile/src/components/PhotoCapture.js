// Ambil + kompresi foto bukti — padanan PhotoCapture.jsx (web) &
// compressImage.js. Angka kompresi SAMA (maxWidth 1600, quality 0.8) —
// satu standar lintas platform, bukan angka baru yang belum teruji.
// expo-image-picker (kamera langsung, bukan galeri — bukti serah terima
// HARUS foto baru, bukan foto lama dari galeri) + expo-image-manipulator
// utk resize/compress sebelum upload (hemat data driver di lapangan).
import React from "react";
import { View, Text, Pressable, Image, StyleSheet, ScrollView } from "react-native";
import { Camera, X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

const MAX_WIDTH = 1600;
const QUALITY = 0.8;

const ACCENT = "#4C8DFF";
const INK = "#F5F5F7";
const INK2 = "rgba(245,245,247,0.62)";
const SURFACE = "rgba(255,255,255,0.06)";
const RED = "#FF453A";

export default function PhotoCapture({ photos, onChange, label }) {
  async function ambilFoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchCameraAsync({
      quality: 1, // kompresi dilakukan manual di bawah (kontrol ukuran akhir persis)
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const compressed = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: Math.min(MAX_WIDTH, asset.width || MAX_WIDTH) } }],
      { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG }
    );

    onChange([...photos, { uri: compressed.uri, type: "image/jpeg", name: `foto-${Date.now()}.jpg` }]);
  }

  function hapus(idx) {
    onChange(photos.filter((_, i) => i !== idx));
  }

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((p, i) => (
          <View key={p.uri} style={styles.thumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            <Pressable style={styles.removeBtn} onPress={() => hapus(i)}>
              <X size={11} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.addBtn} onPress={ambilFoto}>
          <Camera size={20} color={ACCENT} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 10.5, fontWeight: "700", color: INK2, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  row: { gap: 8, paddingVertical: 2 },
  thumbWrap: { position: "relative" },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: SURFACE },
  removeBtn: {
    position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: RED, alignItems: "center", justifyContent: "center",
  },
  addBtn: {
    width: 64, height: 64, borderRadius: 10, backgroundColor: SURFACE,
    borderWidth: 1, borderColor: "rgba(76,141,255,0.4)", borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
});
