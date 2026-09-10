// Ambil + kompresi foto bukti — padanan PhotoCapture.jsx (web) &
// compressImage.js. Angka kompresi SAMA (maxWidth 1600, quality 0.8) —
// satu standar lintas platform, bukan angka baru yang belum teruji.
// expo-image-picker (kamera langsung, bukan galeri — bukti serah terima
// HARUS foto baru, bukan foto lama dari galeri) + expo-image-manipulator
// utk resize/compress sebelum upload (hemat data driver di lapangan).
import React, { useMemo } from "react";
import { View, Text, Pressable, Image, StyleSheet, ScrollView, Alert } from "react-native";
import { Camera, ImagePlus, X } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useTheme } from "../hooks/useTheme";

const MAX_WIDTH = 1600;
const QUALITY = 0.8;

async function kompres(asset) {
  const out = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: Math.min(MAX_WIDTH, asset.width || MAX_WIDTH) } }],
    { compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG }
  );
  return { uri: out.uri, type: "image/jpeg", name: `foto-${Date.now()}.jpg` };
}

export default function PhotoCapture({ photos, onChange, label }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Kamera & galeri dua-duanya boleh (permintaan owner 10 Sep 2026) —
  // sebagian driver foto dulu pakai app kamera bawaan lalu pilih dari
  // galeri, atau screenshot bukti dari WA. Sama dengan web yang menerima
  // <input type="file"> biasa (bukan cuma capture kamera).
  async function ambilKamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Izin kamera ditolak", "Aktifkan izin kamera di pengaturan HP untuk memakai fitur ini.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    onChange([...photos, await kompres(result.assets[0])]);
  }

  async function ambilGaleri() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Izin galeri ditolak", "Aktifkan izin foto/media di pengaturan HP untuk memilih dari galeri.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const baru = [];
    for (const asset of result.assets) baru.push(await kompres(asset));
    onChange([...photos, ...baru]);
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
        <Pressable style={styles.addBtn} onPress={ambilKamera}>
          <Camera size={18} color={theme.ACCENT} />
          <Text style={styles.addBtnText}>Kamera</Text>
        </Pressable>
        <Pressable style={styles.addBtn} onPress={ambilGaleri}>
          <ImagePlus size={18} color={theme.ACCENT} />
          <Text style={styles.addBtnText}>Galeri</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    label: { fontSize: 10.5, fontWeight: "700", color: t.INK2, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
    row: { gap: 8, paddingVertical: 2 },
    thumbWrap: { position: "relative" },
    thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: t.FIELD_BG },
    removeBtn: {
      position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
      backgroundColor: t.RED, alignItems: "center", justifyContent: "center",
    },
    addBtn: {
      width: 64, height: 64, borderRadius: 10, backgroundColor: t.FIELD_BG,
      borderWidth: 1, borderColor: t.ACCENT + "66", borderStyle: "dashed",
      alignItems: "center", justifyContent: "center", gap: 3,
    },
    addBtnText: { color: t.ACCENT, fontSize: 9.5, fontWeight: "600" },
  });
}
