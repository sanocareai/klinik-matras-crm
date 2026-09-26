import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { JOB_TYPE, gabungKru, jobStatusInfo, newIdempotencyKey, tanggalWIBPlus, tautanPeta, validasiReschedule } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useSession } from "../SessionContext";
import { tanggalWIB, waktuWIB } from "../format";
import { type, useTheme } from "../theme";
import { Icon } from "../icons";
import { ActionModal, Box, Btn, Chip, Field, PickerField, Row, Section } from "../ui";

// Detail job bermasalah + jadwal ulang: POST /armada/issues/:jobId/reschedule (job:write; server hanya menerima
// job berstatus FAILED, tanggal & alasan wajib). Driver/helper/kendaraan diisi dari penugasan lama supaya
// menjadwalkan ulang tidak diam-diam melepas penugasan. Idempotency-Key per percobaan.
export default function MasalahDetailScreen({ route, navigation }) {
  const t = useTheme();
  const { modules } = useSession();
  const job = route.params.job;
  const js = jobStatusInfo(job.status);
  const bolehJadwal = modules.reschedule && job.status === "FAILED";
  const hariIni = tanggalWIBPlus(0);

  const [kru, setKru] = useState(null);
  const [kendaraan, setKendaraan] = useState(null);
  const [f, setF] = useState({
    scheduledDate: tanggalWIBPlus(1), timeWindow: job.timeWindow || "", driverId: job.driverId || "", helperId: job.helperId || "",
    vehicleId: job.vehicleId || "", reason: "", customerConfirmed: false,
  });
  const [errors, setErrors] = useState({});
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kunci = useRef(null);

  useEffect(() => {
    if (!bolehJadwal) return;
    Promise.all([operasionalApi.driver(), operasionalApi.helper(), operasionalApi.kendaraan()])
      .then(([d, h, v]) => { setKru({ d, h }); setKendaraan((v.vehicles || []).filter((x) => x.active !== false)); })
      .catch((e) => setError(e.message || "Data kru/kendaraan tidak dapat dimuat"));
  }, [bolehJadwal]);

  const opsiDriver = useMemo(() => gabungKru(kru?.d || [], []).map((k) => ({ value: k.id, label: k.name, icon: "user" })), [kru]);
  const opsiHelper = useMemo(() => gabungKru([], kru?.h || []).map((k) => ({ value: k.id, label: k.name, icon: "users" })), [kru]);
  const opsiKendaraan = useMemo(() => (kendaraan || []).map((v) => ({ value: v.id, label: v.plateNumber, sub: v.type, icon: "truck" })), [kendaraan]);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); kunci.current = null; };
  const peta = tautanPeta(job.lat, job.lng);

  function periksa() {
    const v = validasiReschedule(f, hariIni);
    setErrors(v.errors);
    if (v.ok) { setError(""); setKonfirmasi(true); }
  }

  async function kirim() {
    setBusy(true); setError("");
    kunci.current ??= newIdempotencyKey("ctl-resched");
    try {
      const body = { scheduledDate: f.scheduledDate, reason: f.reason.trim(), customerConfirmed: f.customerConfirmed };
      for (const k of ["timeWindow", "driverId", "helperId", "vehicleId"]) if (f[k]) body[k] = f[k];
      await operasionalApi.reschedule(job.id, body, kunci.current);
      kunci.current = null;
      setKonfirmasi(false);
      navigation.goBack();
    } catch (e) {
      setError(e.message || "Gagal menjadwalkan ulang");
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Section title="Job" icon="box" right={<Chip label={js.label} tone={js.tone} size="sm" />}>
            <View>
              <Row icon="user" label="Pelanggan" value={job.order?.customer?.name} />
              <Row icon="hash" label="Order" value={job.order?.orderNumber} />
              <Row icon="truck" label="Jenis" value={JOB_TYPE[job.type] || job.type} />
              <Row icon="calendar" label="Jadwal" value={job.scheduledDate ? tanggalWIB(job.scheduledDate) : "Belum dijadwalkan"} />
              <Row icon="users" label="Driver" value={job.driver?.name || "-"} />
              <Row icon="route" label="Rute" value={job.route?.code || "-"} last={!job.addressText} />
              {!!job.addressText && <Row icon="mapPin" label="Alamat" value={job.addressText} last />}
            </View>
            {!!peta && <Btn title="Buka alamat di peta" kind="ghost" icon="mapPin" size="sm" onPress={() => Linking.openURL(peta)} />}
          </Section>

          {(!!job.failureReason || !!job.rescheduleReason) && (
            <Section title="Riwayat masalah" icon="alert">
              {!!job.failureReason && <Box tone="red">Gagal: {job.failureReason}</Box>}
              {!!job.rescheduleReason && (
                <Box tone="orange" icon="calendar">
                  Dijadwalkan ulang{job.rescheduledBy?.name ? ` oleh ${job.rescheduledBy.name}` : ""}{job.rescheduledAt ? ` (${waktuWIB(job.rescheduledAt)})` : ""}: {job.rescheduleReason}
                </Box>
              )}
              {!!job.rescheduleCase && <Text style={{ color: t.ink2, fontSize: 12 }}>Kasus {job.rescheduleCase.caseNumber} · putaran {job.rescheduleCase.round} · {job.rescheduleCase.status}</Text>}
            </Section>
          )}

          {bolehJadwal ? (
            <Section title="Jadwalkan ulang" icon="calendar">
              <Field label="Tanggal baru" required icon="calendar" value={f.scheduledDate} onChangeText={(v) => set("scheduledDate", v)} error={errors.scheduledDate} hint="Format TTTT-BB-HH" autoCapitalize="none" />
              <Field label="Jam kunjungan" icon="clock" value={f.timeWindow} onChangeText={(v) => set("timeWindow", v)} placeholder="Opsional, mis. 09:00-12:00" />
              <PickerField label="Driver" value={f.driverId} options={opsiDriver} onSelect={(v) => set("driverId", v)} allowClear placeholder="Tanpa driver" loading={!kru} icon="user" />
              <PickerField label="Helper" value={f.helperId} options={opsiHelper} onSelect={(v) => set("helperId", v)} allowClear placeholder="Tanpa helper" loading={!kru} icon="users" />
              <PickerField label="Kendaraan" value={f.vehicleId} options={opsiKendaraan} onSelect={(v) => set("vehicleId", v)} allowClear placeholder="Tanpa kendaraan" loading={!kendaraan} icon="truck" />
              <Field label="Alasan" required multiline value={f.reason} onChangeText={(v) => set("reason", v)} error={errors.reason} placeholder="Mis. pelanggan minta dikirim besok" />
              <View style={s.switch}>
                <Text style={{ color: t.ink, fontSize: 14, flex: 1 }}>Pelanggan sudah mengonfirmasi jadwal baru</Text>
                <Switch value={f.customerConfirmed} onValueChange={(v) => set("customerConfirmed", v)} />
              </View>
              {!!error && !konfirmasi && <Box>{error}</Box>}
              <Btn title="Jadwalkan ulang" icon="calendar" onPress={periksa} size="lg" />
            </Section>
          ) : (
            <View style={s.note}>
              <Icon name="info" size={14} color={t.ink3} />
              <Text style={{ color: t.ink3, fontSize: 12, flex: 1 }}>
                {job.status !== "FAILED" ? "Job ini sudah tidak berstatus Gagal; perubahan lanjutan dilakukan di Route Planner web." : "Akun Anda tidak punya izin menjadwalkan ulang job."}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ActionModal
        visible={konfirmasi} title="Jadwalkan ulang job ini?" icon="calendar"
        message={`Job dipindah ke ${tanggalWIB(f.scheduledDate)}${f.driverId ? "" : " tanpa driver"}. Riwayat gagal tetap tersimpan.`}
        confirmLabel="Jadwalkan" busy={busy} error={error} onCancel={() => setKonfirmasi(false)} onConfirm={kirim}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 18, gap: 14, paddingBottom: 32 },
  switch: { flexDirection: "row", alignItems: "center", gap: 10 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
});
