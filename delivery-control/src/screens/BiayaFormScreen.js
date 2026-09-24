import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { emptyDraft, metadataFieldsFor, newIdempotencyKey, toCreateBody, validateDraft } from "@sano/delivery-shared";
import { biayaArmadaApi, client } from "../client";
import { useDraftStore } from "../draftStore";
import { useTheme } from "../theme";
import { hariIniWIB } from "../format";
import { Box, Btn, Field, PickerField, Section } from "../ui";

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

  const jenis = useMemo(() => (config?.expenseTypes || []).map((x) => ({ value: x.code, label: x.label })), [config]);
  const sumber = useMemo(() => (config?.sumberDana || []).filter((x) => SUMBER_DANA_DIDUKUNG.includes(x.code)).map((x) => ({ value: x.code, label: x.label })), [config]);
  const kendaraan = useMemo(() => (vehicles || []).map((v) => ({ value: v.id, label: v.plateNumber, sub: v.type })), [vehicles]);
  const rute = useMemo(() => (routes || []).map((r) => ({ value: r.id, label: r.code, sub: String(r.date).slice(0, 10) })), [routes]);
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

  if (loading) return <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}><ActivityIndicator style={{ marginTop: 40 }} color={t.accent} /></SafeAreaView>;
  if (loadError) {
    return (
      <SafeAreaView style={[s.root, { backgroundColor: t.bg }]}>
        <View style={{ padding: 16 }}><Box action={<Btn title="Coba lagi" kind="ghost" onPress={muat} />}>{loadError}</Box></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {!!error && <Box>{error}</Box>}
          <Section title="Biaya">
            <View style={{ gap: 12 }}>
              <PickerField label="Jenis biaya" required value={draft.expenseType} options={jenis} onSelect={(v) => setDraft((d) => ({ ...d, expenseType: v, metadata: {} }))} error={errors.expenseType} />
              <Field label="Nominal (Rp)" required keyboardType="numeric" value={String(draft.amount)} onChangeText={(v) => set("amount", v.replace(/[^0-9]/g, ""))} error={errors.amount} placeholder="0" />
              <Field label="Tanggal" required value={draft.date} onChangeText={(v) => set("date", v)} error={errors.date} hint="Format TTTT-BB-HH, misalnya 2026-09-24" autoCapitalize="none" />
              <Field label="Vendor / tempat" value={draft.vendorName || ""} onChangeText={(v) => set("vendorName", v)} placeholder="Mis. SPBU, bengkel" />
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

          <Section title="Terkait">
            <View style={{ gap: 12 }}>
              <PickerField label="Kendaraan" value={draft.vehicleId} options={kendaraan} onSelect={(v) => set("vehicleId", v)} allowClear placeholder="Opsional" emptyText="Belum ada kendaraan aktif" />
              <PickerField label="Rute" value={draft.routeId} options={rute} onSelect={(v) => setDraft((d) => ({ ...d, routeId: v, jobId: "" }))} allowClear placeholder="Opsional" emptyText="Tidak ada rute dalam 2 minggu terakhir" />
              {!!draft.routeId && <PickerField label="Job" value={draft.jobId} options={jobs} onSelect={(v) => set("jobId", v)} allowClear placeholder="Opsional" emptyText="Rute ini belum punya job" />}
            </View>
          </Section>

          <Section title="Sumber dana">
            <PickerField label="Dibayar dari" required value={draft.sumberDana} options={sumber} onSelect={(v) => set("sumberDana", v)} />
            <Text style={{ color: t.ink3, fontSize: 12, marginTop: 6 }}>Rekening kas/bank final dipilih Finance saat pembayaran.</Text>
          </Section>

          <Section title="Foto struk">
            {foto ? <Image source={{ uri: foto.uri }} style={s.foto} resizeMode="contain" accessibilityLabel="Foto struk yang dipilih" /> : <Text style={{ color: t.ink3, fontSize: 13 }}>Belum ada foto. Struk wajib dilampirkan sebelum biaya bisa disetujui.</Text>}
            <Btn title={foto ? "Foto ulang" : "Potret struk"} kind="ghost" onPress={ambilFoto} style={{ marginTop: 8 }} />
          </Section>
        </ScrollView>

        <View style={[s.footer, { backgroundColor: t.bg, borderColor: t.border }]}>
          {!editId && <Btn title="Simpan draf lokal" kind="ghost" onPress={simpanLokal} disabled={busy} style={s.f} />}
          <Btn title={editId ? "Simpan perubahan" : "Simpan ke server"} kind="ghost" onPress={() => kirim(false)} busy={busy} style={s.f} />
          <Btn title="Ajukan" onPress={() => kirim(true)} busy={busy} style={s.f} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 24 },
  foto: { width: "100%", height: 220, borderRadius: 10 },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  f: { flexGrow: 1, minWidth: 110 },
});
