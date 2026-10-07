// Histori Waktu rute & stop (fase 2, 7 Okt 2026) — dibuka dari RouteStartCard. Isi (label Indonesia, waktu WIB, durasi) disusun SERVER dari ledger eksekusi yang
// sudah ada; layar ini hanya menampilkannya. Tonggak tanpa bukti waktu tampil "Tidak tersedia" — tidak dikarang/di-backfill. Dibaca dari server (bukan cache) agar
// aksi yang masih mengantre offline tidak tampil seolah sudah tercatat.
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeft, RefreshCw } from "lucide-react-native";
import { api } from "../api";
import { useTheme } from "../hooks/useTheme";
import { durationLine, stopRows } from "../lib/timelineView";

function Row({ row, styles, theme }) {
  const tone = (t) => (t === "danger" ? theme.RED : t === "warn" ? theme.ORANGE : theme.ACCENT);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{row.label}</Text>
      <Text style={[styles.rowTime, row.missing && styles.rowMissing]}>{row.atText}</Text>
      {row.meta ? <Text style={styles.meta}>{row.meta}</Text> : null}
      {row.receivedText ? <Text style={styles.meta}>{row.receivedText}</Text> : null}
      {row.detail ? <Text style={styles.meta}>Alasan: {row.detail}</Text> : null}
      {row.badges.length > 0 && (
        <View style={styles.badges}>
          {row.badges.map((b) => <Text key={b.key} style={[styles.badge, { color: tone(b.tone), borderColor: tone(b.tone) }]}>{b.label}</Text>)}
        </View>
      )}
      {row.corrections.map((c) => <Text key={c} style={styles.meta}>{c}</Text>)}
    </View>
  );
}

export default function HistoriWaktuScreen({ route, navigation }) {
  const { routeId, routeCode } = route.params;
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try { setData(await api.getRouteTimeline(routeId)); } catch (e) { setErr(e.message || "Gagal memuat histori waktu"); } finally { setLoading(false); }
  }, [routeId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const routeRows = data ? stopRows({ events: data.routeEvents, missing: data.routeMissing }) : [];
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Kembali"><ArrowLeft size={18} color={theme.INK} /></Pressable>
        <Text style={styles.headerTitle}>Histori Waktu</Text>
        <Pressable onPress={() => { setLoading(true); load(); }} hitSlop={10} accessibilityLabel="Muat ulang"><RefreshCw size={16} color={theme.INK2} /></Pressable>
      </View>
      <Text style={styles.sub}>Rute {routeCode || data?.route?.code || ""} · waktu dalam WIB</Text>
      {loading ? <View style={styles.center}><ActivityIndicator color={theme.ACCENT} /></View> : err ? (
        <View style={styles.center}><Text style={styles.err}>{err}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rute</Text>
            {routeRows.length === 0 ? <Text style={styles.meta}>Rute belum berangkat.</Text> : routeRows.map((r) => <Row key={r.key} row={r} styles={styles} theme={theme} />)}
            {data.routeDurationText ? <Text style={styles.duration}>Durasi rute: {data.routeDurationText}</Text> : data.routeDurationNote ? <Text style={styles.meta}>{data.routeDurationNote}</Text> : null}
          </View>
          {data.stops.map((s) => {
            const rows = stopRows(s); const dur = durationLine(s);
            return (
              <View key={s.jobId} style={styles.card}>
                <Text style={styles.cardTitle}>Stop {s.sequence ?? "—"} · {s.type === "PICKUP" ? "Pengambilan" : s.type === "DELIVERY" ? "Pengiriman" : "—"}{s.orderNumber ? ` · ${s.orderNumber}` : ""}</Text>
                {s.customerName ? <Text style={styles.meta}>{s.customerName}</Text> : null}
                {rows.length === 0 ? <Text style={styles.meta}>Belum ada aktivitas.</Text> : rows.map((r) => <Row key={r.key} row={r} styles={styles} theme={theme} />)}
                {dur ? <Text style={styles.duration}>{dur}</Text> : null}
              </View>
            );
          })}
          <Text style={styles.foot}>{data.note}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.BG },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },
    headerTitle: { fontSize: 16, fontWeight: "800", color: theme.INK },
    sub: { fontSize: 12, color: theme.INK2, paddingHorizontal: 14, marginBottom: 6 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    err: { color: theme.RED, textAlign: "center" },
    scroll: { padding: 14, gap: 10 },
    card: { backgroundColor: theme.SURFACE, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.BORDER },
    cardTitle: { fontSize: 13, fontWeight: "800", color: theme.INK, marginBottom: 4 },
    row: { paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.BORDER },
    rowLabel: { fontSize: 13, fontWeight: "700", color: theme.INK },
    rowTime: { fontSize: 12, color: theme.INK2 },
    rowMissing: { fontStyle: "italic", color: theme.INK3 },
    meta: { fontSize: 11, color: theme.INK3, marginTop: 1 },
    badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 3 },
    badge: { fontSize: 10, fontWeight: "700", borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
    duration: { fontSize: 12, color: theme.INK2, marginTop: 6 },
    foot: { fontSize: 11, color: theme.INK3, marginTop: 4 },
  });
}
