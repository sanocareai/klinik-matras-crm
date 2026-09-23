// Performa Saya (18 September 2026, permintaan owner lewat AskUserQuestion:
// "Ya, tambahkan") — driver lihat insentif/alamat selesai MILIK SENDIRI.
// Sebelumnya cuma dispatcher/admin (JOB_READ) yang bisa lihat lewat
// AdminHomeScreen tab Performa; driver sendiri tidak pernah tahu berapa
// insentif yang sudah dikumpulkan. Endpoint SAMA (GET /armada/incentive-
// summary, lihat useIncentiveSummary.js) — backend SEKARANG menerima
// JOB_OWN_READ juga dan otomatis membatasi respons ke baris driver ini
// sendiri (lihat catatan panjang di backend/src/routes/armada.js), jadi
// layar ini TIDAK perlu filter apa pun sendiri, cukum pakai `orang[0]`.
//
// UI diadaptasi dari PerformaView (AdminHomeScreen.js) tapi disederhanakan:
// tidak ada ranking/daftar banyak orang (server cuma pernah kirim <=1
// baris), jadi ikon Award/urutan dihapus — cukup 1 kartu ringkasan + daftar
// alamat yang bisa expand (pola "tap utk buka detail" tetap dipertahankan,
// data-nya sudah ikut respons, sama seperti versi admin).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../hooks/useTheme";
import { useIncentiveSummary } from "../hooks/useIncentiveSummary";
import { formatRupiah } from "../lib/jobHelpers";

const PERIODE_PRESET = [
  { key: "bulan-ini", label: "Bulan Ini" },
  { key: "minggu-ini", label: "Minggu Ini" },
  { key: "bulan-lalu", label: "Bulan Lalu" },
];

// Sama persis dgn rentangPeriode() di AdminHomeScreen.js — duplikasi kecil
// yang disengaja (file terpisah, layar admin vs driver tidak saling
// bergantung), bukan bug.
function rentangPeriode(preset) {
  const now = new Date(Date.now() + 7 * 3600_000); // WIB
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const toISO = (d) => d.toISOString().slice(0, 10);
  if (preset === "minggu-ini") {
    const dow = now.getUTCDay() || 7; // Senin=1..Minggu=7
    const senin = new Date(Date.UTC(y, m, now.getUTCDate() - dow + 1));
    return { from: toISO(senin), to: toISO(now) };
  }
  if (preset === "bulan-lalu") {
    const awal = new Date(Date.UTC(y, m - 1, 1));
    const akhir = new Date(Date.UTC(y, m, 0));
    return { from: toISO(awal), to: toISO(akhir) };
  }
  const awal = new Date(Date.UTC(y, m, 1));
  return { from: toISO(awal), to: toISO(now) };
}

export default function PerformaScreen({ navigation }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [periode, setPeriode] = useState("bulan-ini");
  const { from, to } = rentangPeriode(periode);
  const { data, isLoading, error, refetch, isRefetching } = useIncentiveSummary(from, to);
  const [expanded, setExpanded] = useState(false);
  const me = data?.orang?.[0] || null;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Performa Saya</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={theme.ACCENT} />}
      >
        <View style={styles.periodeRow}>
          {PERIODE_PRESET.map((p) => (
            <Pressable
              key={p.key}
              style={[styles.periodeChip, periode === p.key && styles.periodeChipActive]}
              onPress={() => setPeriode(p.key)}
            >
              <Text style={[styles.periodeChipText, periode === p.key && styles.periodeChipTextActive]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        {isLoading ? (
          <View style={styles.center}><ActivityIndicator color={theme.ACCENT} /></View>
        ) : error ? (
          <View style={styles.center}><Text style={styles.errorText}>Gagal memuat: {error.message}</Text></View>
        ) : !me ? (
          <Text style={styles.emptyText}>Belum ada alamat selesai di periode ini.</Text>
        ) : (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={[styles.simBadge, { backgroundColor: me.hasSim ? theme.GREEN + "26" : theme.INK3 + "26" }]}>
                <Text style={[styles.simBadgeText, { color: me.hasSim ? theme.GREEN : theme.INK3 }]}>
                  {me.hasSim ? "SIM" : "Tanpa SIM"}
                </Text>
              </View>
              <Text style={styles.kpiValue}>{me.totalAlamat} <Text style={styles.cardMeta}>alamat</Text></Text>
            </View>
            <View style={styles.driverStatsRow}>
              <Text style={styles.driverStat}>Sebagai driver: <Text style={{ color: theme.ACCENT }}>{me.asDriver}</Text></Text>
              <Text style={styles.driverStat}>Sebagai helper: <Text style={{ color: theme.ACCENT }}>{me.asHelper}</Text></Text>
            </View>
            {/* Label "Estimasi Insentif" + catatan bisa berubah (audit
                insentif, 23 September 2026) — angka ini live recompute
                dari data SEKARANG (lihat catatan panjang di backend
                GET /armada/incentive-summary): bisa berubah kalau admin
                mengoreksi POD job lampau atau status SIM berubah, dan
                BUKAN status "sudah dibayar" — sistem ini tidak melacak
                pembayaran sama sekali, murni estimasi hitung-hitungan. */}
            <Text style={styles.estimasiLabel}>Estimasi Insentif</Text>
            <Text style={styles.totalInsentif}>
              {formatRupiah(me.totalInsentif)} <Text style={{ color: theme.INK3, fontWeight: "600" }}>({formatRupiah(me.ratePerAlamat)}/alamat)</Text>
            </Text>
            <Text style={styles.disclaimerText}>
              Estimasi berdasarkan data terbaru — bisa berubah, bukan status sudah/akan dibayar.
            </Text>

            <Pressable style={styles.detailToggle} onPress={() => setExpanded((v) => !v)}>
              <Text style={styles.detailToggleText}>{expanded ? "Sembunyikan detail" : "Lihat detail alamat"}</Text>
            </Pressable>

            {expanded && (
              <View style={{ marginTop: 4, gap: 6, width: "100%" }}>
                {(me.detail || []).length === 0 ? (
                  <Text style={styles.cardMeta}>Tidak ada data.</Text>
                ) : (
                  me.detail.map((d) => (
                    <View key={`${d.orderId}-${d.date}`} style={styles.detailRow}>
                      <View style={styles.rowBetween}>
                        <Text style={[styles.cardMeta, { fontWeight: "700", color: theme.INK }]}>{d.orderNumber}</Text>
                        <Text style={styles.cardMeta}>{new Date(d.date).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</Text>
                      </View>
                      <Text style={[styles.cardMeta, { color: theme.INK, marginTop: 2 }]}>{d.customerName}</Text>
                      <Text style={styles.cardMeta} numberOfLines={2}>{d.addressText}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.NAVY },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.BORDER,
    },
    backBtn: { paddingHorizontal: 8, width: 40 },
    backIcon: { color: t.INK, fontSize: 30, lineHeight: 32 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: t.INK },
    scrollContent: { padding: 16, paddingBottom: 40 },
    periodeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
    periodeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1, borderColor: t.BORDER },
    periodeChipActive: { backgroundColor: t.ACCENT_BG, borderColor: t.ACCENT },
    periodeChipText: { color: t.INK2, fontSize: 12, fontWeight: "600" },
    periodeChipTextActive: { color: t.ACCENT },
    center: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    errorText: { color: t.RED, fontSize: 13, textAlign: "center" },
    emptyText: { color: t.INK2, fontSize: 13, textAlign: "center", marginTop: 24 },
    card: {
      backgroundColor: t.SURFACE, borderRadius: 14, padding: 14, alignItems: "flex-start",
      borderWidth: 1, borderColor: t.BORDER,
    },
    rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
    kpiValue: { color: t.INK, fontSize: 18, fontWeight: "800" },
    cardMeta: { color: t.INK2, fontSize: 11, marginTop: 1 },
    simBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
    simBadgeText: { fontSize: 10, fontWeight: "700" },
    driverStatsRow: { flexDirection: "row", gap: 14, marginTop: 10 },
    driverStat: { color: t.INK2, fontSize: 12, fontWeight: "600" },
    estimasiLabel: { marginTop: 10, fontSize: 10, fontWeight: "700", color: t.INK3, textTransform: "uppercase", letterSpacing: 0.4 },
    totalInsentif: { marginTop: 2, fontSize: 15, fontWeight: "700", color: t.ACCENT },
    disclaimerText: { marginTop: 4, fontSize: 10.5, color: t.INK3, lineHeight: 14 },
    detailToggle: { marginTop: 12, alignSelf: "stretch", alignItems: "center", paddingVertical: 8 },
    detailToggleText: { color: t.ACCENT, fontSize: 12.5, fontWeight: "700" },
    detailRow: { backgroundColor: t.TRACK_BG, borderRadius: 10, padding: 8 },
  });
}
