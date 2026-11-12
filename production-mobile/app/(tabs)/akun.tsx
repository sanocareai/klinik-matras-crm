import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Bell, LogOut } from "lucide-react-native";
import { aktifkanNotifikasi, pushTersedia, statusIzin, type StatusIzin } from "@/auth/push";
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
  const [izin, setIzin] = useState<StatusIzin>("tidak_tersedia");
  const [pesanNotif, setPesanNotif] = useState<string | null>(null);
  useEffect(() => { void statusIzin().then(setIzin); }, []);
  const nyalakan = async () => {
    const r = await aktifkanNotifikasi();
    setIzin(await statusIzin());
    setPesanNotif(r === "ok" ? "Notifikasi aktif di HP ini." : r === "ditolak" ? "Izin ditolak — aktifkan lewat Pengaturan HP → Aplikasi → SANSS Produksi." : "Notifikasi belum bisa didaftarkan. Coba lagi nanti.");
  };
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
      <Section title="Notifikasi">
        <Card style={{ gap: 10 }}>
          <T.Sub>
            {!pushTersedia() ? "Notifikasi belum diaktifkan di versi aplikasi ini." : izin === "granted" ? "Aktif — kamu dikabari saat kasur siap QC, siap Corner, kembali untuk rework, urutan meja berubah, atau ada Komplain untuk unit di workshop (Admin)." : "Dapatkan kabar saat ada kasur yang menunggu kamu."}
          </T.Sub>
          {pushTersedia() && izin !== "granted" ? <Button kind="tinted" label="Aktifkan notifikasi" icon={<Bell color={TONE.blue.text} size={20} />} onPress={() => void nyalakan()} /> : null}
          {pesanNotif ? <T.Caption>{pesanNotif}</T.Caption> : null}
        </Card>
      </Section>
      <View style={{ marginTop: 8 }}>
        <Button label="Keluar" kind="danger" icon={<LogOut color={TONE.red.text} size={20} />} onPress={() => void logout()} />
      </View>
      <T.Caption style={{ textAlign: "center" }}>SANSS Produksi {ENV.version} · {ENV.variant}</T.Caption>
    </Screen>
  );
}
