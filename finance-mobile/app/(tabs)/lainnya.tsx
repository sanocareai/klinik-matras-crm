import React from "react";
import { Alert, Switch, Text, View } from "react-native";
import {
  BookOpen, ChevronRight, FileSpreadsheet, FileText, Landmark, LogOut, Palette, Scale, ShieldCheck, Smartphone, Users, Info,
  TriangleAlert, Wallet, BadgeCheck, type LucideIcon,
} from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, Chip, IconCircle, MockBanner, PressableScale, SectionHeader } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { usePrefs, type ThemePref } from "@/design/prefs";
import { haptic } from "@/design/haptics";
import { useSession } from "@/auth/session";
import { ENV } from "@/lib/env";
import { S } from "@/lib/strings";

type Menu = { label: string; Icon: LucideIcon };
const KEUANGAN: Menu[] = [
  { label: S.lainnya.kasBank, Icon: Wallet },
  { label: S.lainnya.piutangRefund, Icon: Users },
  { label: S.lainnya.invoice, Icon: FileText },
  { label: S.lainnya.supplierUtang, Icon: Landmark },
];
const AKUNTANSI: Menu[] = [
  { label: S.lainnya.jurnal, Icon: FileSpreadsheet },
  { label: S.lainnya.bukuBesar, Icon: BookOpen },
  { label: S.lainnya.rekonsiliasi, Icon: Scale },
  { label: S.lainnya.dataBelumLengkap, Icon: TriangleAlert },
  { label: S.lainnya.tinjauBukti, Icon: BadgeCheck },
];

function DaftarMenu({ items }: { items: Menu[] }) {
  const { colors } = useTheme();
  return (
    <GlassCard padding={4}>
      {items.map((m, i) => (
        <PressableScale
          key={m.label} accessibilityLabel={m.label}
          onPress={() => { haptic.tick(); Alert.alert(m.label, `${S.segera}. ${S.segeraIsi}`); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}
        >
          <IconCircle icon={m.Icon} tone="info" size={38} />
          <Text style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 15 }}>{m.label}</Text>
          <ChevronRight size={20} color={colors.textFaint} strokeWidth={1.75} />
        </PressableScale>
      ))}
    </GlassCard>
  );
}

export default function Lainnya() {
  const { colors } = useTheme();
  const user = useSession((s) => s.user);
  const caps = useSession((s) => s.capabilities);
  const logout = useSession((s) => s.logout);
  const { theme, setTheme, efekRingan, setEfekRingan, sembunyikanAngka, setSembunyikanAngka } = usePrefs();

  const pilihTema: [ThemePref, string][] = [["system", S.tampilan.sistem], ["light", S.tampilan.terang], ["dark", S.tampilan.gelap]];

  return (
    <Screen>
      {ENV.useMocks ? <MockBanner /> : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26, marginBottom: 12 }}>{S.lainnya.judul}</Text>

      <GlassCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.onPrimary, fontFamily: font.semibold, fontSize: 18 }}>{(user?.name ?? "?").slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 16 }}>{user?.name}</Text>
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>
              {user?.roles.join(" · ")}{caps ? ` · tata letak ${caps.preset}` : ""}
            </Text>
          </View>
        </View>
      </GlassCard>

      <SectionHeader judul={S.lainnya.keuangan} />
      <DaftarMenu items={KEUANGAN} />
      <SectionHeader judul={S.lainnya.akuntansi} />
      <DaftarMenu items={AKUNTANSI} />

      <SectionHeader judul={S.lainnya.tampilan} />
      <GlassCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Palette size={18} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{S.tampilan.tema}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {pilihTema.map(([v, label]) => <Chip key={v} label={label} aktif={theme === v} onPress={() => setTheme(v)} />)}
        </View>
        <Baris judul={S.tampilan.efekRingan} sub={S.tampilan.efekRinganInfo} nilai={efekRingan} onChange={setEfekRingan} />
        <Baris judul={S.tampilan.sembunyikan} sub={S.tampilan.sembunyikanInfo} nilai={sembunyikanAngka} onChange={setSembunyikanAngka} />
      </GlassCard>

      <SectionHeader judul={S.lainnya.pengaturan} />
      <GlassCard padding={4}>
        {[
          { label: S.lainnya.keamanan, Icon: ShieldCheck },
          { label: S.lainnya.perangkat, Icon: Smartphone },
          { label: S.lainnya.tentang, Icon: Info },
        ].map((m, i) => (
          <PressableScale key={m.label} accessibilityLabel={m.label} onPress={() => { haptic.tick(); Alert.alert(m.label, `${S.segera}. ${S.segeraIsi}`); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
            <IconCircle icon={m.Icon} tone="neutral" size={38} />
            <Text style={{ flex: 1, color: colors.text, fontFamily: font.medium, fontSize: 15 }}>{m.label}</Text>
            <ChevronRight size={20} color={colors.textFaint} strokeWidth={1.75} />
          </PressableScale>
        ))}
      </GlassCard>

      <Button label={S.umum.keluar} variant="danger" icon={LogOut} onPress={() => { haptic.ringan(); void logout(); }} style={{ marginTop: 24 }} />
      <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, textAlign: "center", marginTop: 16 }}>
        {S.app} {ENV.version} · {ENV.variant}{ENV.useMocks ? " · data contoh" : ""}
      </Text>
    </Screen>
  );
}

function Baris({ judul, sub, nilai, onChange }: { judul: string; sub: string; nilai: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{judul}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 2 }}>{sub}</Text>
      </View>
      <Switch
        value={nilai} onValueChange={(v) => { haptic.tick(); onChange(v); }} accessibilityLabel={judul}
        trackColor={{ false: colors.neutralSoft, true: colors.primary }} thumbColor="#FFFFFF"
      />
    </View>
  );
}
