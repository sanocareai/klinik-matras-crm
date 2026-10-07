// Histori Waktu Route & Stop (7 Okt 2026) — padanan web:
// frontend/src/features/armada/components/RouteTimeline.jsx.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { api } from "../api";
import { useTheme } from "../hooks/useTheme";
import { ACTION_LABEL, TIDAK_TERSEDIA, formatTimelineEvent, formatDurasiSingkatID } from "../lib/routeTimelineFormat";

const JOB_STEP_ORDER = ["JOB_STARTED", "JOB_ARRIVED", "JOB_COMPLETED", "JOB_FAILED", "JOB_RESCHEDULED"];

function Baris({ action, event, styles, theme }) {
  const f = formatTimelineEvent(event);
  return (
    <View style={styles.baris}>
      <View style={[styles.titik, { backgroundColor: f ? theme.ACCENT : theme.INK3 + "66" }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.barisHead}>
          <Text style={styles.labelAksi}>{ACTION_LABEL[action] || action}</Text>
          <Text style={[styles.waktu, !f && styles.waktuKosong]}>{f ? f.waktu : TIDAK_TERSEDIA}</Text>
        </View>
        {f && (f.actorName || f.sourceLabel) && (
          <Text style={styles.sub}>{[f.actorName, f.sourceLabel].filter(Boolean).join(" · ")}</Text>
        )}
        {f && f.catatan.length > 0 && (
          <View style={styles.catatanRow}>
            <AlertTriangle size={11} color={theme.ORANGE} />
            <Text style={styles.catatan}>{f.catatan.join("; ")}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function JobTimeline({ job, styles, theme }) {
  const byAction = new Map(job.events.map((e) => [e.action, e]));
  const steps = JOB_STEP_ORDER
    .filter((a) => a !== "JOB_FAILED" || byAction.has("JOB_FAILED"))
    .filter((a) => a !== "JOB_COMPLETED" || !byAction.has("JOB_FAILED"))
    .filter((a) => a !== "JOB_RESCHEDULED" || byAction.has("JOB_RESCHEDULED"));
  return (
    <View style={styles.jobCard}>
      <Text style={styles.jobTitle}>
        Stop {job.sequence ?? "—"} · {job.customerName || "—"}
        {job.orderNumber ? ` (${job.orderNumber})` : ""}
      </Text>
      {steps.map((action) => (
        <Baris key={action} action={action} event={byAction.get(action) || null} styles={styles} theme={theme} />
      ))}
      <View style={styles.durasiRow}>
        <Text style={styles.durasi}>Tempuh: {job.travelMs != null ? formatDurasiSingkatID(job.travelMs) : TIDAK_TERSEDIA}</Text>
        <Text style={styles.durasi}>Layanan: {job.serviceMs != null ? formatDurasiSingkatID(job.serviceMs) : TIDAK_TERSEDIA}</Text>
      </View>
    </View>
  );
}

export default function RouteTimeline({ routeId }) {
  const theme = useTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    api.getRouteTimeline(routeId)
      .then((res) => { if (mounted) setData(res); })
      .catch((e) => { if (mounted) setErr(e.message || "Gagal memuat histori waktu"); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [routeId]);

  if (loading) return <ActivityIndicator style={{ marginVertical: 10 }} color={theme.ACCENT} />;
  if (err) return <Text style={styles.catatan}>{err}</Text>;
  if (!data) return null;

  const berangkat = data.routeEvents.find((e) => e.action === "ROUTE_STARTED") || null;
  const selesaiRute = data.routeEvents.find((e) => e.action === "ROUTE_COMPLETED") || null;

  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.jobCard}>
        <Baris action="ROUTE_STARTED" event={berangkat} styles={styles} theme={theme} />
        <Baris action="ROUTE_COMPLETED" event={selesaiRute} styles={styles} theme={theme} />
      </View>
      {data.jobs.map((job) => <JobTimeline key={job.jobId} job={job} styles={styles} theme={theme} />)}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    jobCard: { backgroundColor: t.SURFACE, borderRadius: 12, padding: 10, marginTop: 8, borderWidth: 1, borderColor: t.BORDER },
    jobTitle: { fontSize: 12, fontWeight: "700", color: t.INK, marginBottom: 4 },
    baris: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 4, gap: 7 },
    titik: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
    barisHead: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "baseline" },
    labelAksi: { fontSize: 11.5, fontWeight: "700", color: t.INK },
    waktu: { fontSize: 11, color: t.INK2 },
    waktuKosong: { fontStyle: "italic", color: t.INK3 },
    sub: { fontSize: 10, color: t.INK3 },
    catatanRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 },
    catatan: { fontSize: 10, color: t.ORANGE, flex: 1 },
    durasiRow: { flexDirection: "row", gap: 14, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: t.BORDER },
    durasi: { fontSize: 10, color: t.INK3 },
  });
}
