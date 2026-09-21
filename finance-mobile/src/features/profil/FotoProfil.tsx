import React, { useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, Images } from "lucide-react-native";
import { Avatar } from "@/design/Avatar";
import { Sheet } from "@/design/Sheet";
import { Button, PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { useSession } from "@/auth/session";
import { gantiFotoProfil } from "@/api/profil";
import { pesanUntukPengguna } from "@/api/errors";
import { useOnline } from "@/hooks/useOnline";
import { PESAN_BACA_SAJA, bacaSaja } from "@/lib/bacaSaja";

// GANTI FOTO PROFIL (Lainnya). Foto sama dengan SANSS Hub: mengganti di sini berlaku di sana, dan foto dari Hub tampil di sini.
// Alur: pilih (kamera/galeri, pangkas persegi) → unggah → server membulatkan → tampil. Tidak dikirim saat offline; tidak di build baca-saja;
// satu unggahan pada satu waktu (double-tap aman).

export function FotoProfil() {
  const { colors } = useTheme();
  const online = useOnline();
  const user = useSession((s) => s.user);
  const setAvatar = useSession((s) => s.setAvatar);
  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const kunci = useRef(false);
  const nonaktifAlasan = bacaSaja() ? PESAN_BACA_SAJA : !online ? "Tidak ada koneksi. Foto tidak bisa diganti." : null;

  async function pilih(sumber: "kamera" | "galeri") {
    if (kunci.current) return;
    setBuka(false);
    setPesan(null);
    try {
      const izin = sumber === "kamera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!izin.granted && !("accessPrivileges" in izin && izin.accessPrivileges === "limited")) {
        Alert.alert(sumber === "kamera" ? "Izin kamera" : "Izin galeri", sumber === "kamera" ? "Izinkan akses kamera agar foto bisa diambil." : "Izinkan akses galeri agar foto bisa dipilih.");
        return;
      }
      const opsi: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
      const r = sumber === "kamera" ? await ImagePicker.launchCameraAsync(opsi) : await ImagePicker.launchImageLibraryAsync({ ...opsi, allowsMultipleSelection: false });
      const a = r.canceled ? null : r.assets[0];
      if (!a) return;
      kunci.current = true;
      setSibuk(true);
      const url = await gantiFotoProfil({ uri: a.uri, nama: a.fileName, mime: a.mimeType });
      await setAvatar(url);
      haptic.sukses();
      setPesan("Foto profil diperbarui. Foto yang sama tampil di SANSS Hub.");
    } catch (e) {
      haptic.galat();
      setPesan(pesanUntukPengguna(e));
    } finally {
      kunci.current = false;
      setSibuk(false);
    }
  }

  function ketuk() {
    if (sibuk) return;
    if (nonaktifAlasan) { Alert.alert("Foto profil", nonaktifAlasan); return; }
    haptic.tick();
    setBuka(true);
  }

  return (
    <View>
      <PressableScale onPress={ketuk} accessibilityLabel={sibuk ? "Mengunggah foto profil" : "Ganti foto profil"} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 }}>
        <View style={{ opacity: sibuk ? 0.5 : 1 }}>
          <Avatar nama={user?.name} avatarUrl={user?.avatarUrl} ukuran={56} />
          <View style={{ position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.solid, borderWidth: 1, borderColor: colors.glassStroke, alignItems: "center", justifyContent: "center" }}>
            <Camera size={12} color={colors.primary} strokeWidth={2} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16 }}>{user?.name}</Text>
          {pesan ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>{pesan}</Text>
          ) : (
            <Text maxFontSizeMultiplier={1.3} style={{ color: nonaktifAlasan ? colors.warning : colors.primary, fontFamily: font.medium, fontSize: 12, marginTop: 2 }}>
              {sibuk ? "Mengunggah…" : (nonaktifAlasan ?? "Ketuk untuk mengganti foto")}
            </Text>
          )}
        </View>
      </PressableScale>
      <Sheet visible={buka} onClose={() => setBuka(false)} judul="Foto profil" sub="Foto yang sama dipakai di SANSS Hub.">
        <View style={{ gap: 10 }}>
          <Button label="Ambil foto" variant="secondary" icon={Camera} onPress={() => void pilih("kamera")} />
          <Button label="Pilih dari galeri" variant="secondary" icon={Images} onPress={() => void pilih("galeri")} />
          <Button label="Batal" variant="ghost" onPress={() => setBuka(false)} />
        </View>
      </Sheet>
    </View>
  );
}
