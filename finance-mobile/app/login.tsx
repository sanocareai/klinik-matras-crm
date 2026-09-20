import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Eye, EyeOff, Lock } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/design/theme";
import { StatusBarScrim } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, MockBanner, OfflineBanner, PressableScale } from "@/design/ui";
import { useOnline } from "@/hooks/useOnline";
import { useTinggiKeyboard } from "@/hooks/useKeyboard";
import { font, radius, GUTTER } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useSession } from "@/auth/session";
import { pesanSesiHilang, pesanUntukPengguna } from "@/api/errors";
import { ENV } from "@/lib/env";
import { S } from "@/lib/strings";

export default function Login() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useTinggiKeyboard();
  const gulir = useRef<ScrollView>(null);
  // Keyboard muncul → beri ruang di bawah lalu gulir ke bawah agar kolom sandi dan tombol Masuk tetap terlihat.
  useEffect(() => {
    if (keyboard > 0) { const t = setTimeout(() => gulir.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }
    return undefined;
  }, [keyboard]);
  const login = useSession((s) => s.login);
  const sesiHilang = useSession((s) => s.sesiHilang);
  const online = useOnline();
  const [email, setEmail] = useState("");
  const [sandi, setSandi] = useState("");
  const [lihat, setLihat] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function masuk() {
    if (!ENV.useMocks && (!email.trim() || !sandi)) { setGalat(S.login.galatKosong); return; }
    setSibuk(true);
    setGalat(null);
    try {
      await login(email, sandi);
      haptic.sukses();
    } catch (e) {
      haptic.galat();
      setGalat(pesanUntukPengguna(e));
    } finally {
      setSibuk(false);
    }
  }

  const input = {
    color: colors.text, fontFamily: font.regular, fontSize: 16, minHeight: 48, paddingHorizontal: 14,
    borderRadius: radius.button, backgroundColor: colors.solidAlt, borderWidth: 1, borderColor: colors.hairline,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgBottom }}>
      <LinearGradient colors={[colors.bgTop, colors.bgBottom]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView ref={gulir} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: GUTTER, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 + keyboard }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
              <Lock size={32} color={colors.onPrimary} strokeWidth={1.75} />
            </View>
            <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 24, marginTop: 16 }}>{S.login.judul}</Text>
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, marginTop: 6, textAlign: "center" }}>{S.login.sub}</Text>
          </View>

          {ENV.useMocks ? <MockBanner /> : null}
          {!online ? <OfflineBanner /> : null}
          {sesiHilang ? (
            <Text accessibilityRole="alert" style={{ color: colors.warning, fontFamily: font.medium, fontSize: 13, lineHeight: 18, textAlign: "center", marginBottom: 12 }}>
              {pesanSesiHilang(sesiHilang)}
            </Text>
          ) : null}

          <GlassCard variant="strong" padding={18}>
            <Text style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginBottom: 6 }}>{S.login.email}</Text>
            <TextInput
              value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              textContentType="username" autoComplete="username" placeholder="nama@klinikmatras.com" placeholderTextColor={colors.textFaint}
              style={input} accessibilityLabel={S.login.email}
            />
            <Text style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 14, marginBottom: 6 }}>{S.login.sandi}</Text>
            <View style={{ justifyContent: "center" }}>
              <TextInput
                value={sandi} onChangeText={setSandi} secureTextEntry={!lihat} autoCapitalize="none" autoCorrect={false}
                textContentType="password" autoComplete="password" placeholder="••••••••" placeholderTextColor={colors.textFaint}
                style={[input, { paddingRight: 48 }]} accessibilityLabel={S.login.sandi} onSubmitEditing={masuk}
              />
              <PressableScale onPress={() => setLihat((v) => !v)} accessibilityLabel={lihat ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} style={{ position: "absolute", right: 6, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                {lihat ? <EyeOff size={20} color={colors.textMuted} strokeWidth={1.75} /> : <Eye size={20} color={colors.textMuted} strokeWidth={1.75} />}
              </PressableScale>
            </View>
            {galat ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontFamily: font.medium, fontSize: 13, marginTop: 12 }}>{galat}</Text> : null}
            <Button label={S.login.tombol} onPress={masuk} loading={sibuk} disabled={!online && !ENV.useMocks} style={{ marginTop: 18 }} />
            {ENV.useMocks ? <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, lineHeight: 16, marginTop: 10 }}>Mode contoh: isi email apa saja. Awali dengan owner, akuntan, approver, atau tanpaakses untuk mencoba peran lain.</Text> : null}
          </GlassCard>

          <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, textAlign: "center", marginTop: 20 }}>
            {S.app} {ENV.version} · {ENV.variant}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <StatusBarScrim />
    </View>
  );
}
