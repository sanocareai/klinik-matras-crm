import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { Aurora } from "@/design/Aurora";
import { useKurangiGerak } from "@/design/gerak";
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

const PENDAR_LOGO = require("../assets/latar/pendar-bulat.png");

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

  const input = { height: 54, borderRadius: 27, backgroundColor: C.card, paddingHorizontal: 20, fontFamily: F.medium, fontSize: 16.5, color: C.ink } as const;

  // PEMBUKA IMMERSIVE: menyambung dari splash (biru pekat + logo di tengah) → logo naik dengan pegas, judul memudar masuk,
  // kartu kaca meluncur naik; sesudahnya logo "melayang" pelan. Semua transform/opacity native driver; "Kurangi gerakan" → langsung tampil.
  const kurangi = useKurangiGerak();
  const [masuk] = useState(() => new Animated.Value(kurangi ? 1 : 0));
  const [kartu] = useState(() => new Animated.Value(kurangi ? 1 : 0));
  const [layang] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (kurangi) { masuk.setValue(1); kartu.setValue(1); return; }
    Animated.sequence([
      Animated.spring(masuk, { toValue: 1, damping: 14, stiffness: 120, mass: 1, useNativeDriver: true }),
    ]).start();
    Animated.spring(kartu, { toValue: 1, damping: 18, stiffness: 140, mass: 1, delay: 260, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(layang, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(layang, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const mulai = setTimeout(() => loop.start(), 900);
    return () => { clearTimeout(mulai); loop.stop(); };
  }, [kurangi, masuk, kartu, layang]);
  const gayaLogo = {
    transform: [
      { translateY: Animated.add(masuk.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }), layang.interpolate({ inputRange: [0, 1], outputRange: [0, -6] })) },
      { scale: masuk.interpolate({ inputRange: [0, 1], outputRange: [1.25, 1] }) },
    ],
  };
  const gayaJudul = { opacity: masuk, transform: [{ translateY: masuk.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] };
  const gayaKartu = { opacity: kartu, transform: [{ translateY: kartu.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] };
  const PUTIH_LEMBUT = "#D6E6FF";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "#0A55D1" }}>
      <StatusBar style="light" />
      <Aurora />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingTop: insets.top + 32, paddingBottom: insets.bottom + 28, paddingHorizontal: 22, gap: 22 }}>
        <View style={{ alignItems: "center", gap: 14 }}>
          <Animated.View style={gayaLogo}>
            {/* pendar halus di belakang logo (gambar blur) — bukan kotak membulat bertepi */}
            <Image source={PENDAR_LOGO} tintColor="#8CC8FF" contentFit="fill" transition={0} accessible={false} style={{ position: "absolute", top: -78, left: -78, width: 260, height: 260, opacity: 0.55 }} />
            <AppIcon size={104} />
          </Animated.View>
          <Animated.View style={[{ alignItems: "center", gap: 4 }, gayaJudul]}>
            <T.LargeTitle style={{ color: C.white }}>SANSS Produksi</T.LargeTitle>
            <T.Body style={{ textAlign: "center", color: PUTIH_LEMBUT }}>Masuk dengan akun SANSS kamu.</T.Body>
          </Animated.View>
        </View>

        <Animated.View style={[{ gap: 16, padding: 18, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.13)", borderWidth: 1, borderColor: "rgba(255,255,255,0.32)" }, gayaKartu]}>
        {banner ? <Card style={{ backgroundColor: TONE.orange.tint }} solid><T.Sub style={{ color: TONE.orange.text }}>{banner}</T.Sub></Card> : null}

        {adaCepat ? (
          <View style={{ gap: 8 }}>
            <Button kind="tinted" icon={<IkonMetode info={k.info} size={22} />} label={`Masuk dengan ${metode}`} onPress={() => void cepat()} busy={busy === "cepat"} disabled={!!busy} />
            <T.Caption style={{ textAlign: "center", color: PUTIH_LEMBUT }}>{k.loginCepatEmail}</T.Caption>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.25)" }} />
              <T.Caption style={{ color: PUTIH_LEMBUT }}>atau ketik kata sandi</T.Caption>
              <View style={{ flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.25)" }} />
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

        {info ? <Card style={{ backgroundColor: TONE.orange.tint }} solid><T.Sub style={{ color: TONE.orange.text }}>{info}</T.Sub></Card> : null}
        {galat ? <Card style={{ backgroundColor: TONE.red.tint }} solid><T.Sub style={{ color: TONE.red.text, textAlign: "center" }}>{galat}</T.Sub></Card> : null}
        <Button kind="tinted" label="Masuk" onPress={() => void manual()} busy={busy === "manual"} disabled={!!busy} />
        </Animated.View>
        <T.Caption style={{ textAlign: "center", color: PUTIH_LEMBUT }}>Versi {ENV.version}{ENV.appEnv !== "production" ? ` · ${ENV.appEnv}` : ""}</T.Caption>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
