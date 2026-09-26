import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePengaturan } from "../PengaturanContext";
import { useSession } from "../SessionContext";
import { DEFAULT_SERVER } from "../client";
import { LABEL_TEMA, MODE_TEMA } from "../lib/pengaturan";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { ActionModal, Btn, Row, Section } from "../ui";

// PENGATURAN: hanya pilihan yang benar-benar berfungsi. "Keluar dari semua perangkat" TIDAK ditampilkan karena server
// (sesi JWT stateless) belum punya API untuk mencabut sesi di perangkat lain.
const IKON_TEMA = { system: "gauge", light: "calendar", dark: "shield" };

const PRIVASI = [
  ["camera", "Kamera hanya dipakai untuk memotret struk biaya dan foto profil. Foto dikirim ke server perusahaan, bukan disimpan di galeri."],
  ["mapPin", "Aplikasi ini TIDAK membaca lokasi HP Anda dan tidak meminta izin lokasi. Posisi armada di peta berasal dari aplikasi driver lewat server."],
  ["shield", "Aplikasi tidak mengakses mikrofon, kontak, atau pesan Anda."],
  ["fileText", "Draf biaya yang belum dikirim tersimpan di perangkat ini sampai Anda mengirim atau menghapusnya."],
  ["info", "Data akun, biaya, dan operasional diakses dari server perusahaan (app.sanomatrassehat.com) melalui koneksi HTTPS sesuai peran dan izin akun Anda."],
];

export default function SettingsScreen() {
  const t = useTheme();
  const { tema, setTema } = usePengaturan();
  const { signOut } = useSession();
  const [keluar, setKeluar] = useState(false);
  const [privasi, setPrivasi] = useState(false);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.body}>
        <Section title="Tampilan" icon="gauge">
          <Text style={{ color: t.ink2, fontSize: 13 }}>Tema aplikasi di perangkat ini.</Text>
          <View style={[s.seg, { backgroundColor: t.neutralBg }]}>
            {MODE_TEMA.map((m) => {
              const aktif = tema === m;
              return (
                <Pressable key={m} onPress={() => setTema(m)} accessibilityRole="radio" accessibilityState={{ selected: aktif }} accessibilityLabel={`Tema ${LABEL_TEMA[m]}`}
                  style={[s.segItem, aktif && { backgroundColor: t.surface }, aktif && elevation(t, 1)]}>
                  <Icon name={IKON_TEMA[m]} size={15} color={aktif ? t.accent : t.ink3} />
                  <Text style={{ color: aktif ? t.ink : t.ink3, fontWeight: "700", fontSize: 13 }}>{LABEL_TEMA[m]}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title="Tentang aplikasi" icon="info">
          <View>
            <Row icon="fileText" label="Aplikasi" value={Application.applicationName || "Sano Delivery Control"} />
            <Row icon="hash" label="Versi" value={Application.nativeApplicationVersion || "-"} />
            <Row icon="gauge" label="Build" value={Application.nativeBuildVersion || "-"} />
            <Row icon="box" label="Package" value={Application.applicationId || "-"} />
            <Row icon="refresh" label="Runtime" value={Updates.runtimeVersion || "-"} />
            <Row icon="store" label="Server" value={DEFAULT_SERVER.replace(/^https?:\/\//, "")} last />
          </View>
        </Section>

        <Section title="Privasi" icon="shield">
          <Pressable onPress={() => setPrivasi((v) => !v)} accessibilityRole="button" style={s.privasiHead}>
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: "700", flex: 1 }}>Data apa yang dipakai aplikasi ini</Text>
            <View style={{ transform: [{ rotate: privasi ? "90deg" : "0deg" }] }}><Icon name="chevronRight" size={18} color={t.ink3} /></View>
          </Pressable>
          {privasi && PRIVASI.map(([ic, teks]) => (
            <View key={ic + teks.slice(0, 8)} style={s.privasiRow}>
              <Icon name={ic} size={16} color={t.accent} />
              <Text style={{ color: t.ink2, fontSize: 13, flex: 1, lineHeight: 19 }}>{teks}</Text>
            </View>
          ))}
        </Section>

        <Btn title="Keluar" icon="logout" kind="danger" onPress={() => setKeluar(true)} />
      </ScrollView>

      <ActionModal
        visible={keluar} title="Keluar dari akun?" message="Anda perlu masuk lagi untuk membuka Delivery Control." icon="logout"
        confirmLabel="Keluar" danger onCancel={() => setKeluar(false)} onConfirm={() => { setKeluar(false); signOut(); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 18, gap: 14, paddingBottom: 32 },
  seg: { flexDirection: "row", borderRadius: radius.pill, padding: 4 },
  segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: radius.pill },
  privasiHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  privasiRow: { flexDirection: "row", gap: 10, paddingVertical: 6 },
});
