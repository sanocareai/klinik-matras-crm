import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { sisaJedaDetik, useLock } from "@/auth/lock";
import { pinLemah } from "@/auth/pin";
import { useSession } from "@/auth/session";
import { PinPad } from "@/features/lock/PinPad";

// UBAH PIN: PIN lama → PIN baru → ulangi. PIN lama diperiksa lewat jalur yang sama dengan layar kunci
// (percobaan salah ikut dihitung; 10 kali salah = keluar dari akun). Tidak ada PIN yang dicatat.

type Langkah = "lama" | "baru" | "ulangi";

export default function UbahPin() {
  const { colors } = useTheme();
  const router = useRouter();
  const verifyPin = useLock((s) => s.verifyPin);
  const changePin = useLock((s) => s.changePin);
  const [langkah, setLangkah] = useState<Langkah>("lama");
  const [lama, setLama] = useState("");
  const [baru, setBaru] = useState("");
  const [pesan, setPesan] = useState<{ teks: string; tone: "error" | "info" } | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function saatSelesai(pin: string) {
    setPesan(null);
    if (langkah === "lama") {
      setSibuk(true);
      const r = await verifyPin(pin);
      setSibuk(false);
      if (r.ok) { setLama(pin); setLangkah("baru"); return; }
      haptic.galat();
      if (r.reason === "hapus") { await useSession.getState().logout({ alasan: "PIN_TERLALU_BANYAK_SALAH" }); return; }
      if (r.reason === "jeda") {
        const s = r.sisaDetik ?? sisaJedaDetik(useLock.getState().sampaiMs);
        setPesan({ teks: `Terlalu banyak salah. Coba lagi dalam ${s} detik.`, tone: "error" });
        return;
      }
      setPesan({ teks: `PIN lama salah.${(r.sisaPercobaan ?? 0) > 0 ? ` ${r.sisaPercobaan} percobaan lagi sebelum dikunci sementara.` : ""}`, tone: "error" });
      return;
    }
    if (langkah === "baru") {
      if (pin === lama) { haptic.galat(); setPesan({ teks: "PIN baru harus berbeda dari PIN lama.", tone: "error" }); return; }
      if (pinLemah(pin)) { haptic.galat(); setPesan({ teks: "PIN terlalu mudah ditebak (angka sama semua atau berurutan). Pilih yang lain.", tone: "error" }); return; }
      setBaru(pin);
      setLangkah("ulangi");
      return;
    }
    if (pin !== baru) { haptic.galat(); setBaru(""); setLangkah("baru"); setPesan({ teks: "PIN baru tidak sama. Ulangi.", tone: "error" }); return; }
    setSibuk(true);
    const r = await changePin(lama, baru);
    setSibuk(false);
    if (r.ok) {
      haptic.sukses();
      Alert.alert("PIN diubah", "PIN baru sudah aktif.", [{ text: "OK", onPress: () => router.back() }]);
      return;
    }
    haptic.galat();
    setPesan({ teks: "PIN belum bisa diubah. Coba lagi dari awal.", tone: "error" });
    setLama(""); setBaru(""); setLangkah("lama");
  }

  const judul = langkah === "lama" ? "Masukkan PIN lama" : langkah === "baru" ? "Buat PIN baru" : "Ulangi PIN baru";
  const sub = langkah === "lama" ? "Untuk keamanan, konfirmasi PIN Anda yang sekarang." : langkah === "baru" ? "6 digit angka yang tidak mudah ditebak." : "Masukkan PIN baru yang sama sekali lagi.";

  return (
    <Screen scroll>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Keamanan</Text>
      </PressableScale>
      <View style={{ alignItems: "center", marginTop: 12 }}>
        <PinPad judul={judul} sub={sub} pesan={pesan} onSelesai={saatSelesai} sibuk={sibuk} />
      </View>
    </Screen>
  );
}
