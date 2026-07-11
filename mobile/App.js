// Entry point aplikasi mobile Klinik Matras CRM.
// Navigasi: Login → Daftar Percakapan → Chat → Info Pelanggan
import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { House, MessageCircle, Users, UserRound } from "lucide-react-native";
import { isExpoGo, getLaunchNotificationResponse } from "./src/push";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, View, Text, TextInput, StyleSheet, Pressable } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import ChatListScreen from "./src/screens/ChatListScreen";
import ChatScreen from "./src/screens/ChatScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import HomeScreen from "./src/screens/HomeScreen";
import PelangganScreen from "./src/screens/PelangganScreen";
import InAppBanner from "./src/components/InAppBanner";
import { colors } from "./src/theme";
import { tokens } from "./src/constants/theme";
import { queryClient } from "./src/lib/queryClient";
import { useSocketEvents } from "./src/hooks/useSocketEvents";
import { useBadgeSync } from "./src/hooks/useBadgeSync";
import { initOutboxFlush } from "./src/lib/outboxFlush";
import { navigationRef, navigateToChat } from "./src/lib/navigationRef";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// 4 tab bawah — gaya flat full-width ala Instagram (review Gilang: buang
// konsep floating/rounded/pill sebelumnya). Ikon lucide polos TANPA
// lingkaran/pill background sama sekali — aktif cuma beda warna+ketebalan
// stroke, non-aktif slate-400 biasa.
const TAB_ICONS = { Home: House, Chats: MessageCircle, Pelanggan: Users, Profil: UserRound };

// Tinggi AREA KONTEN bar — 52-56 (compact, TANPA circle/pill jadi tidak
// butuh ruang ekstra). paddingBottom dihitung terpisah di MainTabs() dari
// SATU sumber (bottomPad), bukan ditambah dua kali ke height & padding.
const TAB_BAR_CONTENT_HEIGHT = 56;
const TAB_ICON_SIZE = 24;

function TabIcon({ routeName, focused }) {
  const Icon = TAB_ICONS[routeName];
  // Flat — cuma warna & ketebalan stroke yang beda, TANPA lingkaran/pill
  // background, TANPA animasi (Instagram-style, polos).
  return (
    <Icon
      size={TAB_ICON_SIZE}
      color={focused ? tokens.color.accent : tokens.color.textMuted}
      strokeWidth={focused ? 2.5 : 2}
    />
  );
}

// Tombol tab kustom — GANTI TOTAL PlatformPressable bawaan bottom-tabs
// (di Android otomatis pasang android_ripple/shadow saat ditekan). Feedback
// tekan di sini CUMA opacity 0.6 sesaat, tanpa efek lain apa pun.
function TabBarButton({ children, style, ...rest }) {
  return (
    <Pressable
      {...rest}
      android_ripple={null}
      style={({ pressed }) => [style, tabStyles.item, pressed && tabStyles.itemPressed]}
    >
      {children}
    </Pressable>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  // SATU sumber kebenaran untuk padding bawah — dipakai PERSIS SEKALI di
  // total height DAN di paddingBottom (bukan dua nilai/dua tempat berbeda
  // yang keduanya menambahkan insets.bottom secara terpisah — itu penyebab
  // bar jadi gemuk di review sebelumnya). Math.max(..., 6) supaya tetap ada
  // jarak minimal di device tanpa gesture nav (insets.bottom bisa 0).
  const bottomPad = Math.max(insets.bottom, 6);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarIcon: ({ focused }) => <TabIcon routeName={route.name} focused={focused} />,
        tabBarButton: (props) => <TabBarButton {...props} />,
        // Total tinggi bar = TAB_BAR_CONTENT_HEIGHT + bottomPad, TIDAK LEBIH.
        tabBarStyle: [tabStyles.bar, { height: TAB_BAR_CONTENT_HEIGHT + bottomPad, paddingBottom: bottomPad }],
        tabBarActiveTintColor: tokens.color.accent,
        tabBarInactiveTintColor: tokens.color.textMuted,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Chats" component={ChatListScreen} />
      <Tab.Screen name="Pelanggan" component={PelangganScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const tabStyles = StyleSheet.create({
  // Flat full-width — TANPA margin, TANPA border radius, TANPA shadow
  // container. Pemisah dari konten cuma border-top hairline tipis.
  bar: {
    position: "relative",
    left: 0, right: 0, bottom: 0,
    borderRadius: 0,
    backgroundColor: tokens.color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.color.border,
    // Nol-kan eksplisit — jangan sampai warisan shadow token lain nempel lagi.
    shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0,
  },
  // 4 ikon terdistribusi merata — flex:1 per item (default bottom-tabs)
  // sudah otomatis space-evenly di dalam row penuh lebar bar.
  item: {
    flex: 1, alignItems: "center", justifyContent: "center", height: TAB_BAR_CONTENT_HEIGHT,
    shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0,
  },
  itemPressed: { opacity: 0.6 },
});

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
const LIGHT_SCREENS = ["Home", "Chats", "Pelanggan", "Profil"];
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
            {/* MainTabs = 4 tab bawah (Home/Chats/Pelanggan/Profil). Layar di
                bawah ini di-push DI ATAS tab navigator — otomatis fullscreen
                & tab bar tersembunyi selama layar ini aktif (perilaku baku
                nested navigator React Navigation, tidak perlu config manual). */}
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="ChatRoom" component={ChatScreen} />
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
