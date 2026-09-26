import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AccessDeniedError } from "@sano/delivery-shared";
import { useSession } from "../SessionContext";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Box, Btn, Field, Gradient } from "../ui";

export default function LoginScreen() {
  const t = useTheme();
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!email.trim() || !password) { setError("Email dan kata sandi wajib diisi"); return; }
    setBusy(true); setError("");
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof AccessDeniedError
        ? "Akun ini tidak punya akses ke Sano Delivery Control. Driver dan helper memakai aplikasi Sano Driver."
        : e.message || "Gagal masuk");
    } finally { setBusy(false); }
  }

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <Gradient colors={t.hero} style={s.top}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[s.pill, { right: -24, top: 70, width: 150 }]} />
          <View style={[s.pill, { right: 60, top: 124, width: 90, opacity: 0.1 }]} />
          <View style={[s.pill, { right: -40, top: 178, width: 170, opacity: 0.07 }]} />
        </View>
        <SafeAreaView edges={["top"]} style={s.topInner}>
          <View style={s.logo}><Icon name="truck" size={22} color="#FFFFFF" /></View>
          <Text style={s.brand}>SANO</Text>
          <Text style={s.title}>Delivery Control</Text>
          <Text style={s.sub}>Pantau dan kendalikan biaya armada dari genggaman.</Text>
        </SafeAreaView>
      </Gradient>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, marginTop: -40 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 2)]}>
            <Text style={[type.heading, { color: t.ink, fontSize: 20 }]}>Masuk</Text>
            <Text style={{ color: t.ink2, fontSize: 13, marginTop: -6 }}>Untuk Admin dan Owner. Masuk dengan akun Sano Anda.</Text>
            {!!error && <Box>{error}</Box>}
            <Field
              label="Email" icon="user" value={email} onChangeText={setEmail} placeholder="nama@perusahaan.com"
              autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
            />
            <Field
              label="Kata sandi" icon="shield" value={password} onChangeText={setPassword} placeholder="Kata sandi" secureTextEntry
              onSubmitEditing={submit}
            />
            <Btn title="Masuk" onPress={submit} busy={busy} size="lg" icon="arrowUpRight" />
          </View>
          <View style={s.foot}>
            <Icon name="info" size={14} color={t.ink3} />
            <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>Driver dan helper memakai aplikasi Sano Driver.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  topInner: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 64, gap: 4 },
  pill: { position: "absolute", height: 40, borderRadius: 20, backgroundColor: "#FFFFFF", opacity: 0.12 },
  logo: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  brand: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "800", letterSpacing: 3 },
  title: { color: "#FFFFFF", fontSize: 32, fontWeight: "800", letterSpacing: -0.6 },
  sub: { color: "rgba(255,255,255,0.78)", fontSize: 14, maxWidth: 300 },
  body: { paddingHorizontal: 18, paddingBottom: 32, gap: 14 },
  card: { borderRadius: radius.xl, borderWidth: 1, padding: 20, gap: 14 },
  foot: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
});
