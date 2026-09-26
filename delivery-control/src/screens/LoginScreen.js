import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AccessDeniedError } from "@sano/delivery-shared";
import { useSession } from "../SessionContext";
import { useTheme } from "../theme";

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
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
        <Text style={[s.brand, { color: t.accent }]}>SANO</Text>
        <Text style={[s.title, { color: t.ink }]}>Delivery Control</Text>
        <Text style={[s.sub, { color: t.ink2 }]}>Untuk Admin dan Owner. Masuk dengan akun Sano Anda.</Text>
        {!!error && <View style={[s.err, { backgroundColor: t.redBg }]}><Text style={{ color: t.red, fontSize: 13 }}>{error}</Text></View>}
        <TextInput
          value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={t.ink3}
          autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
          style={[s.input, { backgroundColor: t.field, color: t.ink, borderColor: t.border }]}
        />
        <TextInput
          value={password} onChangeText={setPassword} placeholder="Kata sandi" placeholderTextColor={t.ink3} secureTextEntry
          onSubmitEditing={submit}
          style={[s.input, { backgroundColor: t.field, color: t.ink, borderColor: t.border }]}
        />
        <Pressable onPress={submit} disabled={busy} style={[s.btn, { backgroundColor: t.accent, opacity: busy ? 0.6 : 1 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Masuk</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  wrap: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  brand: { fontSize: 13, fontWeight: "800", letterSpacing: 3 },
  title: { fontSize: 30, fontWeight: "800" },
  sub: { fontSize: 14, marginBottom: 8 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  btn: { height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  err: { borderRadius: 10, padding: 12 },
});
