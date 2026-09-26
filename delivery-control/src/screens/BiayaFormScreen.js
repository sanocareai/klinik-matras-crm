import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { emptyDraft, metadataFieldsFor, newIdempotencyKey, toCreateBody, validateDraft } from "@sano/delivery-shared";
import { biayaArmadaApi, client } from "../client";
import { useDraftStore } from "../draftStore";
import { elevation, radius, useTheme } from "../theme";
import { hariIniWIB } from "../format";
import { Icon, iconForExpense } from "../icons";
import { Box, Btn, Field, PickerField, Section, StateView } from "../ui";

const SUMBER_DANA_DIDUKUNG = ["TALANGAN_PRIBADI", "REKENING_PERUSAHAAN", "BELUM_DIBAYAR"];
const KEYBOARD = { number: "numeric", decimal: "decimal-pad", money: "numeric" };

function tanggalPlus(hari) {
  return new Date(Date.now() + 7 * 3600_000 + hari * 86400_000).toISOString().slice(0, 10);
}

export default function BiayaFormScreen({ route, navigation }) {
  const t = useTheme();
  const editId = route.params?.id || null;
  const store = useDraftStore();
  const [config, setConfig] = useState(null);
  const [vehicles, setVehicles] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [draft, setDraft] = useState(() => ({ ...emptyDraft(hariIniWIB()), sumberDana: "TALANGAN_PRIBADI" }));
  const [foto, setFoto] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Kunci idempotensi & langkah yang sudah sukses dipertahankan antar percobaan ulang.
  const keys = useRef({ create: newIdempotencyKey("ctl-c"), update: newIdempotencyKey("ctl-u"), ajukan: newIdempotencyKey("ctl-a") });
  const progres = useRef({ serverId: editId, fotoOk: false, tersimpan: false });

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setMeta = (k, v) => setDraft((d) => ({ ...d, metadata: { ...d.metadata, [k]: v } }));

  const muat = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const [cfg, veh, rt] = await Promise.all([
        biayaArmadaApi.config(),
        client.request("/armada/vehicles"),
        client.request(`/armada/routes?from=${tanggalPlus(-14)}&to=${tanggalPlus(1)}&take=40`),
      ]);
      setConfig(cfg);
      setVehicles((veh.vehicles || []).filter((v) => v.active !== false));
      setRoutes(rt.routes || []);
      if (editId) {
        const s = await biayaArmadaApi.detail(editId);
        setDraft({
          expenseType: s.expenseType, amount: String(s.amount ?? ""), date: String(s.date).slice(0, 10), description: s.description || "",
          notes: s.notes || "", vehicleId: s.vehicleId || "", routeId: s.routeId || "", jobId: s.jobId || "", vendorName: s.vendorName || "",
          metadata: s.metadata || {}, sumberDana: s.sumberDana || "TALANGAN_PRIBADI",
        });
      }
    } catch (e) { setLoadError(e.message || "Gagal memuat data formulir"); }
    finally { setLoading(false); }
  }, [editId]);
  useEffect(() => { muat(); }, [muat]);

  const jenis = useMemo(() => (config?.expenseTypes || []).map((x) => ({ value: x.code, label: x.label, icon: iconForExpense(x.code) })), [config]);
  const sumber = useMemo(() => (config?.sumberDana || []).filter((x) => SUMBER_DANA_DIDUKUNG.includes(x.code)).map((x) => ({ value: x.code, label: x.label })), [config]);
  const kendaraan = useMemo(() => (vehicles || []).map((v) => ({ value: v.id, label: v.plateNumber, sub: v.type, icon: "truck" })), [vehicles]);
  const rute = useMemo(() => (routes || []).map((r) => ({ value: r.id, label: r.code, sub: String(r.date).slice(0, 10), icon: "route" })), [routes]);
  const jobs = useMemo(() => {
    const r = (routes || []).find((x) => x.id === draft.routeId);
    return (r?.jobs || []).map((j) => ({ value: j.id, label: `${j.type === "PICKUP" ? "Ambil" : "Kirim"} · ${j.order?.orderNumber || j.id.slice(0, 6)}`, sub: j.order?.customer?.name }));
  }, [routes, draft.routeId]);
  const metaFields = metadataFieldsFor(config, draft.expenseType);

  async function ambilFoto() {
    const izin = await ImagePicker.requestCameraPermissionsAsync();
    if (!izin.granted) { setError("Izin kamera ditolak. Aktifkan di pengaturan HP untuk memotret struk."); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (!r.canceled && r.assets?.[0]) {
      const a = r.assets[0];
      setFoto({ uri: a.uri, type: a.mimeType || "image/jpeg" });
      progres.current.fotoOk = false;
      setError("");
    }
  }

  function periksa() {
    const v = validateDraft(draft, config);
    setErrors(v.errors);
    if (!v.ok) { setError("Lengkapi isian yang ditandai."); return false; }
    setError("");
    return true;
  }

  async function simpanLokal() {
    if (!periksa() || !store) return;
    setBusy(true);
    try {
      await store.save({ ...draft, amount: Number(draft.amount) }, { photo: foto, autoSubmit: false });
      navigation.goBack();
    } catch (e) { setError(e.message || "Gagal menyimpan draf lokal"); }
    finally { setBusy(false); }
  }

  async function kirim(ajukan) {
    if (!periksa()) return;
    setBusy(true); setError("");
    try {
      const body = { ...draft, amount: Number(draft.amount) };
      const p = progres.current;
      if (!p.serverId) {
        const created = await biayaArmadaApi.create(body, keys.current.create);
        p.serverId = created.id;
      } else if (!p.tersimpan) {
        const { workspace, ...patch } = toCreateBody(body);
        await biayaArmadaApi.update(p.serverId, patch, keys.current.update);
        p.tersimpan = true;
      }
      if (foto && !p.fotoOk) { await biayaArmadaApi.uploadBukti(p.serverId, foto); p.fotoOk = true; }
      if (ajukan) await biayaArmadaApi.ajukan(p.serverId, keys.current.ajukan);
      navigation.replace("BiayaDetail", { id: p.serverId });
    } catch (e) {
      setError(`${e.message || "Gagal mengirim"}${progres.current.serverId ? " Tekan tombol lagi untuk melanjutkan; data yang sudah tersimpan tidak dobel." : ""}`);
    } finally { setBusy(false); }
  }

  if (loading) return <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}><StateView loading title="Menyiapkan formulir…" /></SafeAreaView>;
  if (loadError) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}>
        <StateView icon="alert" tone="red" title="Formulir belum dapat dibuka" message={loadError} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={muat} />} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {!!error && <Box>{error}</Box>}
          <Section title="Biaya" icon="receipt">
            <View style={{ gap: 12 }}>
              <PickerField label="Jenis biaya" required icon="receipt" value={draft.expenseType} options={jenis} onSelect={(v) => setDraft((d) => ({ ...d, expenseType: v, metadata: {} }))} error={errors.expenseType} />
              <Field label="Nominal (Rp)" required icon="wallet" style={{ fontSize: 20, fontWeight: "800" }} keyboardType="numeric" value={String(draft.amount)} onChangeText={(v) => set("amount", v.replace(/[^0-9]/g, ""))} error={errors.amount} placeholder="0" />
              <Field label="Tanggal" required icon="calendar" value={draft.date} onChangeText={(v) => set("date", v)} error={errors.date} hint="Format TTTT-BB-HH, misalnya 2026-09-24" autoCapitalize="none" />
              <Field label="Vendor / tempat" icon="store" value={draft.vendorName || ""} onChangeText={(v) => set("vendorName", v)} placeholder="Mis. SPBU, bengkel" />
              {metaFields.map((f) => (
                <Field
                  key={f.key} label={f.label} required={f.required} value={String(draft.metadata?.[f.key] ?? "")}
                  onChangeText={(v) => setMeta(f.key, v)} keyboardType={KEYBOARD[f.type]} error={errors[`metadata.${f.key}`]}
                  hint={f.key === "odometerKm" && !f.required ? "Opsional" : undefined}
                />
              ))}
              <Field label="Catatan" multiline value={draft.notes} onChangeText={(v) => set("notes", v)} placeholder="Opsional" />
            </View>
          </Section>

          <Section title="Terkait" icon="truck">
            <View style={{ gap: 12 }}>
              <PickerField label="Kendaraan" icon="truck" value={draft.vehicleId} options={kendaraan} onSelect={(v) => set("vehicleId", v)} allowClear placeholder="Opsional" emptyText="Belum ada kendaraan aktif" />
              <PickerField label="Rute" icon="route" value={draft.routeId} options={rute} onSelect={(v) => setDraft((d) => ({ ...d, routeId: v, jobId: "" }))} allowClear placeholder="Opsional" emptyText="Tidak ada rute dalam 2 minggu terakhir" />
              {!!draft.routeId && <PickerField label="Job" icon="box" value={draft.jobId} options={jobs} onSelect={(v) => set("jobId", v)} allowClear placeholder="Opsional" emptyText="Rute ini belum punya job" />}
            </View>
          </Section>

          <Section title="Sumber dana" icon="wallet">
            <PickerField label="Dibayar dari" required icon="wallet" value={draft.sumberDana} options={sumber} onSelect={(v) => set("sumberDana", v)} />
            <Text style={{ color: t.ink3, fontSize: 12 }}>Rekening kas/bank final dipilih Finance saat pembayaran.</Text>
          </Section>

          <Section title="Foto struk" icon="camera">
            {foto ? (
              <Image source={{ uri: foto.uri }} style={[s.foto, { backgroundColor: t.field }]} resizeMode="contain" accessibilityLabel="Foto struk yang dipilih" />
            ) : (
              <Pressable onPress={ambilFoto} accessibilityRole="button" accessibilityLabel="Potret struk"
                style={({ pressed }) => [s.fotoKosong, { backgroundColor: t.accentBg, borderColor: t.accent, opacity: pressed ? 0.8 : 1 }]}>
                <View style={[s.camera, { backgroundColor: t.accent }]}><Icon name="camera" size={24} color={t.accentInk} /></View>
                <Text style={{ color: t.ink, fontWeight: "700", fontSize: 14 }}>Ketuk untuk memotret struk</Text>
                <Text style={{ color: t.ink2, fontSize: 12, textAlign: "center" }}>Belum ada foto. Struk wajib dilampirkan sebelum biaya bisa disetujui.</Text>
              </Pressable>
            )}
            <Btn title={foto ? "Foto ulang" : "Potret struk"} kind="secondary" icon="camera" onPress={ambilFoto} />
          </Section>
        </ScrollView>

        <View style={[s.footer, { backgroundColor: t.surface, borderColor: t.border }, elevation(t, 2)]}>
          {!editId && <Btn title="Simpan draf lokal" kind="ghost" onPress={simpanLokal} disabled={busy} icon="cloudOff" size="sm" style={s.f} />}
          <Btn title={editId ? "Simpan perubahan" : "Simpan ke server"} kind="ghost" onPress={() => kirim(false)} busy={busy} size="sm" style={s.f} />
          <Btn title="Ajukan" onPress={() => kirim(true)} busy={busy} icon="send" size="lg" style={s.full} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 18, gap: 14, paddingBottom: 28 },
  foto: { width: "100%", height: 240, borderRadius: radius.md },
  fotoKosong: { borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 22, paddingHorizontal: 16 },
  camera: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 14, borderTopWidth: 1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  f: { flexGrow: 1, flexBasis: "45%" },
  full: { flexBasis: "100%" },
});
