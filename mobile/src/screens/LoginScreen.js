// Layar Login — email + password, sama dengan akun CRM web.
// Ada opsi "Alamat server" tersembunyi untuk testing dengan server lokal.
import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";
import { DEFAULT_SERVER } from "../api";

export default function LoginScreen() {
  const { login, server } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [serverUrl, setServerUrl] = useState(server || DEFAULT_SERVER);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>🛏️</Text>
        <Text style={styles.title}>Klinik Matras CRM</Text>
        <Text style={styles.subtitle}>Ahlinya Kasur Sehat</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
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

        <TouchableOpacity onPress={() => setShowServer((v) => !v)}>
          <Text style={styles.serverToggle}>
            {showServer ? "Sembunyikan alamat server" : "Ubah alamat server"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.header, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: colors.card, borderRadius: 16, padding: 24, alignItems: "center",
  },
  logo: { fontSize: 48, marginBottom: 4 },
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
  serverToggle: { marginTop: 16, fontSize: 12, color: colors.textMuted },
});
