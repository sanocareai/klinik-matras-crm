import React, { useEffect } from "react";
import { AppState, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
// Impor per-bobot (bukan barrel) supaya hanya 4 berkas font yang ikut ke aplikasi.
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { preventScreenCaptureAsync, allowScreenCaptureAsync } from "expo-screen-capture";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { ThemeProvider, useTheme } from "@/design/theme";
import { usePrefs } from "@/design/prefs";
import { useSession } from "@/auth/session";
import { useLock } from "@/auth/lock";
import { AppLockGate } from "@/features/lock/AppLockGate";
import { daftarkanPush } from "@/auth/push";
import { ENV } from "@/lib/env";

void SplashScreen.preventAutoHideAsync();

// Cache query: data keuangan diambil ulang dari server saat fokus; tidak di-persist di scaffold ini
// (snapshot terenkripsi = S2/S3, PRD §11.7). Galat 401/403/409 tidak diulang otomatis.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// TanStack Query mengikuti status jaringan & app: kembali online / kembali ke depan → data basi diambil ulang.
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((st) => setOnline(st.isConnected !== false && st.isInternetReachable !== false)));

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  // Pesan singkat, tanpa detail teknis/PII. Layar ini hanya untuk galat JS yang tak tertangani.
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#0A1730" }}>
      <Text style={{ color: "#F2F6FF", fontSize: 18, fontWeight: "600", marginBottom: 8 }}>Terjadi kesalahan</Text>
      <Text style={{ color: "#9DB0D0", fontSize: 14, textAlign: "center", marginBottom: 20 }}>
        Aplikasi mengalami masalah. Data keuangan Anda aman di server.
      </Text>
      <Text onPress={retry} style={{ color: "#4F97E3", fontSize: 15, fontWeight: "600" }}>Coba lagi</Text>
      {__DEV__ ? <Text style={{ color: "#7186A8", marginTop: 16, fontSize: 12 }}>{error.message}</Text> : null}
    </View>
  );
}

function Gerbang() {
  const { colors, isDark } = useTheme();
  const status = useSession((s) => s.status);
  const router = useRouter();
  const { hasShareIntent, shareIntent } = useShareIntentContext();

  // Foto yang dibagikan dari WhatsApp/galeri → langsung ke sheet Transaksi cepat.
  useEffect(() => {
    if (status === "signedIn" && hasShareIntent && shareIntent.files?.length) {
      router.push({ pathname: "/aksi-cepat", params: { dari: "share" } });
    }
  }, [status, hasShareIntent, shareIntent, router]);

  // Daftarkan token push setelah masuk (gagal tidak mengganggu).
  useEffect(() => {
    if (status === "signedIn") void daftarkanPush();
  }, [status]);

  // Anti tangkapan layar di seluruh aplikasi (FLAG_SECURE). Dimatikan di varian development supaya
  // bisa mengambil tangkapan untuk pengujian visual.
  useEffect(() => {
    if (ENV.appEnv === "development") return undefined;
    void preventScreenCaptureAsync();
    return () => { void allowScreenCaptureAsync(); };
  }, []);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgBottom }, animation: "fade_from_bottom" }}>
        <Stack.Protected guard={status === "signedIn"}>
          <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
          <Stack.Screen name="aksi-cepat" options={{ presentation: "transparentModal", animation: "fade" }} />
          <Stack.Screen name="persetujuan/[id]" />
          <Stack.Screen name="laporan/[jenis]" />
          <Stack.Screen name="approval/[jenis]/[id]" />
          <Stack.Screen name="keamanan" />
          <Stack.Screen name="ubah-pin" />
        </Stack.Protected>
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="login" options={{ animation: "none" }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const prefsLoaded = usePrefs((s) => s.loaded);
  const status = useSession((s) => s.status);
  const lockReady = useLock((s) => s.ready);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => focusManager.setFocused(st === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void usePrefs.getState().load();
    void useLock.getState().load();
    void useSession.getState().restore();
  }, []);

  const siap = fontsLoaded && prefsLoaded && lockReady && status !== "loading";
  useEffect(() => {
    if (siap) void SplashScreen.hideAsync();
  }, [siap]);

  if (!siap) return null;

  return (
    <ShareIntentProvider options={{ disabled: isExpoGo }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AppLockGate>
              <Gerbang />
            </AppLockGate>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
