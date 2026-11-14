import React from "react";
import { Tabs } from "expo-router";
import { House, Image as ImageIcon, LayoutGrid, Layers, Package, ShieldCheck, Target, User } from "lucide-react-native";
import { useLayout } from "@/api/production";
import { useBahanBelumBulanIni } from "@/api/bahanQc";
import { LiquidTabBar, type ItemTab } from "@/design/LiquidTabBar";

// TAB BAR "Liquid Glass" — paling banyak 4 tab + tombol "+" (kanvas v2). PERAN UTAMA menentukan tab; fitur lain dibuka dari menu ubin
// di Beranda (super-app), jadi akun multi-peran (Ferdy, Natasha) tidak lagi mendapat 7 tab yang sesak:
//   Admin/Kepala Produksi : Beranda · Papan · Target · Akun
//   QC & Dokumentasi      : Beranda · QC (bila qc:write) · Order · Akun   (Order menggantikan tab Bahan, 14 Nov 2026)
//   PIC Meja/Corner       : Kerja · Media · Akun        (beranda PIC = pekerjaannya sendiri)
// Semua rute tab tetap terdaftar (bisa dibuka dari menu); hak akses tetap ditegakkan server.
export default function TabsLayout() {
  const l = useLayout();
  const timQc = l.qc || l.docs;
  const bahan = useBahanBelumBulanIni(timQc);
  const items: ItemTab[] = l.admin
    ? [{ name: "index", label: "Beranda", Icon: House }, { name: "papan", label: "Papan", Icon: LayoutGrid }, { name: "target", label: "Target", Icon: Target }, { name: "akun", label: "Akun", Icon: User }]
    : timQc
      ? [{ name: "index", label: "Beranda", Icon: House }, ...(l.qc ? [{ name: "qc", label: "QC", Icon: ShieldCheck }] : [{ name: "media", label: "Media", Icon: ImageIcon }]), { name: "order", label: "Order", Icon: Package, badge: bahan.perlu }, { name: "akun", label: "Akun", Icon: User }]
      : l.lane
        ? [{ name: "kerja", label: "Kerja", Icon: Layers }, { name: "media", label: "Media", Icon: ImageIcon }, { name: "akun", label: "Akun", Icon: User }]
        : [{ name: "papan", label: "Papan", Icon: LayoutGrid }, { name: "media", label: "Media", Icon: ImageIcon }, { name: "akun", label: "Akun", Icon: User }];
  return (
    <Tabs
      initialRouteName={items[0]!.name}
      tabBar={(props) => <LiquidTabBar state={props.state} navigation={props.navigation} items={items} />}
      // Pindah tab: memudar singkat (seperti iOS). lazy: layar tab dibuat saat pertama dibuka; freezeOnBlur: tab di belakang tidak digambar ulang.
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" }, animation: "fade", lazy: true, freezeOnBlur: true }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="kerja" />
      <Tabs.Screen name="qc" />
      <Tabs.Screen name="order" />
      <Tabs.Screen name="papan" />
      <Tabs.Screen name="target" />
      <Tabs.Screen name="media" />
      <Tabs.Screen name="akun" />
    </Tabs>
  );
}
