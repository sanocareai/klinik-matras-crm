import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Fingerprint } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { Button } from "@/design/ui";
import { font } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useLock } from "@/auth/lock";
import { pinLemah } from "@/auth/pin";
import { PinPad } from "./PinPad";

// PENGATURAN AWAL (wajib setelah login pertama): buat PIN 6 digit → ulangi → tawaran biometrik (opsional).
// PIN tidak disimpan mentah; lihat auth/lock.ts. Layar ini tidak bisa dilewati (tidak ada tombol "nanti").

type Langkah = "buat" | "ulangi" | "biometrik";

const PESAN_PIN: Record<string, string> = {
  lemah: "PIN terlalu mudah ditebak (angka sama semua atau berurutan). Pilih yang lain.",
  format: "PIN harus 6 digit angka.",
};

export function PinSetup() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const setupPin = useLock((s) => s.setupPin);
  const setBiometric = useLock((s) => s.setBiometric);
  const selesaiSetup = useLock((s) => s.selesaiSetup);
  const pinSet = useLock((s) => s.pinSet);
  const biometricStatus = useLock((s) => s.biometricStatus);
  const [langkahLokal, setLangkah] = useState<"buat" | "ulangi">("buat");
  const [pinPertama, setPinPertama] = useState("");
  const [pesan, setPesan] = useState<{ teks: string; tone: "error" | "info" } | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galatBio, setGalatBio] = useState<string | null>(null);

  // PIN sudah dibuat (setupBaru) → langkah biometrik; tidak tersedia → selesai.
  const langkah: Langkah = pinSet ? "biometrik" : langkahLokal;

  async function saatSelesai(pin: string) {
    setPesan(null);
    if (langkah === "buat") {
      if (pinLemah(pin)) { haptic.galat(); setPesan({ teks: PESAN_PIN.lemah ?? "", tone: "error" }); return; }
      setPinPertama(pin);
      setLangkah("ulangi");
      return;
    }
    if (pin !== pinPertama) {
      haptic.galat();
      setPinPertama("");
      setLangkah("buat");
      setPesan({ teks: "PIN tidak sama. Ulangi dari awal.", tone: "error" });
      return;
    }
    setSibuk(true);
    const r = await setupPin(pin);
    setSibuk(false);
    if (!r.ok) { haptic.galat(); setLangkah("buat"); setPinPertama(""); setPesan({ teks: PESAN_PIN[r.reason] ?? "PIN tidak bisa dipakai.", tone: "error" }); return; }
    haptic.sukses();
    if (useLock.getState().biometricStatus !== "tersedia") selesaiSetup(); // tidak ada biometrik → langsung masuk
  }

  async function aktifkanBiometrik() {
    setGalatBio(null);
    const r = await setBiometric(true);
    if (r.ok) { haptic.sukses(); selesaiSetup(); return; }
    haptic.galat();
    setGalatBio(r.pesan);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <LinearGradient colors={[colors.bgTop, colors.bgBottom]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {langkah === "biometrik" ? (
          <View style={{ alignItems: "center", width: "100%", gap: 14 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Fingerprint size={36} color={colors.primary} strokeWidth={1.75} />
            </View>
            <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 22, textAlign: "center" }}>Pakai biometrik?</Text>
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
              Buka SANO Finance dengan sidik jari atau wajah. PIN tetap bisa dipakai kapan saja. Anda bisa mengubahnya nanti di Lainnya → Keamanan.
            </Text>
            {biometricStatus === "belum_terdaftar" ? (
              <Text style={{ color: colors.warning, fontFamily: font.medium, fontSize: 13, textAlign: "center" }}>Belum ada sidik jari atau wajah terdaftar di HP ini.</Text>
            ) : null}
            {galatBio ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: font.medium, fontSize: 13, textAlign: "center" }}>{galatBio}</Text> : null}
            <View style={{ width: "100%", gap: 10, marginTop: 8 }}>
              <Button label="Aktifkan biometrik" onPress={() => { void aktifkanBiometrik(); }} disabled={biometricStatus !== "tersedia"} />
              <Button label="Nanti saja, pakai PIN" variant="ghost" onPress={() => selesaiSetup()} />
            </View>
          </View>
        ) : (
          <PinPad
            judul={langkah === "buat" ? "Buat PIN" : "Ulangi PIN"}
            sub={langkah === "buat" ? "PIN 6 digit untuk membuka SANO Finance. Jangan bagikan ke siapa pun." : "Masukkan PIN yang sama sekali lagi."}
            pesan={pesan}
            onSelesai={saatSelesai}
            sibuk={sibuk}
          />
        )}
      </ScrollView>
    </View>
  );
}
