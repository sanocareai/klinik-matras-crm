import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "@/auth/session";
import { pesanSesiHilang, pesanUntukPengguna } from "@/api/errors";
import { AppIcon } from "@/design/AppIcon";
import { Button, Card, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { ENV } from "@/lib/env";

// LOGIN — akun SANSS pribadi (email kantor + kata sandi). Akun non-produksi ditolak server (NOT_PRODUCTION_TEAM).
export default function Login() {
  const insets = useSafeAreaInsets();
  const login = useSession((s) => s.login);
  const banner = pesanSesiHilang(useSession((s) => s.sesiHilang));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const kirim = async () => {
    if (!email.trim() || !password) { setGalat("Isi email dan kata sandi."); return; }
    setBusy(true); setGalat(null);
    try { await login(email, password); } catch (e) { setGalat(pesanUntukPengguna(e)); } finally { setBusy(false); }
  };

  const input = { height: 54, borderRadius: 14, backgroundColor: C.card, paddingHorizontal: 16, fontFamily: F.regular, fontSize: 17, color: C.ink } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingTop: insets.top + 64, paddingHorizontal: 24, gap: 22 }}>
        <View style={{ alignItems: "center", gap: 14 }}>
          <AppIcon size={96} />
          <T.LargeTitle>SANSS Produksi</T.LargeTitle>
          <T.Body style={{ textAlign: "center" }}>Masuk dengan akun SANSS kamu.</T.Body>
        </View>

        {banner ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{banner}</T.Sub></Card> : null}

        <View style={{ gap: 10 }}>
          <TextInput
            accessibilityLabel="Email"
            placeholder="Email (nama@klinikmatras.com)"
            placeholderTextColor={C.ink3}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            style={input}
          />
          <TextInput
            accessibilityLabel="Kata sandi"
            placeholder="Kata sandi"
            placeholderTextColor={C.ink3}
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={kirim}
            style={input}
          />
        </View>

        {galat ? <T.Sub style={{ color: TONE.red.text, textAlign: "center" }}>{galat}</T.Sub> : null}
        <Button label="Masuk" onPress={kirim} busy={busy} />
        <T.Caption style={{ textAlign: "center" }}>Versi {ENV.version}{ENV.appEnv !== "production" ? ` · ${ENV.appEnv}` : ""}</T.Caption>
      </View>
    </KeyboardAvoidingView>
  );
}
