import React, { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Lock, Trash2 } from "lucide-react-native";
import { labelMetode } from "@/auth/biometrik";
import { BATAS_PILIHAN, useKeamanan } from "@/auth/keamanan";
import { PilihanChip } from "@/design/Form";
import { Button, Card, Chip, Section, T } from "@/design/ui";
import { TONE } from "@/design/tokens";
import { IkonMetode } from "./GerbangKunci";

// TAB AKUN › KEAMANAN — masuk cepat (hapus) dan kunci aplikasi (nyala/mati + batas waktu). Mengubah kunci wajib lolos
// sidik jari / wajah / PIN HP (src/auth/keamanan.ts).
export function PanelKeamanan() {
  const k = useKeamanan();
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void useKeamanan.getState().segarkanPerangkat(); }, []);
  const metode = labelMetode(k.info);
  const tanpaKunciLayar = k.info.status === "tidak_ada";

  const ubahKunci = async (aktif: boolean) => {
    setBusy(true); setPesan(null);
    const r = await k.setKunci(aktif);
    setPesan(r.ok ? { ok: true, teks: aktif ? `Kunci aplikasi aktif — dibuka dengan ${metode}.` : "Kunci aplikasi dimatikan." } : r.alasan === "dibatalkan" ? null : { ok: false, teks: r.pesan });
    setBusy(false);
  };
  const hapusCepat = () => Alert.alert("Hapus masuk cepat?", "Email & kata sandi tersimpan dihapus dari HP ini. Berikutnya masuk dengan mengetik kata sandi.", [
    { text: "Batal", style: "cancel" },
    { text: "Hapus", style: "destructive", onPress: () => { void k.hapusLoginCepat().then(() => setPesan({ ok: true, teks: "Masuk cepat dihapus dari HP ini." })); } },
  ]);

  return (
    <Section title="Keamanan & masuk cepat">
      <Card style={{ gap: 12 }}>
        {tanpaKunciLayar ? (
          <T.Sub style={{ color: TONE.orange.text }}>HP ini belum memakai kunci layar. Aktifkan sidik jari, wajah, atau PIN di Pengaturan HP → Keamanan untuk memakai masuk cepat & kunci aplikasi.</T.Sub>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: TONE.blue.fill, alignItems: "center", justifyContent: "center" }}><IkonMetode info={k.info} size={22} /></View>
            <T.Sub style={{ flex: 1 }}>HP ini bisa memakai {metode}{k.info.status === "tersedia" ? " (cadangan: PIN/pola HP)" : ""}.</T.Sub>
          </View>
        )}

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T.Headline>Masuk cepat</T.Headline>
            <Chip label={k.loginCepatEmail ? "Aktif" : "Belum aktif"} tone={k.loginCepatEmail ? "green" : "gray"} />
          </View>
          <T.Caption>{k.loginCepatEmail
            ? `Saat harus masuk lagi, cukup ${metode} — tanpa mengetik kata sandi (${k.loginCepatEmail}).`
            : "Centang “Simpan untuk masuk cepat” saat masuk berikutnya."}</T.Caption>
          {k.loginCepatEmail ? <Button kind="tinted" tone="red" icon={<Trash2 color={TONE.red.text} size={18} />} label="Hapus masuk cepat" onPress={hapusCepat} /> : null}
        </View>

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <T.Headline>Kunci aplikasi</T.Headline>
            <Chip label={k.kunciAktif ? "Aktif" : "Mati"} tone={k.kunciAktif ? "green" : "gray"} />
          </View>
          <T.Caption>Saat aplikasi dibuka atau kembali setelah tidak dipakai, minta {metode} dulu. Cocok bila HP sering dipinjam.</T.Caption>
          {!tanpaKunciLayar ? (
            <Button kind="tinted" icon={<Lock color={TONE.blue.text} size={18} />} label={k.kunciAktif ? "Matikan kunci aplikasi" : "Aktifkan kunci aplikasi"} onPress={() => void ubahKunci(!k.kunciAktif)} busy={busy} />
          ) : null}
          {k.kunciAktif ? (
            <PilihanChip label="Kunci setelah tidak dipakai" options={BATAS_PILIHAN.map((b) => ({ value: String(b.ms), label: b.label }))} value={[String(k.batasMs)]}
              onChange={(v) => { if (v[0]) void k.setBatas(Number(v[0])); }} />
          ) : null}
        </View>
        {pesan ? <T.Caption style={{ color: pesan.ok ? TONE.green.text : TONE.red.text }}>{pesan.teks}</T.Caption> : null}
      </Card>
    </Section>
  );
}
