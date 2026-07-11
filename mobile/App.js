// Entry point aplikasi mobile Klinik Matras CRM.
// Navigasi: Login → Daftar Percakapan → Chat → Info Pelanggan
import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { isExpoGo, getLaunchNotificationResponse } from "./src/push";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, View, Text, TextInput } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import ChatListScreen from "./src/screens/ChatListScreen";
import ChatScreen from "./src/screens/ChatScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import InAppBanner from "./src/components/InAppBanner";
import { colors } from "./src/theme";
import { tokens } from "./src/constants/theme";
import { queryClient } from "./src/lib/queryClient";
import { useSocketEvents } from "./src/hooks/useSocketEvents";
import { useBadgeSync } from "./src/hooks/useBadgeSync";
import { initOutboxFlush } from "./src/lib/outboxFlush";
import { navigationRef, navigateToChat } from "./src/lib/navigationRef";

const Stack = createNativeStackNavigator();

// InboxScreen (M-B) pakai desain light-blue baru — beda dari Login/Chat yang
// masih gaya header biru tua lama. Warna strip status bar/notch ikut
// menyesuaikan layar aktif supaya tidak ada strip gelap ganjil di atas Inbox
// yang sudah terang.
//
// ⚠️ SafeAreaTopBg MEMBUNGKUS <NavigationContainer><Root/></NavigationContainer>
// dari LUAR Stack.Navigator (lihat App()) — jadi tidak bisa pakai
// useNavigationState/useRoute di sini, komponen ini BUKAN keturunan
// Stack.Navigator, cuma keturunan NavigationContainer (yang provide
// context "default" kosong sebelum ada Navigator aktif → error "Couldn't
// get the navigation state. Is your component inside a navigator?").
// Pola resmi React Navigation untuk kasus ini: pasang onStateChange di
// NavigationContainer, simpan nama route aktif ke state di App(), lalu
// teruskan sebagai prop ke sini.
const LIGHT_SCREENS = ["ChatList", "Profile"];
function SafeAreaTopBg({ routeName, children }) {
  const isLight = LIGHT_SCREENS.includes(routeName);
  const bg = isLight ? tokens.color.bg : colors.header;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <StatusBar style={isLight ? "dark" : "light"} />
      {children}
    </SafeAreaView>
  );
}

function respondToNotification(response) {
  const { conversationId, customerId, isGroup } = response?.notification?.request?.content?.data || {};
  const name = response?.notification?.request?.content?.title || "Pelanggan";
  navigateToChat({ conversationId, name, isGroup: !!isGroup, customerId });
}

function Root() {
  const { user, loading } = useAuth();

  // Socket.IO event → store, dan flush antrean outbox — aktif selama user
  // login, tidak peduli sedang di layar mana (Inbox/Chat/Customer).
  useSocketEvents();
  // Badge angka ikon app mengikuti total unread — lihat useBadgeSync.js.
  useBadgeSync();
  useEffect(() => {
    if (!user) return;
    const unsubscribe = initOutboxFlush();
    return unsubscribe;
  }, [user]);

  // Ketuk notifikasi → langsung buka chat percakapan itu. Nama customer
  // diambil dari judul notifikasi (dikirim backend). Dilewati di Expo Go —
  // lihat catatan isExpoGo di src/push.js.
  //
  // 2 jalur ditangani (keduanya perlu, tidak saling gantikan):
  // 1. addNotificationResponseReceivedListener — app sudah berjalan
  //    (foreground/background), user tap notifikasi → listener ini terpanggil.
  // 2. getLaunchNotificationResponse() — app di-COLD-START (killed) lewat tap
  //    notifikasi. Listener #1 baru terpasang SETELAH app selesai boot, jadi
  //    response yang justru me-launch app bisa lewat tanpa terdeteksi kalau
  //    HANYA mengandalkan listener — perlu dicek eksplisit sekali di awal.
  useEffect(() => {
    if (isExpoGo || !user) return;
    getLaunchNotificationResponse().then((response) => {
      if (response) respondToNotification(response);
    });
    const Notifications = require("expo-notifications");
    const sub = Notifications.addNotificationResponseReceivedListener(respondToNotification);
    return () => sub.remove();
  }, [user]);

  // Masih membaca token tersimpan dari storage
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.header }}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="ChatList" component={ChatListScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
      {user && <InAppBanner />}
    </>
  );
}

// Terapkan Inter sebagai font default global (konsisten dengan CRM web) —
// dipasang sekali lewat defaultProps Text/TextInput, bukan per komponen.
let interAppliedGlobally = false;
function applyInterGlobally() {
  if (interAppliedGlobally) return;
  interAppliedGlobally = true;
  Text.defaultProps = Text.defaultProps || {};
  Text.defaultProps.style = [{ fontFamily: "Inter_400Regular" }, Text.defaultProps.style];
  TextInput.defaultProps = TextInput.defaultProps || {};
  TextInput.defaultProps.style = [{ fontFamily: "Inter_400Regular" }, TextInput.defaultProps.style];
}

export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [routeName, setRouteName] = useState();

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.header }} />;
  }
  applyInterGlobally();

  // Update nama route aktif lewat navigationRef (bukan hook) — dibaca ulang
  // saat navigator pertama kali siap (onReady) dan tiap kali state navigasi
  // berubah (onStateChange, misal push/pop/back).
  function syncRouteName() {
    setRouteName(navigationRef.getCurrentRoute()?.name);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <AuthProvider>
              <NavigationContainer
                ref={navigationRef}
                onReady={syncRouteName}
                onStateChange={syncRouteName}
              >
                <SafeAreaTopBg routeName={routeName}>
                  <Root />
                </SafeAreaTopBg>
              </NavigationContainer>
            </AuthProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
