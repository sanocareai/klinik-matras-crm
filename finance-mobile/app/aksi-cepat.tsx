import React, { useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { useShareIntentContext } from "expo-share-intent";
import { Camera, ClipboardPaste, Images, type LucideIcon } from "lucide-react-native";
import { Sheet } from "@/design/Sheet";
import { Button } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { useOnline } from "@/hooks/useOnline";
import { S } from "@/lib/strings";

// SHEET TRANSAKSI CEPAT (FAB). Foto nota bisa masuk dari kamera, galeri, tempel dari clipboard, atau
// dibagikan dari WhatsApp/galeri ("Bagikan → SANO Finance"). Scaffold ini baru MENAMPILKAN foto yang
// dipilih; kompres + unggah (POST /finance/receipts/upload) dan formulir transaksi dikerjakan di S6.

type Foto = { uri: string; nama: string };

const JUDUL_AKSI: Record<string, string> = {
  foto: S.aksi.fotoNota, pengeluaran: S.aksi.pengeluaran, pembelian: S.aksi.pembelian, kasbon: S.aksi.kasbon,
  transfer: S.aksi.transfer, pemasukan: S.aksi.pemasukan, verifikasi: S.aksi.verifikasi, refund: S.aksi.refund, kas: S.lainnya.kasBank,
};

export default function AksiCepat() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { aksi, dari } = useLocalSearchParams<{ aksi?: string; dari?: string }>();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [fotoManual, setFoto] = useState<Foto[]>([]);

  // Foto yang dibagikan dari aplikasi lain (turunan, bukan state).
  const fotoShare = useMemo<Foto[]>(
    () => (dari === "share" && hasShareIntent ? (shareIntent.files ?? []).filter((f) => f.mimeType.startsWith("image/")).map((f) => ({ uri: f.path, nama: f.fileName })) : []),
    [dari, hasShareIntent, shareIntent],
  );
  const foto = fotoManual.length > 0 ? fotoManual : fotoShare;

  function tutup() {
    if (hasShareIntent) resetShareIntent();
    router.back();
  }

  async function dariGaleri() {
    const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!izin.granted && izin.accessPrivileges !== "limited") { Alert.alert("Izin galeri", "Izinkan akses galeri agar foto nota bisa dipilih."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 5, quality: 1 });
    if (!r.canceled) setFoto(r.assets.map((a) => ({ uri: a.uri, nama: a.fileName ?? "foto.jpg" })));
  }

  async function dariKamera() {
    const izin = await ImagePicker.requestCameraPermissionsAsync();
    if (!izin.granted) { Alert.alert("Izin kamera", "Izinkan akses kamera agar nota bisa difoto."); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    if (!r.canceled) setFoto(r.assets.map((a) => ({ uri: a.uri, nama: a.fileName ?? "nota.jpg" })));
  }

  async function dariClipboard() {
    if (!(await Clipboard.hasImageAsync())) { Alert.alert("Clipboard kosong", "Salin fotonya dulu (di WhatsApp: tekan lama foto → Salin)."); return; }
    const img = await Clipboard.getImageAsync({ format: "jpeg" });
    if (img?.data) setFoto([{ uri: img.data, nama: "tempel.jpg" }]);
  }

  const judul = (aksi && JUDUL_AKSI[aksi]) || S.aksi.sheetJudul;

  return (
    <Sheet visible onClose={tutup} judul={judul} sub={aksi ? undefined : S.aksi.sheetSub}>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <Sumber ikon={Camera} label="Kamera" onPress={() => { haptic.ringan(); void dariKamera(); }} />
        <Sumber ikon={Images} label={S.aksi.galeri} onPress={() => { haptic.ringan(); void dariGaleri(); }} />
        <Sumber ikon={ClipboardPaste} label="Tempel" onPress={() => { haptic.ringan(); void dariClipboard(); }} />
      </View>

      {foto.length > 0 ? (
        <>
          <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14, marginBottom: 8 }}>{foto.length} foto dipilih</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {foto.map((f) => (
              <Image key={f.uri} source={{ uri: f.uri }} accessibilityLabel={f.nama} style={{ width: 84, height: 84, borderRadius: radius.small, backgroundColor: colors.neutralSoft }} contentFit="cover" />
            ))}
          </View>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 12 }}>
            Foto akan diperkecil di HP lalu diunggah bersama formulir. Formulir {judul.toLowerCase()} dikerjakan di slice berikutnya — belum ada yang dikirim ke server.
          </Text>
        </>
      ) : (
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 19 }}>
          {aksi && aksi !== "foto" ? `Formulir ${judul.toLowerCase()} segera hadir. ` : ""}Pilih foto nota dulu, atau bagikan dari WhatsApp lewat menu Bagikan.
        </Text>
      )}
      {!online ? <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 12, marginTop: 10 }}>{S.offline.aksiNonaktif} untuk menyimpan transaksi.</Text> : null}
      <Button label={S.umum.tutup} variant="ghost" onPress={tutup} style={{ marginTop: 16 }} />
    </Sheet>
  );
}

function Sumber({ ikon, label, onPress }: { ikon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Button label={label} variant="secondary" icon={ikon} onPress={onPress} />
    </View>
  );
}
