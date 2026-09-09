// Port dari JobCard di frontend/src/pages/DriverJobs.jsx — state machine
// SAMA PERSIS (idle→starting/arriving→completing/failing), foto WAJIB tiap
// tahap (FR-D-07 "tanpa kecuali" utk foto kegagalan, ditegakkan backend —
// UI di sini cuma mencerminkan itu, bukan sumber kebenaran validasinya).
// TTD penerima SENGAJA TIDAK ada (keputusan owner eksplisit, sama dengan
// web — lihat catatan panjang di DriverJobs.jsx). Pencatatan pembayaran
// TIDAK ada di v1 RN ini (menyusul kalau dibutuhkan — bukan bagian syarat
// keras milestone ini).
import React, { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, Linking, Alert } from "react-native";
import { MapPin, Phone, Loader2 } from "lucide-react-native";
import PhotoCapture from "./PhotoCapture";
import { performSubmit } from "../lib/submitJobAction";
import { customerOf, customerPhoneOf, orderNumberOf, jobLabelOf, mapsUrl, estJamUntukTampilan, JOB_STATUS_REAL } from "../lib/jobHelpers";

const NAVY_SURFACE = "#171B2E";
const INK = "#F5F5F7";
const INK2 = "rgba(245,245,247,0.62)";
const INK3 = "rgba(245,245,247,0.40)";
const ACCENT = "#4C8DFF";
const GREEN = "#30D158";
const RED = "#FF453A";
const ORANGE = "#FF9F0A";

const FAIL_REASONS_PICKUP = [
  { value: "Customer tidak ada di rumah", label: "Customer Tidak Ada" },
  { value: "Akses ditolak", label: "Akses Ditolak" },
  { value: "Customer menolak", label: "Customer Menolak" },
];
const FAIL_REASONS_DELIVERY = [
  { value: "Customer tidak ada di rumah", label: "Customer Tidak Ada" },
  { value: "Akses ditolak", label: "Akses Ditolak" },
  { value: "Customer minta reschedule", label: "Minta Reschedule" },
];

const STATUS_TONE = {
  ASSIGNED: ACCENT, EN_ROUTE: ACCENT, ARRIVED: ACCENT,
  COMPLETED: GREEN, FAILED: RED, SCHEDULED: INK3, UNSCHEDULED: INK3, RESCHEDULED: ORANGE,
};

export default function JobCard({ job, onChanged }) {
  const [mode, setMode] = useState("idle"); // idle | starting | arriving | completing | failing
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const nama = customerOf(job) || "Tanpa nama";
  const phone = customerPhoneOf(job);
  const maps = mapsUrl(job);
  const estJam = estJamUntukTampilan(job.timeWindow);
  const failReasons = job.type === "PICKUP" ? FAIL_REASONS_PICKUP : FAIL_REASONS_DELIVERY;
  const statusInfo = JOB_STATUS_REAL[job.status] || { label: job.status };

  function resetForm() {
    setMode("idle");
    setPhotos([]);
    setNote("");
    setFailReason("");
    setErr("");
  }

  async function run(action, payload) {
    setBusy(true);
    setErr("");
    try {
      await performSubmit(job.id, action, payload, photos);
      resetForm();
      onChanged();
    } catch (e) {
      setErr(e.message || "Gagal mengirim");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.customerName}>{nama}</Text>
          <Text style={styles.jobMeta}>
            {jobLabelOf(job)} · {orderNumberOf(job) || "—"} · {job.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: (STATUS_TONE[job.status] || INK3) + "26" }]}>
          <Text style={[styles.statusBadgeText, { color: STATUS_TONE[job.status] || INK2 }]}>{statusInfo.label}</Text>
        </View>
      </View>

      {estJam && <Text style={styles.detailLine}>🕗 {estJam}</Text>}
      {job.addressText ? <Text style={styles.detailLine} numberOfLines={2}>📍 {job.addressText}</Text> : null}

      <View style={styles.quickActions}>
        {maps && (
          <Pressable style={styles.quickBtn} onPress={() => Linking.openURL(maps)}>
            <MapPin size={13} color={ACCENT} />
            <Text style={styles.quickBtnText}>Peta</Text>
          </Pressable>
        )}
        {phone && (
          <Pressable style={styles.quickBtn} onPress={() => Linking.openURL(`tel:${phone}`)}>
            <Phone size={13} color={ACCENT} />
            <Text style={styles.quickBtnText}>Telepon</Text>
          </Pressable>
        )}
      </View>

      {err ? <Text style={styles.error}>{err}</Text> : null}

      {mode === "idle" && job.status === "ASSIGNED" && (
        <Pressable style={styles.primaryBtn} onPress={() => setMode("starting")}>
          <Text style={styles.primaryBtnText}>Mulai</Text>
        </Pressable>
      )}

      {mode === "idle" && job.status === "EN_ROUTE" && (
        <View style={styles.btnRow}>
          <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setMode("failing")}>
            <Text style={styles.secondaryBtnText}>Gagal</Text>
          </Pressable>
          <Pressable style={[styles.primaryBtn, { flex: 1.4 }]} onPress={() => setMode("arriving")}>
            <Text style={styles.primaryBtnText}>Tiba</Text>
          </Pressable>
        </View>
      )}

      {mode === "idle" && job.status === "ARRIVED" && (
        <View style={styles.btnRow}>
          <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setMode("failing")}>
            <Text style={styles.secondaryBtnText}>Gagal</Text>
          </Pressable>
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={() => setMode("completing")}>
            <Text style={styles.primaryBtnText}>Selesai</Text>
          </Pressable>
        </View>
      )}

      {(mode === "starting" || mode === "arriving") && (
        <View style={styles.form}>
          <PhotoCapture photos={photos} onChange={setPhotos} label="Foto bukti (wajib)" />
          <View style={styles.btnRow}>
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={resetForm} disabled={busy}>
              <Text style={styles.secondaryBtnText}>Batal</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, { flex: 1.4 }, (busy || photos.length === 0) && styles.disabled]}
              disabled={busy || photos.length === 0}
              onPress={() => run(mode === "starting" ? "start" : "arrive", {})}
            >
              {busy ? <Loader2 size={14} color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Kirim</Text>}
            </Pressable>
          </View>
        </View>
      )}

      {mode === "completing" && (
        <View style={styles.form}>
          <PhotoCapture photos={photos} onChange={setPhotos} label="Foto bukti (wajib)" />
          <TextInput
            style={styles.noteInput}
            placeholder="Catatan (opsional)"
            placeholderTextColor={INK3}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <View style={styles.btnRow}>
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={resetForm} disabled={busy}>
              <Text style={styles.secondaryBtnText}>Batal</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, { flex: 1.4 }, (busy || photos.length === 0) && styles.disabled]}
              disabled={busy || photos.length === 0}
              onPress={() => run("complete", { note })}
            >
              {busy ? <Loader2 size={14} color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Tandai Selesai</Text>}
            </Pressable>
          </View>
        </View>
      )}

      {mode === "failing" && (
        <View style={styles.form}>
          <Text style={styles.label}>Alasan gagal (wajib)</Text>
          <View style={styles.reasonRow}>
            {failReasons.map((r) => (
              <Pressable
                key={r.value}
                style={[styles.reasonChip, failReason === r.value && styles.reasonChipActive]}
                onPress={() => setFailReason(r.value)}
              >
                <Text style={[styles.reasonChipText, failReason === r.value && styles.reasonChipTextActive]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <PhotoCapture photos={photos} onChange={setPhotos} label="Foto bukti (wajib, tanpa kecuali)" />
          <TextInput
            style={styles.noteInput}
            placeholder="Catatan (opsional)"
            placeholderTextColor={INK3}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <View style={styles.btnRow}>
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={resetForm} disabled={busy}>
              <Text style={styles.secondaryBtnText}>Batal</Text>
            </Pressable>
            <Pressable
              style={[styles.dangerBtn, { flex: 1.4 }, (busy || photos.length === 0 || !failReason) && styles.disabled]}
              disabled={busy || photos.length === 0 || !failReason}
              onPress={() => run("fail", { failureReason: failReason, note })}
            >
              {busy ? <Loader2 size={14} color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Tandai Gagal</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: NAVY_SURFACE, borderRadius: 16, padding: 14, marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "flex-start" },
  customerName: { color: INK, fontSize: 15, fontWeight: "700" },
  jobMeta: { color: INK2, fontSize: 11, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100 },
  statusBadgeText: { fontSize: 10.5, fontWeight: "700" },
  detailLine: { color: INK2, fontSize: 12, marginTop: 6 },
  quickActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  quickBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(76,141,255,0.12)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  quickBtnText: { color: ACCENT, fontSize: 11.5, fontWeight: "600" },
  error: { color: RED, fontSize: 12, marginTop: 10 },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13.5 },
  secondaryBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
  secondaryBtnText: { color: INK2, fontWeight: "600", fontSize: 13.5 },
  dangerBtn: { backgroundColor: RED, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
  disabled: { opacity: 0.4 },
  btnRow: { flexDirection: "row", gap: 8 },
  form: { marginTop: 12, gap: 10 },
  label: { fontSize: 10.5, fontWeight: "700", color: INK2, textTransform: "uppercase", letterSpacing: 0.4 },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  reasonChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 100, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  reasonChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  reasonChipText: { color: INK2, fontSize: 11.5, fontWeight: "600" },
  reasonChipTextActive: { color: "#FFFFFF" },
  noteInput: {
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 10,
    color: INK, fontSize: 13, minHeight: 60, textAlignVertical: "top",
  },
});
