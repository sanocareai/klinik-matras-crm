// Layar Login — email + password, sama dengan akun CRM web.
// Ada opsi "Alamat server" tersembunyi untuk testing dengan server lokal.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import GlassBackdrop from "../components/GlassBackdrop";
import { useTokens } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import { useColors } from "../theme";
import { DEFAULT_SERVER } from "../api";
import {
  biometricAvailable, hasSavedLogin, saveLogin, readSavedLogin, clearSavedLogin,
} from "../lib/savedLogin";

// Auto-buka prompt sidik jari SEKALI per proses app (bukan per mount layar): layar ini bisa
// ter-mount ulang (ganti tema, rotasi, sesi habis) dan tiap mount memicu prompt baru yang
// membatalkan prompt sebelumnya — itu yang membuat pindai harus diulang.
let autoBiometricTried = false;

export default function LoginScreen() {
  const colors = useColors();
  const { glass } = useTokens();
  const styles = useMemo(() => createStyles(colors, glass), [colors, glass]);
  const { login, server } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState(server || DEFAULT_SERVER);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);

  const [hasSaved, setHasSaved] = useState(false);

  // Kalau sudah pernah mengaktifkan login sidik jari, langsung tawarkan prompt
  // sekali saat layar dibuka (tanpa mengetik apa pun).
  useEffect(() => {
    (async () => {
      const saved = await hasSavedLogin();
      setHasSaved(saved);
      if (saved && !autoBiometricTried) {
        autoBiometricTried = true;
        handleBiometric();
      }
    })();
  }, []);

  async function handleBiometric() {
    const cred = await readSavedLogin();
    if (!cred) return; // dibatalkan / sidik jari berubah — tetap bisa ketik manual
    setBusy(true);
    try {
      await login(cred.email, cred.password, cred.server);
    } catch (err) {
      // Hanya hapus data tersimpan kalau server MENOLAK kredensial (bukan saat offline/maintenance).
      if (/salah|tidak valid|nonaktif|401|403/i.test(err.message)) {
        await clearSavedLogin();
        setHasSaved(false);
        Alert.alert("Login gagal", `${err.message}\nLogin sidik jari dinonaktifkan, silakan login manual.`);
      } else {
        Alert.alert("Login gagal", err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert("Login", "Email dan password wajib diisi");
      return;
    }
    setBusy(true);
    try {
      await login(email, password, serverUrl);
    } catch (err) {
      Alert.alert("Login gagal", err.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    // Login berhasil — tawarkan simpan untuk login sidik jari berikutnya.
    if (!hasSaved && (await biometricAvailable())) {
      const cred = { email: email.trim(), password, server: (serverUrl || DEFAULT_SERVER).replace(/\/+$/, "") };
      Alert.alert(
        "Login pakai sidik jari?",
        "Lain kali masuk cukup dengan sidik jari, tanpa mengetik email dan password.",
        [
          { text: "Nanti saja", style: "cancel" },
          { text: "Aktifkan", onPress: () => saveLogin(cred).catch(() => {}) },
        ],
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <GlassBackdrop />
      <View style={styles.card}>
        <Image source={require("../../assets/icon.png")} style={styles.logo} contentFit="contain" />
        <Text style={styles.title}>Klinik Matras CRM</Text>
        <Text style={styles.subtitle}>Ahlinya Kasur Sehat</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="username"
          textContentType="username"
          importantForAutofill="yes"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          autoComplete="current-password"
          textContentType="password"
          importantForAutofill="yes"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {showServer && (
          <TextInput
            style={styles.input}
            placeholder="Alamat server"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            value={serverUrl}
            onChangeText={setServerUrl}
          />
        )}

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={busy}>
          <LinearGradient colors={["#1F6BFF", "#19B5F0"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Masuk</Text>
          )}
        </TouchableOpacity>

        {hasSaved && (
          <>
            <TouchableOpacity style={styles.bioButton} onPress={handleBiometric} disabled={busy}>
              <Text style={styles.bioText}>Masuk dengan sidik jari</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => { await clearSavedLogin(); setHasSaved(false); }}
            >
              <Text style={styles.serverToggle}>Hapus login tersimpan</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => setShowServer((v) => !v)}>
          <Text style={styles.serverToggle}>
            {showServer ? "Sembunyikan alamat server" : "Ubah alamat server"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors, glass) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: glass.tabBarBg, justifyContent: "center", padding: 24 },
    card: {
      ...glass.surface, ...glass.shadow, borderRadius: 26, padding: 24, alignItems: "center",
    },
    logo: { width: 56, height: 56, marginBottom: 4, borderRadius: 14 },
    title: { fontSize: 22, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 20 },
    input: {
      width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12,
      color: colors.text, backgroundColor: "rgba(255,255,255,0.65)", borderColor: "rgba(255,255,255,0.9)",
    },
    button: {
      width: "100%", borderRadius: 99, overflow: "hidden",
      paddingVertical: 15, alignItems: "center", marginTop: 4,
      shadowColor: "#19B5F0", shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    },
    buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    bioButton: {
      width: "100%", borderWidth: 1.5, borderColor: colors.primary, borderRadius: 99,
      paddingVertical: 13, alignItems: "center", marginTop: 10,
    },
    bioText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
    serverToggle: { marginTop: 16, fontSize: 12, color: colors.textMuted },
  });
}
