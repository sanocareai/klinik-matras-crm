import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Camera, CircleCheck, Images, RotateCcw, Trash2, TriangleAlert } from "lucide-react-native";
import { Button, PressableScale } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { unggahFoto } from "@/api/transaksi";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { Kolom } from "./Isian";

// FOTO NOTA / BUKTI — dipilih dari kamera atau galeri, langsung diunggah ke server (POST /finance/receipts/upload; server memperkecil dan memberi
// nama dari hash isi, jadi mengulang unggah aman). Status: mengunggah → selesai / gagal (dengan "Coba lagi"). Gagal unggah TIDAK menghapus isian
// formulir. Alamat berkas hasil unggah dikirim bersama dokumen; foto yang sama dengan dokumen lain diberi peringatan.

type Status = "kosong" | "mengunggah" | "selesai" | "gagal";
type Foto = { uri: string; nama: string };

export function LampiranField({ label = "Foto nota", wajib, petunjuk, awalUri, onUrl, onSibuk, galat }: {
  label?: string; wajib?: boolean; petunjuk?: string; awalUri?: string | null;
  /** Dipanggil dengan alamat berkas server (atau null saat dihapus). */
  onUrl: (url: string | null) => void;
  /** Dipanggil true selama unggahan berjalan (tombol kirim formulir dinonaktifkan). */
  onSibuk?: (sibuk: boolean) => void;
  galat?: string | null;
}) {
  const { colors } = useTheme();
  const [foto, setFoto] = useState<Foto | null>(awalUri ? { uri: awalUri, nama: "nota.jpg" } : null);
  const [status, setStatus] = useState<Status>(awalUri ? "mengunggah" : "kosong");
  const [pesan, setPesan] = useState<string | null>(null);
  const [dipakai, setDipakai] = useState<string[]>([]);
  const dibatalkan = useRef(false);
  useEffect(() => () => { dibatalkan.current = true; }, []);

  const kirim = useCallback(async (f: Foto) => {
    setFoto(f); setStatus("mengunggah"); setPesan(null); setDipakai([]); onUrl(null); onSibuk?.(true);
    try {
      const h = await unggahFoto(f);
      if (dibatalkan.current) return;
      setStatus("selesai"); setDipakai(h.dipakaiDi); onUrl(h.url); haptic.sukses();
    } catch (e) {
      if (dibatalkan.current) return;
      setStatus("gagal");
      setPesan(e instanceof ApiError && e.isNetwork ? "Unggahan gagal — koneksi bermasalah. Formulir Anda tetap aman; coba lagi." : pesanUntukPengguna(e));
      haptic.galat();
    } finally {
      if (!dibatalkan.current) onSibuk?.(false);
    }
  }, [onUrl, onSibuk]);

  // Foto yang dibagikan dari aplikasi lain (Bagikan → SANO Finance) langsung diunggah.
  const sudahAuto = useRef(false);
  useEffect(() => {
    if (!awalUri || sudahAuto.current) return undefined;
    sudahAuto.current = true;
    const t = setTimeout(() => { void kirim({ uri: awalUri, nama: "nota.jpg" }); }, 0);
    return () => clearTimeout(t);
  }, [awalUri, kirim]);

  async function dariGaleri() {
    const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!izin.granted && izin.accessPrivileges !== "limited") { Alert.alert("Izin galeri", "Izinkan akses galeri agar foto nota bisa dipilih."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.7 });
    if (!r.canceled && r.assets[0]) void kirim({ uri: r.assets[0].uri, nama: r.assets[0].fileName ?? "nota.jpg" });
  }
  async function dariKamera() {
    const izin = await ImagePicker.requestCameraPermissionsAsync();
    if (!izin.granted) { Alert.alert("Izin kamera", "Izinkan akses kamera agar nota bisa difoto."); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!r.canceled && r.assets[0]) void kirim({ uri: r.assets[0].uri, nama: r.assets[0].fileName ?? "nota.jpg" });
  }
  const hapus = () => { setFoto(null); setStatus("kosong"); setPesan(null); setDipakai([]); onUrl(null); onSibuk?.(false); };

  return (
    <Kolom label={label} wajib={wajib} galat={galat} petunjuk={petunjuk}>
      {foto ? (
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 10, borderRadius: radius.button, borderWidth: 1, borderColor: status === "gagal" ? colors.danger : colors.hairline, backgroundColor: colors.solidAlt }}>
          <Image source={{ uri: foto.uri }} accessibilityLabel="Foto nota terpilih" style={{ width: 64, height: 64, borderRadius: radius.small, backgroundColor: colors.neutralSoft }} contentFit="cover" />
          <View style={{ flex: 1, gap: 4 }} accessibilityLiveRegion="polite">
            {status === "mengunggah" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, flex: 1 }}>Mengunggah foto… jangan tutup layar ini.</Text>
              </View>
            ) : status === "selesai" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <CircleCheck size={16} color={colors.success} strokeWidth={1.75} />
                <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 13 }}>Foto terunggah</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TriangleAlert size={16} color={colors.danger} strokeWidth={1.75} />
                <Text maxFontSizeMultiplier={1.3} style={{ flex: 1, color: colors.danger, fontFamily: font.regular, fontSize: 12, lineHeight: 17 }}>{pesan}</Text>
              </View>
            )}
            {dipakai.length > 0 ? (
              <Text maxFontSizeMultiplier={1.3} style={{ color: colors.warning, fontFamily: font.regular, fontSize: 12 }}>Foto ini sudah dipakai di {dipakai.join(", ")}. Pastikan bukan nota yang sama.</Text>
            ) : null}
          </View>
          <View style={{ gap: 4 }}>
            {status === "gagal" ? (
              <PressableScale onPress={() => { void kirim(foto); }} accessibilityLabel="Coba unggah lagi" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <RotateCcw size={20} color={colors.primary} strokeWidth={1.75} />
              </PressableScale>
            ) : null}
            <PressableScale onPress={hapus} accessibilityLabel="Hapus foto" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
              <Trash2 size={20} color={colors.textMuted} strokeWidth={1.75} />
            </PressableScale>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Kamera" variant="secondary" icon={Camera} onPress={() => { void dariKamera(); }} /></View>
          <View style={{ flex: 1 }}><Button label="Galeri" variant="secondary" icon={Images} onPress={() => { void dariGaleri(); }} /></View>
        </View>
      )}
    </Kolom>
  );
}
