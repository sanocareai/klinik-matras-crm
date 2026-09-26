import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../SessionContext";
import { useTheme } from "../theme";
import { Icon } from "../icons";
import { Box, Btn, Gradient } from "../ui";

// KUNCI: muncul saat app dibuka/kembali dari latar belakang dan biometrik aktif. Biometrik hanya membuka sesi lokal;
// sesudahnya sesi tetap divalidasi ke server. Tanpa biometrik yang lolos, jalan keluarnya adalah masuk dengan kata sandi.
export default function LockScreen() {
  const t = useTheme();
  const { bukaKunci, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [pesan, setPesan] = useState("");
  const otomatis = useRef(false);

  const buka = useCallback(async () => {
    setBusy(true); setPesan("");
    try {
      const h = await bukaKunci();
      if (!h.ok && h.pesan && !h.wajibMasukUlang) setPesan(h.pesan);
    } finally { setBusy(false); }
  }, [bukaKunci]);

  useEffect(() => { if (!otomatis.current) { otomatis.current = true; buka(); } }, [buka]);

  return (
    <View style={[StyleSheet.absoluteFill, s.root, { backgroundColor: t.bg }]}>
      <Gradient colors={t.hero} style={s.top}>
        <SafeAreaView edges={["top"]} style={s.topInner}>
          <View style={s.logo}><Icon name="shield" size={24} color="#FFFFFF" /></View>
          <Text style={s.title}>Delivery Control terkunci</Text>
          <Text style={s.sub}>Gunakan biometrik perangkat untuk membuka.</Text>
        </SafeAreaView>
      </Gradient>
      <SafeAreaView edges={["bottom"]} style={s.body}>
        {!!pesan && <Box>{pesan}</Box>}
        <Btn title="Buka dengan biometrik" icon="shield" size="lg" onPress={buka} busy={busy} />
        <Btn title="Masuk dengan kata sandi" kind="secondary" onPress={signOut} disabled={busy} />
        <Text style={{ color: t.ink3, fontSize: 12, textAlign: "center" }}>Masuk dengan kata sandi akan mengakhiri sesi di perangkat ini.</Text>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { zIndex: 100, elevation: 100 },
  top: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  topInner: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 48, gap: 6 },
  logo: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  sub: { color: "rgba(255,255,255,0.78)", fontSize: 14 },
  body: { padding: 20, gap: 12 },
});
