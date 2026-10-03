import React, { useEffect, useRef } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import { SessionProvider, useSession } from "./src/SessionContext";
import { useTheme } from "./src/theme";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BiayaArmadaScreen from "./src/screens/BiayaArmadaScreen";
import BiayaDetailScreen from "./src/screens/BiayaDetailScreen";
import BiayaFormScreen from "./src/screens/BiayaFormScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import KruScreen from "./src/screens/KruScreen";
import KruDetailScreen from "./src/screens/KruDetailScreen";
import RuteScreen from "./src/screens/RuteScreen";
import RuteDetailScreen from "./src/screens/RuteDetailScreen";
import TrackingScreen from "./src/screens/TrackingScreen";
import MasalahScreen from "./src/screens/MasalahScreen";
import MasalahDetailScreen from "./src/screens/MasalahDetailScreen";
import PerformaScreen from "./src/screens/PerformaScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import LockScreen from "./src/screens/LockScreen";
import { PengaturanProvider, usePengaturan } from "./src/PengaturanContext";

SplashScreen.preventAutoHideAsync().catch(() => {});
const Stack = createNativeStackNavigator();

function Root() {
  const t = useTheme();
  const { loading, session, modules, terkunci } = useSession();
  const { siap } = usePengaturan();
  useEffect(() => { if (!loading) SplashScreen.hideAsync().catch(() => {}); }, [loading]);

  if (loading || !siap) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}><ActivityIndicator color={t.accent} /></View>;
  }
  // Buka dingin dalam keadaan terkunci: navigator tidak dirender (tidak ada sesi/token yang dibaca sebelum biometrik lolos).
  if (terkunci && !session) return <LockScreen />;
  return (
    <View style={{ flex: 1 }}>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{
        headerStyle: { backgroundColor: t.bg }, headerTintColor: t.ink, headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800", fontSize: 18 }, contentStyle: { backgroundColor: t.bg }, animation: "slide_from_right",
      }}>
        {session ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false, animation: "fade" }} />
            <Stack.Screen name="BiayaArmada" component={BiayaArmadaScreen} options={{ title: "Biaya Armada", headerShown: false, animation: "fade" }} />
            <Stack.Screen name="BiayaDetail" component={BiayaDetailScreen} options={{ title: "Detail biaya" }} />
            <Stack.Screen name="BiayaForm" component={BiayaFormScreen} options={({ route }) => ({ title: route.params?.id ? "Perbaiki pengajuan" : "Tambah pengajuan" })} />
            <Stack.Screen name="Akun" component={ProfileScreen} options={{ headerShown: false, animation: "fade" }} />
            <Stack.Screen name="Pengaturan" component={SettingsScreen} options={{ title: "Pengaturan" }} />
            {/* Modul operasional hanya didaftarkan bila capability server mengizinkan (izin tetap ditegakkan server). */}
            {modules.dashboard && <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Dashboard operasional" }} />}
            {modules.drivers && <Stack.Screen name="Kru" component={KruScreen} options={{ title: "Driver & Helper" }} />}
            {modules.drivers && <Stack.Screen name="KruDetail" component={KruDetailScreen} options={({ route }) => ({ title: route.params?.name || "Riwayat kru" })} />}
            {modules.routes && <Stack.Screen name="Rute" component={RuteScreen} options={{ title: "Rute" }} />}
            {modules.routes && <Stack.Screen name="RuteDetail" component={RuteDetailScreen} options={{ title: "Detail rute" }} />}
            {modules.tracking && <Stack.Screen name="Tracking" component={TrackingScreen} options={{ title: "Tracking" }} />}
            {modules.issues && <Stack.Screen name="Masalah" component={MasalahScreen} options={{ title: "Masalah & jadwal ulang" }} />}
            {modules.issues && <Stack.Screen name="MasalahDetail" component={MasalahDetailScreen} options={{ title: "Detail masalah" }} />}
            {modules.performance && <Stack.Screen name="Performa" component={PerformaScreen} options={{ title: "Performa & insentif" }} />}
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
    {terkunci && <LockScreen />}
    </View>
  );
}

function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.statusBar} backgroundColor={t.bg} />;
}

// Bawaan expo-updates: cek pembaruan OTA cuma sekali saat cold start, dan bundel baru baru DIPAKAI
// di cold start BERIKUTNYA — pengguna perlu tutup-paksa lalu buka lagi dua kali sebelum lihat perubahan.
// Di sini dicek+terapkan sendiri di latar belakang (saat dibuka & tiap kembali ke foreground) supaya satu
// kali buka app sudah cukup; reloadAsync me-restart JS bundle di tempat (bukan restart OS), jadi pengguna
// yang sedang mengisi form tetap bisa kehilangan progres — risiko diterima untuk app internal admin/owner ini.
let sedangMemeriksa = false;
async function periksaPembaruan() {
  if (__DEV__ || !Updates.isEnabled || sedangMemeriksa) return;
  sedangMemeriksa = true;
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Offline atau EAS tak terjangkau: diam-diam lewati, app tetap jalan dengan bundel yang ada.
  } finally {
    sedangMemeriksa = false;
  }
}

export default function App() {
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    periksaPembaruan();
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active") periksaPembaruan();
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PengaturanProvider>
          <SessionProvider>
            <ThemedStatusBar />
            <Root />
          </SessionProvider>
        </PengaturanProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
