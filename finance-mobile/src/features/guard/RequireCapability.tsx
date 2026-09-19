import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ShieldOff } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, IconCircle } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { has, LABEL_NEED, type Need, type NeedMode } from "@/auth/capabilities";
import { useSession } from "@/auth/session";

// GUARD ROUTE/LAYAR: menampilkan `children` hanya bila capabilities pengguna mencukupi. Bila tidak,
// tampil panel "Anda tidak punya akses" (state akun tidak berizin) — bukan layar kosong atau galat.
// Ini lapis UI; server tetap menolak dengan 403 bila ada yang menembus.

type Props = { need: Need | Need[]; mode?: NeedMode; children: React.ReactNode; judul?: string };

export function AksesTerbatas({ need, judul }: { need: Need | Need[]; judul?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const roles = useSession((s) => s.user?.roles ?? []);
  const daftar = Array.isArray(need) ? need : [need];
  return (
    <Screen>
      <GlassCard style={{ marginTop: 40 }}>
        <View style={{ alignItems: "center", gap: 10, paddingVertical: 12 }}>
          <IconCircle icon={ShieldOff} tone="warning" size={56} />
          <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 18, textAlign: "center" }}>{judul ?? "Anda tidak punya akses"}</Text>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
            Layar ini butuh izin untuk {daftar.map((n) => LABEL_NEED[n]).join(" dan ")}. Peran Anda saat ini: {roles.length ? roles.join(", ") : "—"}.
          </Text>
          <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 12, textAlign: "center" }}>Hubungi admin bila ini keliru.</Text>
          <Button label="Kembali" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={{ marginTop: 8, alignSelf: "stretch" }} />
        </View>
      </GlassCard>
    </Screen>
  );
}

export function RequireCapability({ need, mode = "all", children, judul }: Props) {
  const caps = useSession((s) => s.capabilities);
  if (!has(caps, need, mode)) return <AksesTerbatas need={need} judul={judul} />;
  return <>{children}</>;
}

/** Hook: apakah pengguna punya izin? (untuk menampilkan/menyembunyikan tombol & menu) */
export function useCan(need: Need | Need[], mode: NeedMode = "all"): boolean {
  const caps = useSession((s) => s.capabilities);
  return has(caps, need, mode);
}

/** Bungkus komponen layar dengan guard capability (dipakai di `export default`). */
export function denganAkses<P extends object>(Komponen: React.ComponentType<P>, need: Need | Need[], mode: NeedMode = "all"): React.ComponentType<P> {
  function Dijaga(props: P) {
    return (
      <RequireCapability need={need} mode={mode}>
        <Komponen {...props} />
      </RequireCapability>
    );
  }
  Dijaga.displayName = `DenganAkses(${Komponen.displayName ?? Komponen.name ?? "Layar"})`;
  return Dijaga;
}
