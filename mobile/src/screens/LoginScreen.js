// Layar Login — email + password, sama dengan akun CRM web.
// Ada opsi "Alamat server" tersembunyi untuk testing dengan server lokal.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Image } from "expo-image";
import { useAuth } from "../context/AuthContext";
import { useColors } from "../theme";
import { DEFAULT_SERVER } from "../api";
import {
  biometricAvailable, hasSavedLogin, saveLogin, readSavedLogin, clearSavedLogin,
} from "../lib/savedLogin";

export default function LoginScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { login, server } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState(server || DEFAULT_SERVER);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);

  const [hasSaved, setHasSaved] = useState(false);
  const autoTried = useRef(false);

  // Kalau sudah pernah mengaktifkan login sidik jari, langsung tawarkan prompt
  // sekali saat layar dibuka (tanpa mengetik apa pun).
  useEffect(() => {
    (async () => {
      const saved = await hasSavedLogin();
      setHasSaved(saved);
      if (saved && !autoTried.current) {
        autoTried.current = true;
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

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.header, justifyContent: "center", padding: 24 },
    card: {
      backgroundColor: colors.card, borderRadius: 16, padding: 24, alignItems: "center",
    },
    logo: { width: 56, height: 56, marginBottom: 4, borderRadius: 14 },
    title: { fontSize: 22, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 20 },
    input: {
      width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12,
      color: colors.text, backgroundColor: colors.bg,
    },
    button: {
      width: "100%", backgroundColor: colors.header, borderRadius: 10,
      paddingVertical: 14, alignItems: "center", marginTop: 4,
    },
    buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    bioButton: {
      width: "100%", borderWidth: 1, borderColor: colors.header, borderRadius: 10,
      paddingVertical: 13, alignItems: "center", marginTop: 10,
    },
    bioText: { color: colors.header, fontWeight: "700", fontSize: 15 },
    serverToggle: { marginTop: 16, fontSize: 12, color: colors.textMuted },
  });
}
