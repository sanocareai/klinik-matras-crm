// Entry point aplikasi mobile Klinik Matras CRM.
// Navigasi: Login → Daftar Percakapan → Chat → Info Pelanggan
import React, { useEffect } from "react";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { isExpoGo } from "./src/push";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import ChatListScreen from "./src/screens/ChatListScreen";
import ChatScreen from "./src/screens/ChatScreen";
import CustomerScreen from "./src/screens/CustomerScreen";
import { colors } from "./src/theme";

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function Root() {
  const { user, loading } = useAuth();

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

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer ref={navigationRef}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.header }} edges={["top"]}>
            <StatusBar style="light" />
            <Root />
          </SafeAreaView>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
