import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { STAGES, STAGE_LABEL, formatRupiah, statusInfo, statusesForStage } from "@sano/delivery-shared";
import { biayaArmadaApi } from "../client";
import { useSession } from "../SessionContext";
import { useDraftStore } from "../draftStore";
import { useTheme } from "../theme";
import { tanggalWIB } from "../format";
import { Box, Btn, Chip } from "../ui";

const PER_HALAMAN = 20;

export default function BiayaArmadaScreen({ navigation }) {
  const t = useTheme();
  const { abilities } = useSession();
  const store = useDraftStore();
  const [stage, setStage] = useState("DIAJUKAN");
  const [items, setItems] = useState([]);
  const [adaLagi, setAdaLagi] = useState(false);
  const [status, setStatus] = useState("memuat"); // memuat | siap | gagal
  const [error, setError] = useState("");
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lokal, setLokal] = useState([]);
  const [sinkron, setSinkron] = useState({ busy: false, pesan: "" });
  const permintaan = useRef(0);

  const muat = useCallback(async ({ tambah = false } = {}) => {
    const id = ++permintaan.current;
    if (!tambah) { setStatus("memuat"); setError(""); }
    else setMemuatLagi(true);
    try {
      const r = await biayaArmadaApi.list({
        status: statusesForStage(stage).join(","), limit: PER_HALAMAN, offset: tambah ? items.length : 0,
      });
      if (id !== permintaan.current) return;
      setItems((prev) => (tambah ? [...prev, ...r.submissions] : r.submissions));
      setAdaLagi(!!r.adaLagi);
      setStatus("siap");
    } catch (e) {
      if (id !== permintaan.current) return;
      setError(e.message || "Gagal memuat");
      if (!tambah) setStatus("gagal");
    } finally {
      if (id === permintaan.current) setMemuatLagi(false);
    }
  }, [stage, items.length]);

  useEffect(() => { muat(); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => navigation.addListener("focus", () => { muat(); bacaLokal(); }), [navigation, muat]); // eslint-disable-line react-hooks/exhaustive-deps

  const bacaLokal = useCallback(async () => { if (store) setLokal(await store.list()); }, [store]);
  useEffect(() => { bacaLokal(); }, [bacaLokal]);

  async function kirimLokal() {
    setSinkron({ busy: true, pesan: "" });
    try {
      const config = await biayaArmadaApi.config();
      const hasil = await store.sync(biayaArmadaApi, config);
      const ok = hasil.filter((h) => h.ok).length;
      const gagal = hasil.length - ok;
      setSinkron({ busy: false, pesan: gagal ? `${ok} terkirim, ${gagal} gagal — lihat pesan pada tiap draf.` : `${ok} draf terkirim.` });
    } catch (e) {
      setSinkron({ busy: false, pesan: e.message || "Gagal mengirim draf lokal" });
    }
    await bacaLokal();
    muat();
  }

  const belumSelesai = lokal.filter((d) => d.status !== "SELESAI");

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
          {STAGES.map((k) => (
            <Pressable key={k} onPress={() => setStage(k)} style={[s.tab, { backgroundColor: stage === k ? t.accentBg : t.field }]} accessibilityRole="tab">
              <Text style={{ color: stage === k ? t.accent : t.ink2, fontWeight: "700", fontSize: 13 }}>{STAGE_LABEL[k]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {belumSelesai.length > 0 && (
        <View style={[s.lokal, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Text style={{ color: t.ink, fontWeight: "700" }}>Draf lokal ({belumSelesai.length})</Text>
          <Text style={{ color: t.ink3, fontSize: 12 }}>Tersimpan di perangkat ini dan belum dikirim ke server.</Text>
          {belumSelesai.map((d) => (
            <View key={d.id} style={s.lokalRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 13 }} numberOfLines={1}>{d.draft.expenseType || "Biaya"} · {formatRupiah(d.draft.amount)} · {tanggalWIB(d.draft.date)}</Text>
                {!!d.lastError && <Text style={{ color: t.red, fontSize: 12 }}>{d.lastError}</Text>}
              </View>
              <Pressable onPress={async () => { await store.remove(d.id); bacaLokal(); }} accessibilityLabel="Hapus draf lokal"><Text style={{ color: t.red, fontWeight: "700", fontSize: 13 }}>Hapus</Text></Pressable>
            </View>
          ))}
          {!!sinkron.pesan && <Text style={{ color: t.ink2, fontSize: 12 }}>{sinkron.pesan}</Text>}
          <Btn title="Kirim draf lokal" onPress={kirimLokal} busy={sinkron.busy} />
        </View>
      )}

      {status === "memuat" ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={t.accent} />
      ) : status === "gagal" ? (
        <View style={{ padding: 16 }}>
          <Box action={<Btn title="Coba lagi" kind="ghost" onPress={() => muat()} />}>{error}</Box>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await muat(); setRefreshing(false); }} />}
          ListHeaderComponent={!!error ? <Box action={<Btn title="Coba lagi" kind="ghost" onPress={() => muat()} />}>{error}</Box> : null}
          ListEmptyComponent={<Text style={{ color: t.ink3, textAlign: "center", marginTop: 40 }}>Belum ada pengajuan di tahap {STAGE_LABEL[stage].toLowerCase()}.</Text>}
          ListFooterComponent={adaLagi ? <Btn title="Muat lebih banyak" kind="ghost" busy={memuatLagi} onPress={() => muat({ tambah: true })} style={{ marginTop: 6 }} /> : null}
          renderItem={({ item }) => {
            const info = statusInfo(item.status);
            return (
              <Pressable onPress={() => navigation.navigate("BiayaDetail", { id: item.id })} style={[s.card, { backgroundColor: t.surface, borderColor: t.border }]} accessibilityRole="button">
                <View style={s.cardTop}>
                  <Text style={{ color: t.ink2, fontSize: 12 }}>{item.submissionNumber}</Text>
                  <Chip label={info.label} tone={info.tone} />
                </View>
                <Text style={[s.amount, { color: t.ink }]}>{formatRupiah(item.amount)}</Text>
                <Text style={{ color: t.ink2, fontSize: 13 }}>
                  {item.expenseType} · {tanggalWIB(item.date)}{item.vehicleId && item.vehiclePlateSnapshot ? ` · ${item.vehiclePlateSnapshot}` : ""}
                </Text>
                {item.status === "PERLU_REVISI" && !!item.revisionReason && <Text style={{ color: t.orange, fontSize: 12 }} numberOfLines={2}>Revisi: {item.revisionReason}</Text>}
                {!!item.requestedBy?.name && <Text style={{ color: t.ink3, fontSize: 12 }}>Pemohon: {item.requestedBy.name}</Text>}
              </Pressable>
            );
          }}
        />
      )}

      {abilities.submit && (
        <View style={[s.footer, { backgroundColor: t.bg, borderColor: t.border }]}>
          <Btn title="Catat biaya baru" onPress={() => navigation.navigate("BiayaForm", {})} />
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  tabs: { gap: 8, padding: 16, paddingBottom: 8 },
  tab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  list: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amount: { fontSize: 20, fontWeight: "800" },
  lokal: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  lokalRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
