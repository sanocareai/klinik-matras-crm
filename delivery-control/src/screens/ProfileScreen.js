import React, { useEffect, useMemo, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { client } from "../client";
import { profileApi } from "../profileApi";
import { useSession } from "../SessionContext";
import { useMuat } from "../useMuat";
import { waktuWIB, tanggalWIB } from "../format";
import { bentukProfil, inisial, kedaluwarsaToken, labelDivisi, labelPeran, perubahanProfil, validasiProfil } from "../lib/profil";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { ActionModal, ActionSheet, Box, Btn, Chip, Field, Row, Section, StateView } from "../ui";
import { BottomNav, NAV_SPACE } from "../BottomNav";

// AKUN: profil dari server (akun yang sama dengan web). Nama, email, dan foto boleh diubah (PATCH /users/me, POST /users/me/avatar);
// peran, divisi, dan izin READ-ONLY (hanya Admin di web yang mengubahnya). HP tidak ditampilkan karena server belum menyimpannya.
export default function ProfileScreen({ navigation }) {
  const t = useTheme();
  const { muatUlangSesi, signOut } = useSession();
  const q = useMuat(async () => { const { auth, users } = await profileApi.ambil(); return bentukProfil(auth, users); }, [], navigation);
  const p = q.data;

  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ nama: "", email: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [sheet, setSheet] = useState(false);
  const [keluar, setKeluar] = useState(false);
  const [fotoBusy, setFotoBusy] = useState(false);

  useEffect(() => { if (p && !edit) setF({ nama: p.nama, email: p.email }); }, [p, edit]);
  const berakhir = useMemo(() => kedaluwarsaToken(client.getToken()), [q.data]);

  async function simpan() {
    const v = validasiProfil(f);
    setErrors(v.errors);
    if (!v.ok) return;
    const body = perubahanProfil(p, f);
    if (Object.keys(body).length === 0) { setEdit(false); return; }
    setBusy(true); setError(""); setOk("");
    try {
      await profileApi.ubah(body);
      await Promise.all([q.muat({ diam: true }), muatUlangSesi().catch(() => null)]);
      setEdit(false);
      setOk("Profil tersimpan di server dan langsung berlaku di web.");
    } catch (e) { setError(e.message || "Gagal menyimpan profil"); }
    finally { setBusy(false); }
  }

  async function pilihFoto(sumber) {
    setError(""); setOk("");
    try {
      let hasil;
      if (sumber === "kamera") {
        const izin = await ImagePicker.requestCameraPermissionsAsync();
        if (!izin.granted) { setError("Izin kamera ditolak. Aktifkan di pengaturan HP untuk memotret foto profil."); return; }
        hasil = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      } else {
        hasil = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      }
      if (hasil.canceled || !hasil.assets?.[0]) return;
      const a = hasil.assets[0];
      setFotoBusy(true);
      await profileApi.unggahFoto({ uri: a.uri, type: a.mimeType || "image/jpeg", name: "avatar.jpg" });
      await Promise.all([q.muat({ diam: true }), muatUlangSesi().catch(() => null)]);
      setOk("Foto profil diperbarui.");
    } catch (e) { setError(e.message || "Gagal mengunggah foto"); }
    finally { setFotoBusy(false); }
  }

  const foto = p?.avatarUrl ? client.mediaUrl(p.avatarUrl) : null;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["top"]}>
      {!p ? (
        q.status === "gagal"
          ? <StateView icon="alert" tone="red" title="Profil belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
          : <StateView loading title="Memuat profil…" />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={[s.body, { paddingBottom: NAV_SPACE + 24 }]} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}>
            <View style={[s.hero, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 1)]}>
              <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel="Ganti foto profil" disabled={fotoBusy}>
                {foto
                  ? <Image source={{ uri: foto }} style={s.avatar} accessibilityLabel="Foto profil" />
                  : <View style={[s.avatar, { backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }]}><Text style={{ color: t.accent, fontSize: 30, fontWeight: "800" }}>{inisial(p.nama)}</Text></View>}
                <View style={[s.cam, { backgroundColor: t.accent, borderColor: t.surface }]}><Icon name={fotoBusy ? "refresh" : "camera"} size={15} color={t.accentInk} /></View>
              </Pressable>
              <Text style={[type.title, { color: t.ink, textAlign: "center" }]} numberOfLines={2}>{p.nama}</Text>
              <Text style={{ color: t.ink2, fontSize: 13 }}>{p.email}</Text>
              <View style={s.chips}>{p.roles.map((r) => <Chip key={r} label={labelPeran(r)} tone="accent" size="sm" />)}</View>
            </View>

            {!!ok && <Box tone="accent" icon="checkCircle">{ok}</Box>}
            {!!error && <Box>{error}</Box>}

            <Section title="Data akun" icon="user" right={!edit ? <Pressable onPress={() => { setEdit(true); setOk(""); }} hitSlop={8} accessibilityRole="button"><Text style={{ color: t.accent, fontWeight: "700", fontSize: 13 }}>Ubah</Text></Pressable> : null}>
              {edit ? (
                <View style={{ gap: 12 }}>
                  <Field label="Nama" required icon="user" value={f.nama} onChangeText={(v) => setF((x) => ({ ...x, nama: v }))} error={errors.nama} autoCapitalize="words" />
                  <Field label="Email" required icon="note" value={f.email} onChangeText={(v) => setF((x) => ({ ...x, email: v }))} error={errors.email} autoCapitalize="none" keyboardType="email-address" hint="Email juga dipakai untuk login di web dan aplikasi." />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Btn title="Batal" kind="ghost" onPress={() => { setEdit(false); setErrors({}); setError(""); }} disabled={busy} style={{ flex: 1 }} />
                    <Btn title="Simpan" icon="checkCircle" onPress={simpan} busy={busy} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <View>
                  <Row icon="user" label="Nama" value={p.nama} />
                  <Row icon="note" label="Email" value={p.email} />
                  <Row icon="calendar" label="Bergabung" value={p.bergabung ? tanggalWIB(p.bergabung) : "-"} last />
                </View>
              )}
            </Section>

            <Section title="Peran & divisi" icon="shield">
              <View style={{ gap: 8 }}>
                <Text style={{ color: t.ink3, fontSize: 12 }}>PERAN</Text>
                <View style={s.chips}>{p.roles.length ? p.roles.map((r) => <Chip key={r} label={labelPeran(r)} tone="accent" />) : <Text style={{ color: t.ink3 }}>-</Text>}</View>
                <Text style={{ color: t.ink3, fontSize: 12, marginTop: 6 }}>DIVISI</Text>
                <View style={s.chips}>{p.divisi.length ? p.divisi.map((d) => <Chip key={d} label={labelDivisi(d)} tone="cyan" />) : <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada keanggotaan divisi</Text>}</View>
              </View>
              <View style={s.note}>
                <Icon name="info" size={14} color={t.ink3} />
                <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>Peran, divisi, dan izin hanya bisa diubah Admin di web.</Text>
              </View>
            </Section>

            <Section title="Sesi" icon="clock">
              <View>
                <Row icon="shield" label="Perangkat ini" value="Masuk" />
                <Row icon="clock" label="Sesi berlaku hingga" value={berakhir ? waktuWIB(berakhir) : "Tidak diketahui"} last />
              </View>
              <Text style={{ color: t.ink3, fontSize: 12 }}>Masa sesi diperpanjang otomatis oleh server selama aplikasi dipakai.</Text>
            </Section>

            <View style={{ gap: 10 }}>
              <Btn title="Pengaturan" icon="gauge" kind="secondary" onPress={() => navigation.navigate("Pengaturan")} />
              <Btn title="Keluar" icon="logout" kind="danger" onPress={() => setKeluar(true)} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <BottomNav navigation={navigation} current="Akun" />

      <ActionSheet
        visible={sheet} title="Foto profil" onClose={() => setSheet(false)}
        options={[
          { label: "Ambil foto", icon: "camera", onPress: () => pilihFoto("kamera") },
          { label: "Pilih dari galeri", icon: "image", onPress: () => pilihFoto("galeri") },
        ]}
      />
      <ActionModal
        visible={keluar} title="Keluar dari akun?" message="Anda perlu masuk lagi untuk membuka Delivery Control." icon="logout"
        confirmLabel="Keluar" danger onCancel={() => setKeluar(false)} onConfirm={() => { setKeluar(false); signOut(); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 18, gap: 14 },
  hero: { alignItems: "center", gap: 8, padding: 20, borderRadius: radius.xl, borderWidth: 1 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  cam: { position: "absolute", right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  note: { flexDirection: "row", alignItems: "center", gap: 6 },
});
