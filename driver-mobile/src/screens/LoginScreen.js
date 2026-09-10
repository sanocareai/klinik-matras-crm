// Layar login — palet dari mockup "Sano Driver" (SAMA persis dengan token
// delivery-dark.css di web, lihat catatan panjang di driver-app/ Capacitor
// [styles/driver-app-theme.css]) — sekarang light/dark ikut sistem HP
// (10 Sep 2026, lihat src/theme.js & hooks/useTheme.js). Endpoint login
// SAMA dengan web/Sano Messenger (POST /auth/login) — role apa pun bisa
// login, layar tujuan beda per role (lihat App.js/lib/roles.js).
import React, { useMemo, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, Image,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";

export default function LoginScreen() {
  const { login } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Email dan password wajib diisi");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || "Gagal login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.center}>
        <Image source={require("../../assets/icon.png")} style={styles.logo} />
        <Text style={styles.title}>Sano Driver</Text>
        <Text style={styles.subtitle}>Masuk untuk mulai kerja</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="nama@email.com"
            placeholderTextColor={theme.INK2}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!busy}
          />
          <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={theme.INK2}
            secureTextEntry
            editable={!busy}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Masuk</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.NAVY },
    center: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
    logo: { width: 64, height: 64, borderRadius: 16, marginBottom: 16 },
    title: { fontSize: 24, fontWeight: "800", color: t.INK, letterSpacing: -0.5 },
    subtitle: { fontSize: 13, color: t.INK2, marginTop: 4, marginBottom: 32 },
    card: { width: "100%", maxWidth: 360, backgroundColor: t.SURFACE, borderRadius: 20, padding: 20 },
    label: { fontSize: 11, fontWeight: "700", color: t.INK2, textTransform: "uppercase", letterSpacing: 0.4 },
    input: {
      marginTop: 6, backgroundColor: t.FIELD_BG, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.INK,
    },
    error: { color: t.RED, fontSize: 12.5, marginTop: 12 },
    button: {
      marginTop: 20, backgroundColor: t.ACCENT, borderRadius: 12, paddingVertical: 14,
      alignItems: "center", justifyContent: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  });
}
