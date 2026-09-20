import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeftRight, ChartColumn, CircleCheck, Ellipsis, House, Plus, type LucideIcon } from "lucide-react-native";
import { useTheme } from "@/design/theme";
import { PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useApprovalBadge } from "@/hooks/approvals";
import { NEED_TAB, bisaMencatatAtauVerifikasi, has } from "@/auth/capabilities";
import { useSession } from "@/auth/session";
import { S } from "@/lib/strings";

// Tab bar 5 item (Beranda, Transaksi, Persetujuan, Laporan, Lainnya) + FAB "+" kanan-bawah di atas
// tab bar, hanya di Beranda & Transaksi (PRD §6.1). Permukaan translucent TANPA blur (ringan).

type Rute = { key: string; name: string };
type Props = {
  state: { index: number; routes: Rute[] };
  navigation: { navigate: (name: string) => void };
};

const ITEM: Record<string, { label: string; Icon: LucideIcon }> = {
  index: { label: S.tab.beranda, Icon: House },
  transaksi: { label: S.tab.transaksi, Icon: ArrowLeftRight },
  persetujuan: { label: S.tab.persetujuan, Icon: CircleCheck },
  laporan: { label: S.tab.laporan, Icon: ChartColumn },
  lainnya: { label: S.tab.lainnya, Icon: Ellipsis },
};

export const TINGGI_TAB = 64;

export function GlassTabBar({ state, navigation }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const caps = useSession((s) => s.capabilities);
  // Lencana Persetujuan = jumlah menunggu dari server (GET /finance/approvals/ringkasan), bukan dihitung klien.
  const menunggu = useApprovalBadge().data ?? 0;
  const aktifNama = state.routes[state.index]?.name;
  // FAB hanya untuk yang boleh mencatat atau memverifikasi pembayaran (Approver/Accountant-baca tidak melihatnya).
  const tampilFab = (aktifNama === "index" || aktifNama === "transaksi") && bisaMencatatAtauVerifikasi(caps);

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      {tampilFab ? (
        <PressableScale
          onPress={() => { haptic.ringan(); router.push("/aksi-cepat"); }}
          accessibilityLabel="Transaksi cepat"
          style={{
            position: "absolute", right: 20, bottom: TINGGI_TAB + insets.bottom + 16, width: 58, height: 58, borderRadius: 29,
            backgroundColor: colors.primary, alignItems: "center", justifyContent: "center",
            elevation: 8, shadowColor: colors.shadow, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
          }}
        >
          <Plus size={28} color={colors.onPrimary} strokeWidth={2} />
        </PressableScale>
      ) : null}

      <View
        style={{
          flexDirection: "row", height: TINGGI_TAB + insets.bottom, paddingBottom: insets.bottom, paddingHorizontal: 6,
          backgroundColor: colors.tabBar, borderTopWidth: 1, borderTopColor: colors.glassStroke,
        }}
      >
        {state.routes.map((r, i) => {
          const meta = ITEM[r.name];
          if (!meta) return null;
          const butuh = NEED_TAB[r.name as keyof typeof NEED_TAB];
          if (butuh && !has(caps, butuh)) return null;
          const fokus = state.index === i;
          const warna = fokus ? colors.primary : colors.textMuted;
          const badge = r.name === "persetujuan" ? menunggu : 0;
          return (
            <PressableScale
              key={r.key}
              accessibilityRole="tab"
              accessibilityLabel={badge > 0 ? `${meta.label}, ${badge} menunggu` : meta.label}
              onPress={() => { if (!fokus) { haptic.tick(); navigation.navigate(r.name); } }}
              style={{ flex: 1, height: TINGGI_TAB, alignItems: "center", justifyContent: "center", gap: 3 }}
            >
              <View>
                <meta.Icon size={24} color={warna} strokeWidth={fokus ? 2.1 : 1.75} />
                {badge > 0 ? (
                  <View style={{ position: "absolute", top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#FFFFFF", fontFamily: font.semibold, fontSize: 10 }}>{badge > 99 ? "99+" : badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15} style={{ color: warna, fontFamily: fokus ? font.semibold : font.medium, fontSize: 11, maxWidth: "100%" }}>{meta.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
