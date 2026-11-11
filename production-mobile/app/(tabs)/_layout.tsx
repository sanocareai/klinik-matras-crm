import React from "react";
import { Tabs } from "expo-router";
import { Image as ImageIcon, LayoutGrid, Layers, Target, User } from "lucide-react-native";
import { useLayout } from "@/api/production";
import { C, F, TONE } from "@/design/tokens";

// TAB BAR gaya iOS. Tab muncul sesuai capability server (bukan nama peran):
//   Kerja  — pemegang antrean Meja/Corner (unit:stage:write)
//   Papan  — semua (live per meja); Target — Admin Produksi (production_assignment:write)
//   Media  — semua; Akun — semua
export default function TabsLayout() {
  const l = useLayout();
  const ikon = (Icon: typeof Layers) => function IkonTab({ color }: { color: unknown }) { return <Icon color={String(color)} size={26} strokeWidth={2} />; };
  return (
    <Tabs
      initialRouteName={l.admin || !l.lane ? "papan" : "kerja"}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TONE.blue.text,
        tabBarInactiveTintColor: C.ink3,
        tabBarLabelStyle: { fontFamily: F.semibold, fontSize: 11 },
        tabBarStyle: { backgroundColor: C.barBg, borderTopColor: C.barLine, height: 86, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="kerja" options={{ title: "Kerja", tabBarIcon: ikon(Layers), href: l.lane ? undefined : null }} />
      <Tabs.Screen name="papan" options={{ title: "Papan", tabBarIcon: ikon(LayoutGrid) }} />
      <Tabs.Screen name="target" options={{ title: "Target", tabBarIcon: ikon(Target), href: l.admin ? undefined : null }} />
      <Tabs.Screen name="media" options={{ title: "Media", tabBarIcon: ikon(ImageIcon) }} />
      <Tabs.Screen name="akun" options={{ title: "Akun", tabBarIcon: ikon(User) }} />
    </Tabs>
  );
}
