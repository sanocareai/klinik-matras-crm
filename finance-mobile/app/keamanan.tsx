import React, { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Device from "expo-device";
import { randomUUID } from "expo-crypto";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, KeyRound, LogOut, Minus } from "lucide-react-native";
import { Screen } from "@/design/Screen";
import { GlassCard } from "@/design/GlassCard";
import { Button, Chip, ErrorState, IconCircle, MockBanner, OfflineBanner, PressableScale, SectionHeader, Skeleton } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { TIMEOUT_PILIHAN, useLock } from "@/auth/lock";
import { api, useSession } from "@/auth/session";
import { getDeviceId } from "@/auth/storage";
import { ringkasHakAkses } from "@/auth/capabilities";
import { pesanUntukPengguna } from "@/api/errors";
import { useOnline } from "@/hooks/useOnline";
import { ENV } from "@/lib/env";
import { waktuRelatif } from "@/lib/dates";

// KEAMANAN (Lainnya → Keamanan): ubah PIN, biometrik, batas waktu kunci, info perangkat & sesi, hak akses, keluar.

type Sesi = { id: string; deviceId: string; deviceLabel: string | null; platform: string; appVersion: string | null; createdAt: string; lastSeenAt: string; current: boolean };

function Baris({ label, isi }: { label: string; isi: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 8 }}>
      <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 13, flexShrink: 1, textAlign: "right" }}>{isi}</Text>
    </View>
  );
}

const PESAN_STATUS_BIO: Record<string, string> = {
  tidak_ada_perangkat: "HP ini tidak mendukung biometrik.",
  belum_terdaftar: "Belum ada sidik jari atau wajah yang terdaftar di HP ini.",
};

export default function Keamanan() {
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const user = useSession((s) => s.user);
  const caps = useSession((s) => s.capabilities);
  const logout = useSession((s) => s.logout);
  const timeoutMs = useLock((s) => s.timeoutMs);
  const setTimeoutMs = useLock((s) => s.setTimeoutMs);
  const biometricEnabled = useLock((s) => s.biometricEnabled);
  const biometricStatus = useLock((s) => s.biometricStatus);
  const setBiometric = useLock((s) => s.setBiometric);
  const refreshBiometric = useLock((s) => s.refreshBiometric);
  const [deviceId, setDeviceId] = useState("");

  useEffect(() => {
    void refreshBiometric();
    void getDeviceId().then(setDeviceId).catch(() => {});
  }, [refreshBiometric]);

  const sesi = useQuery<Sesi[]>({
    queryKey: ["sesi", ENV.useMocks],
    queryFn: async () => {
      if (ENV.useMocks) {
        return [{ id: "contoh", deviceId: "contoh", deviceLabel: Device.modelName ?? "Perangkat ini", platform: "android", appVersion: ENV.version, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), current: true }];
      }
      return (await api.get<{ sessions: Sesi[] }>("/mobile/auth/sessions")).sessions;
    },
    retry: false,
  });

  const keluarkan = useMutation({
    mutationFn: (id: string) => api.command("DELETE", `/mobile/auth/sessions/${id}`, randomUUID()),
    onSuccess: () => { haptic.sukses(); void qc.invalidateQueries({ queryKey: ["sesi"] }); },
    onError: (e) => { haptic.galat(); Alert.alert("Belum bisa mengeluarkan perangkat", pesanUntukPengguna(e)); },
  });

  async function ubahBiometrik(aktif: boolean) {
    const r = await setBiometric(aktif);
    if (!r.ok) { haptic.galat(); Alert.alert("Biometrik belum aktif", r.pesan); } else { haptic.sukses(); }
  }

  function konfirmasiKeluarkan(s: Sesi) {
    Alert.alert("Keluarkan perangkat ini?", `${s.deviceLabel ?? "Perangkat"} akan keluar dari akun Anda dan perlu masuk lagi.`, [
      { text: "Batal", style: "cancel" },
      { text: "Keluarkan", style: "destructive", onPress: () => keluarkan.mutate(s.id) },
    ]);
  }

  function keluar() {
    Alert.alert("Keluar dari akun?", "Anda perlu masuk lagi dan membuat PIN baru di HP ini.", [
      { text: "Batal", style: "cancel" },
      { text: "Keluar", style: "destructive", onPress: () => { haptic.ringan(); void logout(); } },
    ]);
  }

  const bioTersedia = biometricStatus === "tersedia";

  return (
    <Screen>
      <PressableScale onPress={() => router.back()} accessibilityLabel="Kembali" style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, minHeight: 44 }}>
        <ChevronLeft size={22} color={colors.primary} strokeWidth={1.75} />
        <Text style={{ color: colors.primary, fontFamily: font.medium, fontSize: 15 }}>Lainnya</Text>
      </PressableScale>
      {ENV.useMocks ? <MockBanner /> : null}
      {!online ? <OfflineBanner /> : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.semibold, fontSize: 26 }}>Keamanan</Text>

      <SectionHeader judul="Kunci aplikasi" />
      <GlassCard padding={4}>
        <PressableScale onPress={() => { haptic.tick(); router.push("/ubah-pin"); }} accessibilityLabel="Ubah PIN" style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
          <IconCircle icon={KeyRound} tone="info" size={38} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 15 }}>Ubah PIN</Text>
            <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>PIN 6 digit untuk membuka aplikasi</Text>
          </View>
          <ChevronRight size={20} color={colors.textFaint} strokeWidth={1.75} />
        </PressableScale>
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.hairline }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 15 }}>Buka dengan biometrik</Text>
              <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 2 }}>
                {bioTersedia ? "Sidik jari atau wajah. PIN tetap bisa dipakai kapan saja." : (PESAN_STATUS_BIO[biometricStatus] ?? "Tidak tersedia.")}
              </Text>
            </View>
            <Switch
              value={biometricEnabled} disabled={!bioTersedia && !biometricEnabled} onValueChange={(v) => { void ubahBiometrik(v); }}
              accessibilityLabel="Buka dengan biometrik" trackColor={{ false: colors.neutralSoft, true: colors.primary }} thumbColor="#FFFFFF"
            />
          </View>
        </View>
        <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.hairline }}>
          <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 15 }}>Kunci otomatis</Text>
          <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 2, marginBottom: 10 }}>
            Aplikasi terkunci bila ditinggalkan lebih lama dari batas ini.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {TIMEOUT_PILIHAN.map((t) => <Chip key={t.ms} label={t.label} aktif={timeoutMs === t.ms} onPress={() => { void setTimeoutMs(t.ms); }} />)}
          </View>
        </View>
      </GlassCard>

      <SectionHeader judul="Hak akses Anda" />
      <GlassCard>
        <Text style={{ color: colors.text, fontFamily: font.semibold, fontSize: 15 }}>{user?.name}</Text>
        <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2, marginBottom: 10 }}>{user?.roles.join(" · ")}</Text>
        {ringkasHakAkses(caps).map((h) => (
          <View key={h.need} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }} accessibilityLabel={`${h.boleh ? "Boleh" : "Tidak boleh"} ${h.label}`}>
            {h.boleh ? <Check size={18} color={colors.success} strokeWidth={2} /> : <Minus size={18} color={colors.textFaint} strokeWidth={2} />}
            <Text style={{ flex: 1, color: h.boleh ? colors.text : colors.textFaint, fontFamily: font.regular, fontSize: 13 }}>{h.label}</Text>
          </View>
        ))}
        <Text style={{ color: colors.textFaint, fontFamily: font.regular, fontSize: 11, lineHeight: 15, marginTop: 8 }}>
          Diambil dari server dan diperbarui tiap aplikasi dibuka. Verifikasi pembayaran khusus peran Keuangan.
        </Text>
      </GlassCard>

      <SectionHeader judul="Perangkat ini" />
      <GlassCard>
        <Baris label="Model" isi={Device.modelName ?? "Tidak diketahui"} />
        <Baris label="Sistem" isi={`${Device.osName ?? "Android"} ${Device.osVersion ?? ""}`.trim()} />
        <Baris label="Versi aplikasi" isi={`${ENV.version} (${ENV.variant})`} />
        <Baris label="ID perangkat" isi={deviceId ? `…${deviceId.slice(-8)}` : "—"} />
      </GlassCard>

      <SectionHeader judul="Perangkat yang sedang masuk" />
      {sesi.isLoading ? (
        <Skeleton tinggi={72} />
      ) : sesi.isError ? (
        <ErrorState judul="Daftar perangkat belum bisa dimuat" isi={pesanUntukPengguna(sesi.error)} onCoba={() => void sesi.refetch()} />
      ) : (
        <GlassCard padding={4}>
          {(sesi.data ?? []).map((s, i) => (
            <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: font.medium, fontSize: 14 }}>{s.deviceLabel ?? "Perangkat"}{s.current ? " · perangkat ini" : ""}</Text>
                <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, marginTop: 2 }}>
                  Aktif {waktuRelatif(s.lastSeenAt)}{s.appVersion ? ` · v${s.appVersion}` : ""}
                </Text>
              </View>
              {!s.current ? (
                <PressableScale onPress={() => konfirmasiKeluarkan(s)} disabled={!online || keluarkan.isPending} accessibilityLabel={`Keluarkan ${s.deviceLabel ?? "perangkat"}`} style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: "center" }}>
                  <Text style={{ color: colors.danger, fontFamily: font.semibold, fontSize: 13 }}>Keluarkan</Text>
                </PressableScale>
              ) : null}
            </View>
          ))}
        </GlassCard>
      )}

      <Button label="Keluar dari akun" variant="danger" icon={LogOut} onPress={keluar} style={{ marginTop: 24 }} />
    </Screen>
  );
}
