import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { STAGES, statusInfo } from "@sano/delivery-shared";
import { biayaArmadaApi } from "../client";
import { useSession } from "../SessionContext";
import { toneColors, useTheme } from "../theme";

const STAGE_LABEL = { DRAF: "Draf", DIAJUKAN: "Diajukan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DITOLAK: "Ditolak" };
const rupiah = (n) => "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");

export default function BiayaArmadaScreen({ navigation }) {
  const t = useTheme();
  const { abilities } = useSession();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [stage, setStage] = useState("DIAJUKAN");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await biayaArmadaApi.list();
      setRows(r.submissions || []);
    } catch (e) { setError(e.message); setRows((prev) => prev || []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((k) => [k, 0]));
    for (const r of rows || []) { const k = statusInfo(r.status).stage; if (k in c) c[k]++; }
    return c;
  }, [rows]);
  const shown = useMemo(() => (rows || []).filter((r) => statusInfo(r.status).stage === stage), [rows, stage]);

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <View style={s.tabs}>
        {STAGES.map((k) => (
          <Pressable key={k} onPress={() => setStage(k)} style={[s.tab, { backgroundColor: stage === k ? t.accentBg : t.field }]}>
            <Text style={{ color: stage === k ? t.accent : t.ink2, fontWeight: "700", fontSize: 12 }}>{STAGE_LABEL[k]} {counts[k]}</Text>
          </Pressable>
        ))}
      </View>
      {!!error && <View style={[s.err, { backgroundColor: t.redBg }]}><Text style={{ color: t.red, fontSize: 13 }}>{error}</Text></View>}
      {!abilities.submit && !abilities.approve && !abilities.pay && !abilities.verify && (
        <Text style={{ color: t.ink3, fontSize: 12, paddingHorizontal: 16 }}>Akun ini hanya bisa melihat biaya armada.</Text>
      )}
      {rows === null ? <ActivityIndicator style={{ marginTop: 40 }} color={t.accent} /> : (
        <FlatList
          data={shown}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={<Text style={{ color: t.ink3, textAlign: "center", marginTop: 40 }}>Belum ada pengajuan di tahap ini.</Text>}
          renderItem={({ item }) => {
            const info = statusInfo(item.status);
            const c = toneColors(t, info.tone);
            return (
              <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{item.submissionNumber}</Text>
                  <View style={[s.chip, { backgroundColor: c.bg }]}><Text style={{ color: c.fg, fontSize: 11, fontWeight: "700" }}>{info.label}</Text></View>
                </View>
                <Text style={[s.amount, { color: t.ink }]}>{rupiah(item.amount)}</Text>
                <Text style={{ color: t.ink2, fontSize: 13 }}>{item.expenseType} · {String(item.date).slice(0, 10)}{item.vehiclePlateSnapshot ? ` · ${item.vehiclePlateSnapshot}` : ""}</Text>
                {!!item.description && <Text style={{ color: t.ink3, fontSize: 12 }} numberOfLines={2}>{item.description}</Text>}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 16, paddingBottom: 8 },
  tab: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  list: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  amount: { fontSize: 20, fontWeight: "800" },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  err: { borderRadius: 10, padding: 12, marginHorizontal: 16 },
});
