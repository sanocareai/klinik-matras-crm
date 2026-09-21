import React from "react";
import { Alert, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  BadgeCheck, Banknote, BookOpen, ChevronRight, FileSpreadsheet, FileText, Info, Landmark, LogOut, Palette, Scale, ShieldCheck, Smartphone,
  TriangleAlert, Users, Wallet, type LucideIcon,
} from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, Chip, IconCircle, MockBanner, PressableScale, SectionHeader } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { usePrefs, type ThemePref } from "@/design/prefs";
import { haptic } from "@/design/haptics";
import { useSession } from "@/auth/session";
import { has, type Need } from "@/auth/capabilities";
import { ENV } from "@/lib/env";
import { S } from "@/lib/strings";

type Menu = { label: string; Icon: LucideIcon; need?: Need; href?: "/keamanan" | "/pembayaran" | "/buku/jurnal" | "/buku/akun" | "/buku/rekon" };

// Setiap menu punya izin yang dibutuhkan (capability-driven). Menu tanpa izin tidak ditampilkan.
const KEUANGAN: Menu[] = [
  { label: "Pembayaran pelanggan", Icon: Banknote, need: "financeRead", href: "/pembayaran" },
  { label: S.lainnya.kasBank, Icon: Wallet, need: "financeRead" },
  { label: S.lainnya.piutangRefund, Icon: Users, need: "financeRead" },
  { label: S.lainnya.invoice, Icon: FileText, need: "financeRead" },
  { label: S.lainnya.supplierUtang, Icon: Landmark, need: "financeRead" },
];
const AKUNTANSI: Menu[] = [
  { label: S.lainnya.jurnal, Icon: FileSpreadsheet, need: "financeRead", href: "/buku/jurnal" },
  { label: S.lainnya.bukuBesar, Icon: BookOpen, need: "financeRead", href: "/buku/akun" },
  { label: S.lainnya.rekonsiliasi, Icon: Scale, need: "financeRead", href: "/buku/rekon" },
  { label: S.lainnya.dataBelumLengkap, Icon: TriangleAlert, need: "financeRead" },
  { label: S.lainnya.tinjauBukti, Icon: BadgeCheck, need: "financeAdmin" },
];
const PENGATURAN: Menu[] = [
  { label: S.lainnya.keamanan, Icon: ShieldCheck, href: "/keamanan" },
  { label: S.lainnya.perangkat, Icon: Smartphone, href: "/keamanan" },
  { label: S.lainnya.tentang, Icon: Info },
];

function bolehLihat(caps: ReturnType<typeof useSession.getState>["capabilities"], m: Menu) {
  return !m.need || has(caps, m.need);
}

function DaftarMenu({ items, ikon = "info" }: { items: Menu[]; ikon?: "info" | "neutral" }) {
  const { colors } = useTheme();
  const router = useRouter();
  const caps = useSession((s) => s.capabilities);
  const tampil = items.filter((m) => bolehLihat(caps, m));
  if (tampil.length === 0) return null;
  return (
    <GlassCard padding={4}>
      {tampil.map((m, i) => (
        <PressableScale
          key={m.label} accessibilityLabel={m.label}
          onPress={() => {
            haptic.tick();
            if (m.href) router.push(m.href);
            else Alert.alert(m.label, `${S.segera}. ${S.segeraIsi}`);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}
        >
          <IconCircle icon={m.Icon} tone={ikon} size={38} />
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

  function keluar() {
    Alert.alert("Keluar dari akun?", "Anda perlu masuk lagi dan membuat PIN baru di HP ini.", [
      { text: S.umum.batal, style: "cancel" },
      { text: S.umum.keluar, style: "destructive", onPress: () => { haptic.ringan(); void logout(); } },
    ]);
  }

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

      {KEUANGAN.some((m) => bolehLihat(caps, m)) ? <SectionHeader judul={S.lainnya.keuangan} /> : null}
      <DaftarMenu items={KEUANGAN} />
      {AKUNTANSI.some((m) => bolehLihat(caps, m)) ? <SectionHeader judul={S.lainnya.akuntansi} /> : null}
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
      <DaftarMenu items={PENGATURAN} ikon="neutral" />

      <Button label={S.umum.keluar} variant="danger" icon={LogOut} onPress={keluar} style={{ marginTop: 24 }} />
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
