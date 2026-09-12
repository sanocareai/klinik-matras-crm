// Port dari JobCard di frontend/src/pages/DriverJobs.jsx — state machine
// SAMA PERSIS (idle→completing/failing, mulai/tiba 1 ketuk tanpa foto sejak
// 10 Sep 2026), foto WAJIB tiap tahap yang masih butuh (FR-D-07 "tanpa
// kecuali" utk foto kegagalan, ditegakkan backend — UI di sini cuma
// mencerminkan itu, bukan sumber kebenaran validasinya). TTD penerima
// SENGAJA TIDAK ada (keputusan owner eksplisit, sama dengan web). Light/
// dark ikut sistem HP (lihat src/theme.js).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, Linking } from "react-native";
import { MapPin, Phone, Loader2 } from "lucide-react-native";
import PhotoCapture from "./PhotoCapture";
import PaymentSection from "./PaymentSection";
import JobProgressStepper from "./JobProgressStepper";
import { performSubmit } from "../lib/submitJobAction";
import { customerOf, customerPhoneOf, orderNumberOf, jobLabelOf, mapsUrl, estJamUntukTampilan, JOB_STATUS_REAL, COMPLAINT_CATEGORY_LABEL } from "../lib/jobHelpers";
import { useTheme } from "../hooks/useTheme";
import { useAuth } from "../context/AuthContext";

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

export default function JobCard({ job, onChanged }) {
  const theme = useTheme();
  const { markOnlineLocally } = useAuth();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const STATUS_TONE = useMemo(() => ({
    ASSIGNED: theme.ACCENT, EN_ROUTE: theme.ACCENT, ARRIVED: theme.ACCENT,
    COMPLETED: theme.GREEN, FAILED: theme.RED, SCHEDULED: theme.INK3, UNSCHEDULED: theme.INK3, RESCHEDULED: theme.ORANGE,
  }), [theme]);

  const [mode, setMode] = useState("idle"); // idle | completing | failing
  const [photos, setPhotos] = useState([]);
  const [note, setNote] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // FlashList me-RECYCLE instance komponen ini — tanpa reset, form yang
  // sedang terbuka (mode "completing" + foto) bisa "nempel" ke job LAIN saat
  // cell dipakai ulang, dan tombol "Tandai Selesai" jadi aktif untuk job
  // yang salah (bug 10 Sep 2026: job ke-complete padahal foto belum diambil
  // di kartu itu). Pola resmi React "adjusting state when a prop changes".
  const [prevJobId, setPrevJobId] = useState(job.id);
  if (job.id !== prevJobId) {
    setPrevJobId(job.id);
    setMode("idle");
    setPhotos([]);
    setNote("");
    setFailReason("");
    setBusy(false);
    setErr("");
  }

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
      // Sinkron lokal (12 Sep 2026) — backend auto-online-kan driver saat
      // job dimulai (POST /jobs/:id/start), refleksikan efek samping itu
      // di switch Beranda TANPA driver perlu toggle manual juga.
      if (action === "start") markOnlineLocally();
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
        <View style={[styles.statusBadge, { backgroundColor: (STATUS_TONE[job.status] || theme.INK3) + "26" }]}>
          <Text style={[styles.statusBadgeText, { color: STATUS_TONE[job.status] || theme.INK2 }]}>{statusInfo.label}</Text>
        </View>
      </View>

      {/* Complaint / After-Sales Case (D-116, 12 September 2026 —
          permintaan owner: driver perlu tahu kalau job ini berasal dari
          kasus komplain, supaya lebih hati-hati/sopan di lokasi). Job.
          complaintCase SUDAH ikut GET /armada/my-jobs sejak jobInclude
          diperluas — nol perubahan backend, murni tampilan di sini. */}
      {job.complaintCase && (
        <View style={styles.complaintBanner}>
          <Text style={styles.complaintBannerText}>
            🚩 Job dari Kasus Komplain {job.complaintCase.caseNumber} — {COMPLAINT_CATEGORY_LABEL[job.complaintCase.category] || job.complaintCase.category}
          </Text>
        </View>
      )}

      <JobProgressStepper status={job.status} theme={theme} />

      {estJam && <Text style={styles.detailLine}>🕗 {estJam}</Text>}
      {job.addressText ? <Text style={styles.detailLine} numberOfLines={2}>📍 {job.addressText}</Text> : null}

      <View style={styles.quickActions}>
        {maps && (
          <Pressable style={styles.quickBtn} onPress={() => Linking.openURL(maps)}>
            <MapPin size={13} color={theme.ACCENT} />
            <Text style={styles.quickBtnText}>Peta</Text>
          </Pressable>
        )}
        {phone && (
          <Pressable style={styles.quickBtn} onPress={() => Linking.openURL(`tel:${phone}`)}>
            <Phone size={13} color={theme.ACCENT} />
            <Text style={styles.quickBtnText}>Telepon</Text>
          </Pressable>
        )}
      </View>

      {err ? <Text style={styles.error}>{err}</Text> : null}

      {/* Mulai & Tiba = 1 ketuk, TANPA foto (10 Sep 2026, keputusan owner:
          dokumentasi cuma di "mulai perjalanan rute" & "serah terima
          berhasil"). "Mulai" per-job ini untuk job lepas / belum
          di-start lewat kartu rute. */}
      {mode === "idle" && job.status === "ASSIGNED" && (
        <Pressable
          style={[styles.primaryBtn, busy && styles.disabled]}
          disabled={busy}
          onPress={() => run("start", {})}
        >
          {busy ? <Loader2 size={14} color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Mulai Perjalanan</Text>}
        </Pressable>
      )}

      {mode === "idle" && job.status === "EN_ROUTE" && (
        <View style={styles.btnRow}>
          <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setMode("failing")} disabled={busy}>
            <Text style={styles.secondaryBtnText}>Gagal</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, { flex: 1.4 }, busy && styles.disabled]}
            disabled={busy}
            onPress={() => run("arrive", {})}
          >
            {busy ? <Loader2 size={14} color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Tiba di Lokasi</Text>}
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

      {mode === "completing" && (
        <View style={styles.form}>
          <PhotoCapture photos={photos} onChange={setPhotos} label="Foto bukti (wajib)" />
          <TextInput
            style={styles.noteInput}
            placeholder="Catatan (opsional)"
            placeholderTextColor={theme.INK3}
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
            placeholderTextColor={theme.INK3}
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

      {mode === "idle" && job.status === "COMPLETED" && job.type === "DELIVERY" && (
        <PaymentSection job={job} onChanged={onChanged} />
      )}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.SURFACE, borderRadius: 16, padding: 14, marginBottom: 12,
      shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
    },
    headerRow: { flexDirection: "row", alignItems: "flex-start" },
    customerName: { color: t.INK, fontSize: 15, fontWeight: "700" },
    jobMeta: { color: t.INK2, fontSize: 11, marginTop: 2 },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100 },
    statusBadgeText: { fontSize: 10.5, fontWeight: "700" },
    detailLine: { color: t.INK2, fontSize: 12, marginTop: 6 },
    complaintBanner: { backgroundColor: t.RED + "1A", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 8 },
    complaintBannerText: { color: t.RED, fontSize: 11.5, fontWeight: "700" },
    quickActions: { flexDirection: "row", gap: 8, marginTop: 10 },
    quickBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: t.ACCENT_BG, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
    quickBtnText: { color: t.ACCENT, fontSize: 11.5, fontWeight: "600" },
    error: { color: t.RED, fontSize: 12, marginTop: 10 },
    primaryBtn: { backgroundColor: t.ACCENT, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
    primaryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13.5 },
    secondaryBtn: { borderWidth: 1, borderColor: t.BORDER, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
    secondaryBtnText: { color: t.INK2, fontWeight: "600", fontSize: 13.5 },
    dangerBtn: { backgroundColor: t.RED, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginTop: 12 },
    disabled: { opacity: 0.4 },
    btnRow: { flexDirection: "row", gap: 8 },
    form: { marginTop: 12, gap: 10 },
    label: { fontSize: 10.5, fontWeight: "700", color: t.INK2, textTransform: "uppercase", letterSpacing: 0.4 },
    reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    reasonChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 100, borderWidth: 1, borderColor: t.BORDER },
    reasonChipActive: { backgroundColor: t.ACCENT, borderColor: t.ACCENT },
    reasonChipText: { color: t.INK2, fontSize: 11.5, fontWeight: "600" },
    reasonChipTextActive: { color: "#FFFFFF" },
    noteInput: {
      backgroundColor: t.FIELD_BG, borderRadius: 10, padding: 10,
      color: t.INK, fontSize: 13, minHeight: 60, textAlignVertical: "top",
    },
  });
}
