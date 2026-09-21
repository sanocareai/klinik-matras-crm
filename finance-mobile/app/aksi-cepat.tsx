import React, { useEffect, useMemo, useState } from "react";
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
import { useSession } from "@/auth/session";
import { S } from "@/lib/strings";
import { aksiUntuk } from "@/features/aksi";
import { has } from "@/auth/capabilities";
import { denganAkses } from "@/features/guard/RequireCapability";
import { bisaBuat } from "@/features/transaksi/modul";
import type { ModulTx } from "@/api/types";

// SHEET TRANSAKSI CEPAT (FAB). Aksi cepat membuka formulir modul yang sesuai (S6–S8); foto nota bisa masuk dari kamera, galeri, tempel dari
// clipboard, atau dibagikan dari WhatsApp/galeri ("Bagikan → SANO Finance") lalu dijadikan Pengeluaran atau Pembelian. Foto diunggah di formulir.

type Foto = { uri: string; nama: string };
const MODUL_AKSI: Record<string, ModulTx> = { pengeluaran: "pengeluaran", pembelian: "pembelian", kasbon: "kasbon", pemasukan: "pemasukan", refund: "refund" };

function AksiCepat() {
  const { colors } = useTheme();
  const router = useRouter();
  const online = useOnline();
  const caps = useSession((s) => s.capabilities);
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

  // Pintasan dari Beranda (aksi=…): langsung ke formulir / layar tujuan, tanpa sheet perantara.
  useEffect(() => {
    if (!aksi) return;
    const modul = MODUL_AKSI[aksi];
    if (modul && bisaBuat(caps, modul)) router.replace({ pathname: "/tx/[modul]/baru", params: { modul } });
    else if (aksi === "verifikasi" && has(caps, "paymentWrite")) router.replace("/pembayaran");
  }, [aksi, caps, router]);

  async function dariGaleri() {
    const izin = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!izin.granted && izin.accessPrivileges !== "limited") { Alert.alert("Izin galeri", "Izinkan akses galeri agar foto nota bisa dipilih."); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 0.7 });
    if (!r.canceled) setFoto(r.assets.map((a) => ({ uri: a.uri, nama: a.fileName ?? "foto.jpg" })));
  }

  async function dariKamera() {
    const izin = await ImagePicker.requestCameraPermissionsAsync();
    if (!izin.granted) { Alert.alert("Izin kamera", "Izinkan akses kamera agar nota bisa difoto."); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (!r.canceled) setFoto(r.assets.map((a) => ({ uri: a.uri, nama: a.fileName ?? "nota.jpg" })));
  }

  async function dariClipboard() {
    if (!(await Clipboard.hasImageAsync())) { Alert.alert("Clipboard kosong", "Salin fotonya dulu (di WhatsApp: tekan lama foto → Salin)."); return; }
    const img = await Clipboard.getImageAsync({ format: "jpeg" });
    if (img?.data) setFoto([{ uri: img.data, nama: "tempel.jpg" }]);
  }

  const jadikan = (modul: ModulTx) => {
    const uri = foto[0]?.uri;
    if (hasShareIntent) resetShareIntent();
    router.replace({ pathname: "/tx/[modul]/baru", params: uri ? { modul, foto: uri } : { modul } });
  };
  const daftarAksi = aksiUntuk(caps).filter((a) => a.id !== "foto");

  return (
    <Sheet visible onClose={tutup} judul={S.aksi.sheetJudul} sub={S.aksi.sheetSub}>
      <View style={{ gap: 10, marginBottom: 14 }}>
        {daftarAksi.map((a) => {
          const modul = MODUL_AKSI[a.id];
          const bisa = a.id === "verifikasi" || (!!modul && bisaBuat(caps, modul));
          return (
            <Button
              key={a.id} label={bisa ? a.label : `${a.label} (di web)`} variant="secondary" icon={a.Icon} disabled={!bisa}
              onPress={() => { haptic.ringan(); if (a.id === "verifikasi") router.replace("/pembayaran"); else if (modul) jadikan(modul); }}
            />
          );
        })}
      </View>

      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 14, marginBottom: 8 }}>Mulai dari foto nota</Text>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <Sumber ikon={Camera} label="Kamera" onPress={() => { haptic.ringan(); void dariKamera(); }} />
        <Sumber ikon={Images} label={S.aksi.galeri} onPress={() => { haptic.ringan(); void dariGaleri(); }} />
        <Sumber ikon={ClipboardPaste} label="Tempel" onPress={() => { haptic.ringan(); void dariClipboard(); }} />
      </View>

      {foto.length > 0 ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {foto.map((f) => (
              <Image key={f.uri} source={{ uri: f.uri }} accessibilityLabel={f.nama} style={{ width: 84, height: 84, borderRadius: radius.small, backgroundColor: colors.neutralSoft }} contentFit="cover" />
            ))}
          </View>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 10 }}>Foto diunggah di formulir. Jadikan:</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            {bisaBuat(caps, "pengeluaran") ? <View style={{ flex: 1 }}><Button label="Pengeluaran" onPress={() => jadikan("pengeluaran")} /></View> : null}
            {bisaBuat(caps, "pembelian") ? <View style={{ flex: 1 }}><Button label="Pembelian" variant="secondary" onPress={() => jadikan("pembelian")} /></View> : null}
          </View>
        </>
      ) : (
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, lineHeight: 19 }}>Pilih foto nota dulu, atau bagikan dari WhatsApp lewat menu Bagikan.</Text>
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

// Mencatat butuh FINANCE_POST; memverifikasi pembayaran butuh PAYMENT_WRITE (khusus FINANCE).
export default denganAkses(AksiCepat, ["financePost", "paymentWrite"], "any");
