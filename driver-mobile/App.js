// Entry point — struktur provider SAMA dengan mobile/App.js (Sano
// Messenger): ErrorBoundary paling luar (harus tetap render walau context
// lain rusak) > GestureHandlerRootView > SafeAreaProvider >
// QueryClientProvider > AuthProvider > NavigationContainer. Disederhanakan
// (tanpa BottomSheetModalProvider/font custom/socket — driver app tidak
// butuh itu) — lihat plan driver app milestone 1 ("slice tercepat").
import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import JobListScreen from "./src/screens/JobListScreen";
import AdminHomeScreen from "./src/screens/AdminHomeScreen";
import ErrorBoundary from "./src/components/ErrorBoundary";
import { queryClient } from "./src/lib/queryClient";
import { checkForUpdateOnLaunch } from "./src/lib/autoUpdate";
import { isAdminView } from "./src/lib/roles";
import { useTheme } from "./src/hooks/useTheme";

// Tahan splash sampai sesi (AsyncStorage) selesai dibaca — dipanggil di
// MODULE LEVEL (bukan di dalam komponen) supaya terjadi SEBELUM render
// pertama apa pun, pola sama dengan mobile/App.js.
SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

function Root() {
  const { user, loading } = useAuth();
  const theme = useTheme();

  useEffect(() => { checkForUpdateOnLaunch(); }, []);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.NAVY }]}>
        <ActivityIndicator color={theme.ACCENT} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          // Routing berdasar role (10 Sep 2026) — ADMIN/DISPATCHER mendarat
          // di dashboard baca-saja, DRIVER/HELPER/LEADER_DRIVER di Job Saya.
          // Lihat lib/roles.js utk daftar role & alasannya.
          isAdminView(user) ? (
            <Stack.Screen name="AdminHome" component={AdminHomeScreen} />
          ) : (
            <Stack.Screen name="JobList" component={JobListScreen} />
          )
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function ThemedStatusBar() {
  const theme = useTheme();
  return <StatusBar style={theme.statusBarStyle} backgroundColor={theme.NAVY} />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <ThemedStatusBar />
              <Root />
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
