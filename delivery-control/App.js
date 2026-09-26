import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SessionProvider, useSession } from "./src/SessionContext";
import { useTheme } from "./src/theme";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import BiayaArmadaScreen from "./src/screens/BiayaArmadaScreen";
import BiayaDetailScreen from "./src/screens/BiayaDetailScreen";
import BiayaFormScreen from "./src/screens/BiayaFormScreen";

SplashScreen.preventAutoHideAsync().catch(() => {});
const Stack = createNativeStackNavigator();

function Root() {
  const t = useTheme();
  const { loading, session } = useSession();
  useEffect(() => { if (!loading) SplashScreen.hideAsync().catch(() => {}); }, [loading]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}><ActivityIndicator color={t.accent} /></View>;
  }
  return (
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
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.statusBar} backgroundColor={t.bg} />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <ThemedStatusBar />
          <Root />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
