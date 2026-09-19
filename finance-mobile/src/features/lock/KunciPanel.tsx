import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Lock } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { BIOMETRIK_MAKS_GAGAL, sisaJedaDetik, useLock } from "@/auth/lock";
import { useSession } from "@/auth/session";
import { PinPad } from "./PinPad";

// PANEL KUNCI — dipakai layar kunci aplikasi (mode "kunci") dan konfirmasi aksi sensitif (mode "stepup").
// PIN selalu tersedia; biometrik hanya jalan bila diaktifkan dan belum gagal 3 kali (lalu wajib PIN).

type Props = { mode: "kunci" | "stepup"; onBerhasil?: () => void; onBatal?: () => void };

function mmss(detik: number) {
  return `${Math.floor(detik / 60)}:${String(detik % 60).padStart(2, "0")}`;
}

export function KunciPanel({ mode, onBerhasil, onBatal }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const nama = useSession((s) => s.user?.name);
  const verifyPin = useLock((s) => s.verifyPin);
  const unlockBiometric = useLock((s) => s.unlockBiometric);
  const biometricEnabled = useLock((s) => s.biometricEnabled);
  const biometrikGagal = useLock((s) => s.biometrikGagal);
  const sampaiMs = useLock((s) => s.sampaiMs);
  const [pesan, setPesan] = useState<{ teks: string; tone: "error" | "info" } | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [, setTik] = useState(0);
  const otomatis = useRef(false);

  const sisa = sisaJedaDetik(sampaiMs);
  const dijeda = sisa > 0;
  const biometrikBisa = biometricEnabled && biometrikGagal < BIOMETRIK_MAKS_GAGAL && !dijeda;

  useEffect(() => {
    if (!dijeda) return undefined;
    const t = setInterval(() => setTik((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [dijeda]);

  async function cobaBiometrik() {
    setSibuk(true);
    const r = await unlockBiometric();
    setSibuk(false);
    if (r.ok) { haptic.sukses(); onBerhasil?.(); return; }
    if (r.reason !== "dibatalkan") haptic.galat();
    const sisaCoba = BIOMETRIK_MAKS_GAGAL - useLock.getState().biometrikGagal;
    setPesan({
      teks: sisaCoba <= 0 && r.reason !== "dibatalkan" ? "Biometrik dinonaktifkan sementara. Masukkan PIN Anda." : r.pesan,
      tone: r.reason === "dibatalkan" ? "info" : "error",
    });
  }

  // Tawarkan biometrik otomatis satu kali saat panel muncul.
  useEffect(() => {
    if (otomatis.current || !biometrikBisa) return;
    otomatis.current = true;
    void cobaBiometrik();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cobaPin(pin: string) {
    setSibuk(true);
    const r = await verifyPin(pin);
    setSibuk(false);
    if (r.ok) { haptic.sukses(); setPesan(null); onBerhasil?.(); return; }
    haptic.galat();
    switch (r.reason) {
      case "hapus":
        await useSession.getState().logout({ alasan: "PIN_TERLALU_BANYAK_SALAH" });
        return;
      case "jeda":
        setPesan({ teks: `Terlalu banyak salah. Coba lagi dalam ${mmss(r.sisaDetik ?? 30)}.`, tone: "error" });
        return;
      case "salah":
        setPesan({
          teks: `PIN salah.${(r.sisaPercobaan ?? 0) > 0 ? ` ${r.sisaPercobaan} percobaan lagi sebelum dikunci sementara.` : ""}`,
          tone: "error",
        });
        return;
      default:
        setPesan({ teks: "PIN tidak bisa diperiksa. Coba lagi.", tone: "error" });
    }
  }

  function lupaPin() {
    Alert.alert(
      "Lupa PIN?",
      "PIN tidak bisa dipulihkan. Anda akan keluar dari akun, lalu masuk lagi dan membuat PIN baru.",
      [
        { text: "Batal", style: "cancel" },
        { text: "Keluar dari akun", style: "destructive", onPress: () => { void useSession.getState().logout(); } },
      ],
    );
  }

  const kecil = useWindowDimensions().height < 720;
  const pesanTampil = dijeda ? { teks: `Terlalu banyak salah. Coba lagi dalam ${mmss(sisa)}.`, tone: "error" as const } : pesan;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <LinearGradient colors={[colors.bgTop, colors.bgBottom]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: kecil ? 44 : 56, height: kecil ? 44 : 56, borderRadius: kecil ? 22 : 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: kecil ? 10 : 18 }}>
          <Lock size={kecil ? 22 : 26} color={colors.onPrimary} strokeWidth={1.75} />
        </View>
        <PinPad
          judul={mode === "kunci" ? "Masukkan PIN" : "Konfirmasi dulu"}
          sub={mode === "kunci" ? `Halo${nama ? `, ${nama.split(" ")[0]}` : ""}. Buka SANO Finance dengan PIN Anda.` : "Untuk keamanan, masukkan PIN Anda sebelum melanjutkan tindakan ini."}
          pesan={pesanTampil}
          onSelesai={cobaPin}
          sibuk={sibuk}
          nonaktif={dijeda}
          biometrik={biometrikBisa ? { label: "Buka dengan biometrik", onPress: () => { void cobaBiometrik(); } } : null}
        />
        <View style={{ marginTop: kecil ? 8 : 20, alignItems: "center", gap: 14 }}>
          {mode === "stepup" ? (
            <PressableScale onPress={onBatal} accessibilityLabel="Batal" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
              <Text style={{ color: colors.primary, fontFamily: font.semibold, fontSize: 15 }}>Batal</Text>
            </PressableScale>
          ) : (
            <PressableScale onPress={lupaPin} accessibilityLabel="Lupa PIN" style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
              <Text style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 14 }}>Lupa PIN?</Text>
            </PressableScale>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
