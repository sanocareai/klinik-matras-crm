import React from "react";
import { Tabs } from "expo-router";
import { Image as ImageIcon, LayoutGrid, Layers, Package, ShieldCheck, Target, User } from "lucide-react-native";
import { useLayout } from "@/api/production";
import { useBahanBelumBulanIni } from "@/api/bahanQc";
import { LiquidTabBar, type ItemTab } from "@/design/LiquidTabBar";

// TAB BAR "Liquid Glass". Tab muncul sesuai capability server (bukan nama peran):
//   Kerja  — pemegang antrean Meja/Corner (unit:stage:write)
//   QC     — putusan Uji Berat Badan (qc:write)
//   Bahan  — tim QC & Dokumentasi: pendataan bahan (keputusan Owner 14 Nov 2026); tombol catat tetap mengikuti izin server per unit
//   Papan  — semua (live per meja); Target — Admin Produksi (production_assignment:write)
//   Media  — semua; Akun — semua
export default function TabsLayout() {
  const l = useLayout();
  const timBahan = l.qc || l.docs;
  const bahan = useBahanBelumBulanIni(timBahan);
  const items: ItemTab[] = [
    ...(l.lane ? [{ name: "kerja", label: "Kerja", Icon: Layers }] : []),
    ...(l.qc ? [{ name: "qc", label: "QC", Icon: ShieldCheck }] : []),
    ...(timBahan ? [{ name: "bahan", label: "Bahan", Icon: Package, badge: bahan.perlu }] : []),
    { name: "papan", label: "Papan", Icon: LayoutGrid },
    ...(l.admin ? [{ name: "target", label: "Target", Icon: Target }] : []),
    { name: "media", label: "Media", Icon: ImageIcon },
    { name: "akun", label: "Akun", Icon: User },
  ];
  return (
    <Tabs
      initialRouteName={l.admin ? "papan" : l.qc ? "qc" : l.lane ? "kerja" : timBahan ? "bahan" : "papan"}
      tabBar={(props) => <LiquidTabBar state={props.state} navigation={props.navigation} items={items} />}
      // Pindah tab: memudar singkat (seperti iOS), bukan potong mendadak. lazy: layar tab baru dibuat saat pertama dibuka (hemat memori HP menengah).
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" }, animation: "fade", lazy: true, freezeOnBlur: true }}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="kerja" />
      <Tabs.Screen name="qc" />
      <Tabs.Screen name="bahan" />
      <Tabs.Screen name="papan" />
      <Tabs.Screen name="target" />
      <Tabs.Screen name="media" />
      <Tabs.Screen name="akun" />
    </Tabs>
  );
}
