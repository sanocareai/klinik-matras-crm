import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Bell, LogOut } from "lucide-react-native";
import { aktifkanNotifikasi, pushTersedia, statusIzin, type StatusIzin } from "@/auth/push";
import { useLayout } from "@/api/production";
import { useSession } from "@/auth/session";
import { Baris, Button, Card, Chip, IconOrb, KepalaJudul, Screen, Section, T, TeksBaris } from "@/design/ui";
import { PanelKeamanan } from "@/features/PanelKeamanan";
import { C, F, TONE } from "@/design/tokens";
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
  const inisial = (user?.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";

  return (
    <Screen>
      <KepalaJudul keterangan={`SANSS Produksi ${ENV.version} · ${ENV.variant}`} judul="Akun" />

      <Card style={{ gap: 8 }}>
        <Baris>
          <IconOrb size={44}><Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: 15, color: C.white }}>{inisial}</Text></IconOrb>
          <TeksBaris judul={user?.name ?? "—"} sub={PERAN[l.preset] ?? l.preset} />
        </Baris>
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
          {pushTersedia() && izin !== "granted" ? <Button kind="tinted" label="Aktifkan notifikasi" icon={<Bell color="#0056B3" size={20} />} onPress={() => void nyalakan()} /> : null}
          {pesanNotif ? <T.Caption>{pesanNotif}</T.Caption> : null}
        </Card>
      </Section>

      <PanelKeamanan />

      {/* Tombol keluar di dalam panel: latar memudar ke terang di bawah, jadi tombol tidak dibiarkan berdiri sendiri di atas latar. */}
      <Card>
        <View>
          <Button label="Keluar" kind="danger" icon={<LogOut color={TONE.red.text} size={20} />} onPress={() => void logout()} />
        </View>
      </Card>
    </Screen>
  );
}
