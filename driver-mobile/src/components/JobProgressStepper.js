// Stepper progress job (12 Sep 2026, fase 3 redesign UI — referensi
// DelTrack: progress bar bertitik Ditugaskan→Menuju→Tiba→Selesai). Murni
// tampilan, status sumber kebenaran TETAP job.status dari backend (sama
// seperti badge status yang sudah ada di JobCard) — stepper ini cuma
// representasi visual tambahan dari status yang sama, bukan state baru.
// FAILED sengaja TIDAK dipetakan ke salah satu titik (kita tidak tahu
// pasti sampai tahap mana sebelum gagal) — tampil sebagai baris merah
// terpisah supaya tidak mengarang progress palsu.
import React from "react";
import { View, Text, StyleSheet } from "react-native";

const STEPS = [
  { key: "ASSIGNED", label: "Ditugaskan" },
  { key: "EN_ROUTE", label: "Menuju" },
  { key: "ARRIVED", label: "Tiba" },
  { key: "COMPLETED", label: "Selesai" },
];

export default function JobProgressStepper({ status, theme: t }) {
  if (status === "FAILED") {
    return (
      <View style={[styles.failRow, { backgroundColor: t.RED + "14" }]}>
        <Text style={[styles.failText, { color: t.RED }]}>✕ Job ini ditandai gagal</Text>
      </View>
    );
  }

  const activeIdx = STEPS.findIndex((s) => s.key === status); // -1 = belum ditugaskan (SCHEDULED/dst)

  return (
    <View style={styles.row}>
      {STEPS.map((s, i) => {
        const reached = i <= activeIdx;
        const isLast = i === STEPS.length - 1;
        return (
          <React.Fragment key={s.key}>
            <View style={styles.stepCol}>
              <View style={[styles.dot, { backgroundColor: reached ? t.ACCENT : t.TRACK_BG, borderColor: reached ? t.ACCENT : t.BORDER }]} />
              <Text style={[styles.stepLabel, { color: reached ? t.INK : t.INK3 }]} numberOfLines={1}>{s.label}</Text>
            </View>
            {!isLast && <View style={[styles.line, { backgroundColor: i < activeIdx ? t.ACCENT : t.BORDER }]} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", marginTop: 10 },
  stepCol: { alignItems: "center", width: 48 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, marginTop: 3 },
  stepLabel: { fontSize: 9, fontWeight: "700", marginTop: 4, textAlign: "center" },
  line: { flex: 1, height: 2, marginTop: 8 },
  failRow: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 10 },
  failText: { fontSize: 11.5, fontWeight: "700" },
});
