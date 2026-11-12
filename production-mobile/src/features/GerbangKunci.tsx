import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Fingerprint, KeyRound, ScanFace } from "lucide-react-native";
import { labelMetode, type InfoPerangkat } from "@/auth/biometrik";
import { useKeamanan } from "@/auth/keamanan";
import { useSession } from "@/auth/session";
import { AppIcon } from "@/design/AppIcon";
import { Button, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// GERBANG KUNCI — menutup SELURUH layar (di atas navigasi, isi formulir tetap utuh di bawahnya) saat:
//   • tutup   : aplikasi sedang di latar belakang → isi tidak terlihat di daftar aplikasi terbaru;
//   • terkunci: kunci aplikasi aktif dan dibuka dari nol / kembali setelah batas waktu.
// Dialog sidik jari / wajah / PIN HP muncul otomatis sekali; tombol untuk mencoba lagi. Selalu ada jalan keluar (Keluar).

export function IkonMetode({ info, size = 30, color = "#fff" }: { info: InfoPerangkat; size?: number; color?: string }) {
  if (info.status !== "tersedia") return <KeyRound color={color} size={size} />;
  return info.jenis.includes("wajah") && !info.jenis.includes("sidik_jari") ? <ScanFace color={color} size={size} /> : <Fingerprint color={color} size={size} />;
}

export function GerbangKunci() {
  const insets = useSafeAreaInsets();
  const masuk = useSession((s) => s.status === "signedIn");
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const terkunci = useKeamanan((s) => s.terkunci);
  const tutup = useKeamanan((s) => s.tutup);
  const info = useKeamanan((s) => s.info);
  const buka = useKeamanan((s) => s.buka);
  const [busy, setBusy] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);
  const sudahOtomatis = useRef(false);

  const coba = async () => {
    setBusy(true); setPesan(null);
    const r = await buka();
    if (!r.ok && r.alasan !== "dibatalkan") setPesan(r.pesan);
    setBusy(false);
  };

  // Dialog otomatis SEKALI per penguncian, hanya saat aplikasi benar-benar di depan.
  const aktif = masuk && terkunci;
  useEffect(() => {
    if (!aktif) { sudahOtomatis.current = false; return undefined; }
    const jalankan = () => {
      if (sudahOtomatis.current || AppState.currentState !== "active") return;
      sudahOtomatis.current = true;
      void coba();
    };
    jalankan();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") jalankan(); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktif]);

  if (!masuk || (!terkunci && !tutup)) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, zIndex: 1000, elevation: 1000 }]} accessibilityViewIsModal>
      {terkunci ? (
        <View style={{ flex: 1, paddingTop: insets.top + 96, paddingHorizontal: 28, alignItems: "center", gap: 18 }}>
          <AppIcon size={84} />
          <T.Title>SANSS Produksi terkunci</T.Title>
          {user?.name ? <T.Sub>{user.name}</T.Sub> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Buka dengan ${labelMetode(info)}`} onPress={() => void coba()} disabled={busy}
            style={{ marginTop: 24, width: 88, height: 88, borderRadius: 44, backgroundColor: TONE.blue.fill, alignItems: "center", justifyContent: "center", opacity: busy ? 0.6 : 1 }}>
            <IkonMetode info={info} size={42} />
          </Pressable>
          <T.Sub style={{ textAlign: "center" }}>Buka dengan {labelMetode(info)}</T.Sub>
          {pesan ? <T.Sub style={{ color: TONE.red.text, textAlign: "center" }}>{pesan}</T.Sub> : null}
          <View style={{ flex: 1 }} />
          <View style={{ alignSelf: "stretch", paddingBottom: insets.bottom + 24 }}>
            <Button kind="tinted" tone="red" label="Keluar dari akun" onPress={() => void logout()} />
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><AppIcon size={84} /></View>
      )}
    </View>
  );
}
