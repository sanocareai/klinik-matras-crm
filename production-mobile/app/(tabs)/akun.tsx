import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { Bell, Camera, Info, LogOut, Server, ShieldCheck } from "lucide-react-native";
import { aktifkanNotifikasi, pushTersedia, statusIzin, type StatusIzin } from "@/auth/push";
import { useLayout } from "@/api/production";
import { gantiFotoProfil } from "@/api/profil";
import { pesanUntukPengguna } from "@/api/errors";
import { useSession } from "@/auth/session";
import { Baris, Button, Card, Chip, FotoProfil, HeroCard, KepalaJudul, KeteranganPanel, PilKaca, Screen, Section, T, TeksBaris } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { PanelKeamanan } from "@/features/PanelKeamanan";
import { C, F, TONE } from "@/design/tokens";
import { ENV } from "@/lib/env";

// AKUN — profil yang TERINTEGRASI dengan SANSS: nama, peran, dan foto profil dibaca dari akun SANSS yang sama (GET /auth/me).
// Foto diganti lewat POST /api/mobile/me/avatar → kolom User.avatarUrl yang juga dipakai SANSS Web & aplikasi Finance,
// jadi mengganti di sini langsung terlihat di web, dan foto yang diganti di web muncul di sini saat tab ini dibuka / ditarik.

/** Label peran SANSS dalam bahasa tim (kode peran sama dengan web). */
const LABEL_PERAN: Record<string, string> = {
  OWNER: "Owner", ADMIN: "Admin", PRODUCTION_LEAD: "Kepala Produksi", QC_LEAD: "QC", PRODUCTION_DOCUMENTER: "Dokumentasi",
  PRODUCTION_WORKER: "PIC Meja / Corner", WAREHOUSE: "Gudang", FINANCE: "Finance", ACCOUNTANT: "Akuntan", SALES: "Sales",
  DRIVER: "Driver", HELPER: "Helper", LEADER_DRIVER: "Leader Driver", DISPATCHER: "Dispatcher", APPROVER: "Approver",
};
const RINGKAS_PRESET: Record<string, string> = { ADMIN: "Admin Produksi", QC: "QC & Dokumentasi", DOKUMENTASI: "Dokumentasi", MEJA: "PIC Meja / Corner", NONE: "—" };

export default function Akun() {
  const user = useSession((s) => s.user);
  const logout = useSession((s) => s.logout);
  const refreshMe = useSession((s) => s.refreshMe);
  const setAvatar = useSession((s) => s.setAvatar);
  const l = useLayout();
  const [izin, setIzin] = useState<StatusIzin>("tidak_tersedia");
  const [pesanNotif, setPesanNotif] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [foto, setFoto] = useState<{ sibuk: boolean; pesan: string | null; ok: boolean }>({ sibuk: false, pesan: null, ok: true });
  useEffect(() => { void statusIzin().then(setIzin); }, []);
  // Setiap kali tab Akun dibuka: muat ulang profil dari SANSS (foto/nama/peran yang diubah di web ikut terbaru).
  useFocusEffect(useCallback(() => { void refreshMe(); }, [refreshMe]));

  const nyalakan = async () => {
    const r = await aktifkanNotifikasi();
    setIzin(await statusIzin());
    setPesanNotif(r === "ok" ? "Notifikasi aktif di HP ini." : r === "ditolak" ? "Izin ditolak — aktifkan lewat Pengaturan HP → Aplikasi → SANSS Produksi." : "Notifikasi belum bisa didaftarkan. Coba lagi nanti.");
  };
  const muatUlang = async () => { setMemuat(true); await refreshMe(); setMemuat(false); };

  async function ambilFoto(galeri: boolean) {
    try {
      const izinFoto = galeri ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
      if (!izinFoto.granted) { Alert.alert(galeri ? "Izin galeri ditolak" : "Izin kamera ditolak", "Buka Pengaturan HP untuk mengizinkannya."); return; }
      const opsi = { mediaTypes: ["images"] as ImagePicker.MediaType[], allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.8 };
      const r = galeri ? await ImagePicker.launchImageLibraryAsync(opsi) : await ImagePicker.launchCameraAsync({ ...opsi, cameraType: ImagePicker.CameraType.front });
      if (r.canceled || !r.assets[0]) return;
      setFoto({ sibuk: true, pesan: null, ok: true });
      const url = await gantiFotoProfil(r.assets[0]);
      await setAvatar(url);
      haptic.sukses();
      setFoto({ sibuk: false, pesan: "Foto profil diperbarui — juga tampil di SANSS Web.", ok: true });
    } catch (e) {
      setFoto({ sibuk: false, pesan: pesanUntukPengguna(e), ok: false });
    }
  }
  const pilihSumber = () => {
    haptic.tick();
    Alert.alert("Ganti foto profil", "Foto dipakai di aplikasi Produksi, Finance, dan SANSS Web.", [
      { text: "Kamera", onPress: () => void ambilFoto(false) },
      { text: "Galeri", onPress: () => void ambilFoto(true) },
      { text: "Batal", style: "cancel" },
    ]);
  };

  const akses = [l.lane && "Antrean Meja/Corner", l.qc && "Putusan QC", l.docs && "Dokumentasi", l.admin && "Target & PIC", l.executeAny && "Semua PIC"].filter(Boolean) as string[];
  const peran = (user?.roles?.length ? user.roles : user?.role ? [user.role] : []).map((r) => LABEL_PERAN[r] ?? r);
  const inisial = (user?.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
  const server = ENV.apiUrl.replace(/^https?:\/\//, "").replace(/\/api$/, "");

  return (
    <Screen refreshing={memuat} onRefresh={() => void muatUlang()}>
      <KepalaJudul keterangan="Profil SANSS" judul="Akun" />

      {/* Kartu utama kaca: foto besar (ketuk untuk mengganti), nama, dan peran — semuanya dari akun SANSS yang sama dengan web. */}
      <HeroCard>
        <View style={{ alignItems: "center", gap: 12, paddingTop: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Ganti foto profil" disabled={foto.sibuk} onPress={pilihSumber}>
            <FotoProfil inisial={inisial} url={user?.avatarUrl} size={96} cincin={2} />
            <View style={{ position: "absolute", right: -2, bottom: -2, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: C.white, boxShadow: "0 4px 12px rgba(5,40,140,0.3)" }}>
              <Camera size={17} color={TONE.blue.text} strokeWidth={2.4} />
            </View>
          </Pressable>
          <View style={{ alignItems: "center", gap: 2 }}>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 22, letterSpacing: -0.4, color: C.white, textAlign: "center" }}>{user?.name ?? "—"}</Text>
            <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 14, color: "#DCEBFF" }}>{RINGKAS_PRESET[l.preset] ?? l.preset}</Text>
          </View>
          {peran.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              {peran.map((p) => <PilKaca key={p}><Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 12, color: C.white }}>{p}</Text></PilKaca>)}
            </View>
          ) : null}
          {foto.sibuk ? <Text style={{ fontFamily: F.semibold, fontSize: 13, color: C.white }}>Mengunggah foto…</Text> : null}
          {foto.pesan ? <Text style={{ fontFamily: F.semibold, fontSize: 13, color: foto.ok ? "#C9F7D6" : "#FFD0D4", textAlign: "center" }}>{foto.pesan}</Text> : null}
        </View>
      </HeroCard>

      <Section title="Akses di aplikasi ini" right={<KeteranganPanel>dari server</KeteranganPanel>}>
        <Baris>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}><ShieldCheck size={18} color={TONE.blue.text} strokeWidth={2.2} /></View>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {akses.length ? akses.map((a) => <Chip key={a} label={a} tone="blue" />) : <T.RowSub style={{ fontSize: 13 }}>Tidak ada akses produksi.</T.RowSub>}
          </View>
        </Baris>
        <T.RowSub style={{ marginHorizontal: 4 }}>Akses diatur Admin di SANSS Web → Pengguna & Peran. Perubahan berlaku saat tab ini dibuka lagi.</T.RowSub>
      </Section>

      <Section title="Notifikasi">
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}><Bell size={18} color={TONE.blue.text} strokeWidth={2.2} /></View>
            <T.RowSub style={{ flex: 1, fontSize: 13, lineHeight: 18, color: C.ink2 }}>
              {!pushTersedia() ? "Notifikasi belum diaktifkan di versi aplikasi ini." : izin === "granted" ? "Aktif — kamu dikabari saat kasur siap QC, siap Corner, kembali untuk rework, urutan meja berubah, atau ada Komplain untuk unit di workshop (Admin)." : "Dapatkan kabar saat ada kasur yang menunggu kamu."}
            </T.RowSub>
          </View>
          {pushTersedia() && izin !== "granted" ? <Button kind="tinted" label="Aktifkan notifikasi" icon={<Bell color="#0056B3" size={20} />} onPress={() => void nyalakan()} /> : null}
          {pesanNotif ? <T.Caption>{pesanNotif}</T.Caption> : null}
        </Card>
      </Section>

      <PanelKeamanan />

      <Section title="Tentang aplikasi">
        <Baris>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}><Info size={18} color={TONE.blue.text} strokeWidth={2.2} /></View>
          <TeksBaris judul={`SANSS Produksi ${ENV.version}`} sub={ENV.variant === "production" ? "Versi rilis" : `Varian ${ENV.variant}`} />
        </Baris>
        <Baris>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}><Server size={18} color={TONE.blue.text} strokeWidth={2.2} /></View>
          <TeksBaris judul="Server" sub={server} />
        </Baris>
      </Section>

      {/* Tombol keluar di dalam panel: latar memudar ke terang di bawah, jadi tombol tidak dibiarkan berdiri sendiri di atas latar. */}
      <Card>
        <View>
          <Button label="Keluar" kind="danger" icon={<LogOut color={TONE.red.text} size={20} />} onPress={() => void logout()} />
        </View>
      </Card>
    </Screen>
  );
}
