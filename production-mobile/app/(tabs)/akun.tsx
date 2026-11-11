import React from "react";
import { View } from "react-native";
import { LogOut } from "lucide-react-native";
import { useLayout } from "@/api/production";
import { useSession } from "@/auth/session";
import { Button, Card, Chip, Screen, Section, T } from "@/design/ui";
import { TONE } from "@/design/tokens";
import { ENV } from "@/lib/env";

const PERAN: Record<string, string> = { ADMIN: "Admin Produksi", QC: "QC & Dokumentasi", DOKUMENTASI: "Dokumentasi", MEJA: "PIC Meja / Corner", NONE: "—" };

export default function Akun() {
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const l = useLayout();
  const akses = [l.lane && "Antrean Meja/Corner", l.qc && "Putusan QC", l.docs && "Dokumentasi", l.admin && "Target & PIC", l.executeAny && "Semua PIC"].filter(Boolean) as string[];

  return (
    <Screen>
      <T.LargeTitle accessibilityRole="header" style={{ marginHorizontal: 4 }}>Akun</T.LargeTitle>
      <Card style={{ gap: 6 }}>
        <T.Title>{user?.name ?? "—"}</T.Title>
        <T.Sub>{PERAN[l.preset] ?? l.preset}</T.Sub>
      </Card>
      <Section title="Akses dari server">
        <Card style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {akses.length ? akses.map((a) => <Chip key={a} label={a} tone="blue" />) : <T.Sub>Tidak ada akses produksi.</T.Sub>}
        </Card>
      </Section>
      <View style={{ marginTop: 8 }}>
        <Button label="Keluar" kind="danger" icon={<LogOut color={TONE.red.text} size={20} />} onPress={() => void logout()} />
      </View>
      <T.Caption style={{ textAlign: "center" }}>SANSS Produksi {ENV.version} · {ENV.variant}</T.Caption>
    </Screen>
  );
}
