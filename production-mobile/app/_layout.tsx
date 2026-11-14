import React, { useEffect } from "react";
import { AppState, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { PlusJakartaSans_400Regular } from "@expo-google-fonts/plus-jakarta-sans/400Regular";
import { PlusJakartaSans_500Medium } from "@expo-google-fonts/plus-jakarta-sans/500Medium";
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans/800ExtraBold";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useSession } from "@/auth/session";
import { useKeamanan } from "@/auth/keamanan";
import { GerbangKunci } from "@/features/GerbangKunci";
import { pasangPendengarTautan, segarkanTokenPush } from "@/auth/push";
import { C } from "@/design/tokens";

void SplashScreen.preventAutoHideAsync();

// Data produksi selalu dari server; cache hanya di memori. 401/403 tidak diulang otomatis.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => n < 1 && ![401, 403, 404].includes(Number((e as unknown as { status?: number })?.status)),
      refetchOnWindowFocus: true,
    },
  },
});

// Kembali online / kembali ke depan → data basi diambil ulang; di belakang → polling berhenti.
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((st) => setOnline(st.isConnected !== false && st.isInternetReachable !== false)));

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: C.bg }}>
      <Text style={{ color: C.ink, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>Terjadi kesalahan</Text>
      <Text style={{ color: C.ink2, fontSize: 14, textAlign: "center", marginBottom: 20 }}>Aplikasi mengalami masalah. Data produksi tetap aman di server.</Text>
      <Text onPress={retry} accessibilityRole="button" style={{ color: "#0062CC", fontSize: 16, fontWeight: "600", padding: 12 }}>Coba lagi</Text>
      {__DEV__ ? <Text style={{ color: C.ink3, marginTop: 16, fontSize: 12 }}>{error.message}</Text> : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const status = useSession((s) => s.status);
  const keamananSiap = useKeamanan((s) => s.siap);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      focusManager.setFocused(st === "active");
      // Kunci aplikasi: ke belakang → tutup layar & catat waktu; ke depan → kunci bila lewat batas (src/auth/keamanan.ts).
      if (st === "background") useKeamanan.getState().keBelakang();
      if (st === "active") useKeamanan.getState().keDepan();
      if (st === "active") void useSession.getState().refreshMe(); // perubahan peran berlaku saat app dibuka lagi
    });
    return () => sub.remove();
  }, []);
  useEffect(() => { void useKeamanan.getState().muat(); void useSession.getState().restore(); }, []);

  // Push (hanya bila dinyalakan saat build): segarkan token diam-diam setelah masuk & saat kembali ke aplikasi.
  useEffect(() => {
    if (status !== "signedIn") return undefined;
    void segarkanTokenPush();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void segarkanTokenPush(); });
    return () => sub.remove();
  }, [status]);

  const siap = fontsLoaded && status !== "loading" && keamananSiap; // gerbang kunci siap SEBELUM isi tampil (tidak ada kilasan data)
  useEffect(() => { if (siap) void SplashScreen.hideAsync(); }, [siap]);
  if (!siap) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {/* Transisi native ala iOS (react-native-screens, di thread UI): layar baru meluncur dari kanan, bisa digeser balik dari tepi kiri. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: "ios_from_right", gestureEnabled: true, fullScreenGestureEnabled: true }}>
          <Stack.Protected guard={status === "signedIn"}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="unit/[runId]" />
            <Stack.Screen name="media/[runId]" />
            <Stack.Screen name="langkah/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="tunda/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="qc/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="kurang-bahan/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="diagnosa/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="komponen/[unitId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="catat-bahan/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="rencana-bahan/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="bahan-rework/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="atur-pengerjaan/[runId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="jadwal" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="pic-meja" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="bahan/[unitId]" options={{ animation: "slide_from_bottom" }} />
            <Stack.Screen name="aksi-cepat" options={{ presentation: "transparentModal", animation: "none", gestureEnabled: false, contentStyle: { backgroundColor: "transparent" } }} />
          </Stack.Protected>
          <Stack.Protected guard={status === "signedOut"}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
        {status === "signedIn" ? <TautanNotifikasi /> : null}
        <GerbangKunci />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Ketuk notifikasi → buka layar tujuan (hanya setelah masuk; rute divalidasi daftar putih di lib/tautan.ts). */
function TautanNotifikasi() {
  const router = useRouter();
  useEffect(() => pasangPendengarTautan((rute) => router.push(rute as never)), [router]);
  return null;
}
