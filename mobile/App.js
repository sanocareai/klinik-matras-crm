// Entry point aplikasi mobile Klinik Matras CRM.
// Navigasi: Login → Daftar Percakapan → Chat → Info Pelanggan
import React, { useEffect } from "react";
import { NavigationContainer, createNavigationContainerRef, useNavigationState } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { isExpoGo } from "./src/push";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, View, Text, TextInput } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import ChatListScreen from "./src/screens/ChatListScreen";
import ChatScreen from "./src/screens/ChatScreen";
import CustomerScreen from "./src/screens/CustomerScreen";
import { colors } from "./src/theme";
import { tokens } from "./src/constants/theme";
import { queryClient } from "./src/lib/queryClient";
import { useSocketEvents } from "./src/hooks/useSocketEvents";
import { initOutboxFlush } from "./src/lib/outboxFlush";

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

// InboxScreen (M-B) pakai desain light-blue baru — beda dari Login/Chat yang
// masih gaya header biru tua lama. Warna strip status bar/notch ikut
// menyesuaikan layar aktif supaya tidak ada strip gelap ganjil di atas Inbox
// yang sudah terang.
function SafeAreaTopBg({ children }) {
  const routeName = useNavigationState((state) => state?.routes?.[state.index]?.name);
  const bg = routeName === "ChatList" ? tokens.color.bg : colors.header;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={["top"]}>
      <StatusBar style={routeName === "ChatList" ? "dark" : "light"} />
      {children}
    </SafeAreaView>
  );
}

function Root() {
  const { user, loading } = useAuth();

  // Socket.IO event → store, dan flush antrean outbox — aktif selama user
  // login, tidak peduli sedang di layar mana (Inbox/Chat/Customer).
  useSocketEvents();
  useEffect(() => {
    if (!user) return;
    const unsubscribe = initOutboxFlush();
    return unsubscribe;
  }, [user]);

  // Ketuk notifikasi → langsung buka chat percakapan itu.
  // Nama customer diambil dari judul notifikasi (dikirim backend).
  // Dilewati di Expo Go — lihat catatan isExpoGo di src/push.js.
  useEffect(() => {
    if (isExpoGo) return;
    const Notifications = require("expo-notifications");
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { conversationId, customerId } = response.notification.request.content.data || {};
      const name = response.notification.request.content.title || "Pelanggan";
      if (conversationId && user && navigationRef.isReady()) {
        navigationRef.navigate("Chat", { conversationId, name, isGroup: false, customerId });
      }
    });
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="ChatList" component={ChatListScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Customer" component={CustomerScreen} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
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

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.header }} />;
  }
  applyInterGlobally();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <NavigationContainer ref={navigationRef}>
              <SafeAreaTopBg>
                <Root />
              </SafeAreaTopBg>
            </NavigationContainer>
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
