import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eye, EyeOff } from "lucide-react-native";
import { useSession } from "@/auth/session";
import { useKeamanan } from "@/auth/keamanan";
import { labelMetode } from "@/auth/biometrik";
import { ApiError, pesanSesiHilang, pesanUntukPengguna } from "@/api/errors";
import { IkonMetode } from "@/features/GerbangKunci";
import { AppIcon } from "@/design/AppIcon";
import { CentangBaris } from "@/design/Form";
import { Button, Card, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { ENV } from "@/lib/env";

// LOGIN — akun SANSS pribadi (email kantor + kata sandi). Akun non-produksi ditolak server (NOT_PRODUCTION_TEAM).
// MASUK CEPAT: email + kata sandi tersimpan di Keystore HP, dibuka dengan sidik jari / wajah / PIN HP (src/auth/keamanan.ts).
// Kolom diberi tanda autofill supaya pengelola sandi (Google Password Manager) juga bisa menyimpan & mengisi.
export default function Login() {
  const insets = useSafeAreaInsets();
  const login = useSession((s) => s.login);
  const banner = pesanSesiHilang(useSession((s) => s.sesiHilang));
  const k = useKeamanan();
  const [email, setEmail] = useState(k.emailTerakhir ?? "");
  const [password, setPassword] = useState("");
  const [lihat, setLihat] = useState(false);
  const bisaCepat = k.info.status !== "tidak_ada";
  const [simpanCepat, setSimpanCepat] = useState(true);
  const [busy, setBusy] = useState<"" | "manual" | "cepat">("");
  const [galat, setGalat] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sandiRef = useRef<TextInput>(null);
  const metode = labelMetode(k.info);
  const adaCepat = !!k.loginCepatEmail;

  const manual = async () => {
    if (!email.trim() || !password) { setGalat("Isi email dan kata sandi."); return; }
    setBusy("manual"); setGalat(null); setInfo(null);
    const tawarkan = bisaCepat && simpanCepat && !adaCepat;
    try {
      await login(email, password);
      // Sesudah berhasil masuk (kata sandi terbukti benar): simpan untuk masuk cepat — wajib lolos sidik jari/wajah/PIN HP sekali.
      // Dibatalkan = tetap masuk, hanya tidak disimpan.
      if (tawarkan) await useKeamanan.getState().simpanLoginCepat(email, password);
    } catch (e) {
      setGalat(pesanUntukPengguna(e));
      setBusy("");
    }
  };

  const cepat = async () => {
    setBusy("cepat"); setGalat(null); setInfo(null);
    const r = await useKeamanan.getState().ambilLoginCepat();
    if (!r.ok) { if (!r.dibatalkan) setGalat(r.pesan); setBusy(""); return; }
    try {
      await login(r.email, r.password);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Kata sandi tersimpan sudah tidak berlaku (diganti/direset) → hapus, minta masuk manual; email tetap terisi.
        await useKeamanan.getState().hapusLoginCepat();
        setEmail(r.email);
        setInfo(`Kata sandi tersimpan sudah tidak berlaku. Masuk dengan kata sandi terbaru — masuk cepat bisa diaktifkan lagi.`);
        sandiRef.current?.focus();
      } else {
        setGalat(pesanUntukPengguna(e));
      }
      setBusy("");
    }
  };

  // Ada masuk cepat → dialog sidik jari/wajah langsung muncul sekali saat layar dibuka (seperti aplikasi bank).
  const otomatis = useRef(false);
  useEffect(() => {
    if (!adaCepat || otomatis.current || !k.siap) return;
    otomatis.current = true;
    void cepat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adaCepat, k.siap]);

  const input = { height: 54, borderRadius: 14, backgroundColor: C.card, paddingHorizontal: 16, fontFamily: F.regular, fontSize: 17, color: C.ink } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32, paddingHorizontal: 24, gap: 20 }}>
        <View style={{ alignItems: "center", gap: 14 }}>
          <AppIcon size={96} />
          <T.LargeTitle>SANSS Produksi</T.LargeTitle>
          <T.Body style={{ textAlign: "center" }}>Masuk dengan akun SANSS kamu.</T.Body>
        </View>

        {banner ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{banner}</T.Sub></Card> : null}

        {adaCepat ? (
          <View style={{ gap: 8 }}>
            <Button kind="primary" icon={<IkonMetode info={k.info} size={22} />} label={`Masuk dengan ${metode}`} onPress={() => void cepat()} busy={busy === "cepat"} disabled={!!busy} />
            <T.Caption style={{ textAlign: "center" }}>{k.loginCepatEmail}</T.Caption>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: C.barLine }} />
              <T.Caption>atau ketik kata sandi</T.Caption>
              <View style={{ flex: 1, height: 1, backgroundColor: C.barLine }} />
            </View>
          </View>
        ) : null}

        <View style={{ gap: 10 }}>
          <TextInput
            accessibilityLabel="Email"
            placeholder="Email (nama@klinikmatras.com)"
            placeholderTextColor={C.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            importantForAutofill="yes"
            keyboardType="email-address"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => sandiRef.current?.focus()}
            style={input}
          />
          <View style={{ justifyContent: "center" }}>
            <TextInput
              ref={sandiRef}
              accessibilityLabel="Kata sandi"
              placeholder="Kata sandi"
              placeholderTextColor={C.ink3}
              secureTextEntry={!lihat}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              importantForAutofill="yes"
              returnKeyType="go"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void manual()}
              style={[input, { paddingRight: 56 }]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={lihat ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} onPress={() => setLihat((v) => !v)}
              style={{ position: "absolute", right: 4, width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
              {lihat ? <EyeOff color={C.ink3} size={20} /> : <Eye color={C.ink3} size={20} />}
            </Pressable>
          </View>
          {bisaCepat && !adaCepat ? (
            <CentangBaris label={`Simpan untuk masuk cepat dengan ${metode}`} value={simpanCepat} onChange={setSimpanCepat} />
          ) : null}
        </View>

        {info ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{info}</T.Sub></Card> : null}
        {galat ? <T.Sub style={{ color: TONE.red.text, textAlign: "center" }}>{galat}</T.Sub> : null}
        <Button kind={adaCepat ? "tinted" : "primary"} label="Masuk" onPress={() => void manual()} busy={busy === "manual"} disabled={!!busy} />
        <T.Caption style={{ textAlign: "center" }}>Versi {ENV.version}{ENV.appEnv !== "production" ? ` · ${ENV.appEnv}` : ""}</T.Caption>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
