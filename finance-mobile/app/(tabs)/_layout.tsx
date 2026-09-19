import React from "react";
import { Tabs } from "expo-router";
import { GlassTabBar } from "@/features/nav/GlassTabBar";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar state={props.state} navigation={props.navigation} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
    >
      <Tabs.Screen name="index" options={{ title: "Beranda" }} />
      <Tabs.Screen name="transaksi" options={{ title: "Transaksi" }} />
      <Tabs.Screen name="persetujuan" options={{ title: "Persetujuan" }} />
      <Tabs.Screen name="laporan" options={{ title: "Laporan" }} />
      <Tabs.Screen name="lainnya" options={{ title: "Lainnya" }} />
    </Tabs>
  );
}
