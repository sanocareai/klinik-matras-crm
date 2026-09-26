import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { STAGES, STAGE_LABEL, formatRupiah, statusInfo, statusesForStage } from "@sano/delivery-shared";
import { biayaArmadaApi } from "../client";
import { useSession } from "../SessionContext";
import { useDraftStore } from "../draftStore";
import { elevation, radius, type, useTheme } from "../theme";
import { tanggalWIB } from "../format";
import { Icon, iconForExpense } from "../icons";
import { Box, Btn, Card, Chip, IconBox, SkeletonList, StateView } from "../ui";
import { BottomNav, NAV_SPACE } from "../BottomNav";
import { labelJumlah, useRingkasanBiaya } from "../ringkasan";

const PER_HALAMAN = 20;
// Kartu ringkasan: tahap -> label, ikon, dan warna.
const RINGKAS = [
  { k: "DRAF", label: "Draf", icon: "fileText", tone: "neutral" },
  { k: "DIAJUKAN", label: "Menunggu", icon: "clock", tone: "accent" },
  { k: "PERLU_REVISI", label: "Perlu Revisi", icon: "edit", tone: "orange" },
  { k: "DISETUJUI", label: "Disetujui", icon: "checkCircle", tone: "green" },
];

export default function BiayaArmadaScreen({ navigation, route }) {
  const t = useTheme();
  const { abilities } = useSession();
  const store = useDraftStore();
  const [stage, setStage] = useState(route?.params?.stage && STAGES.includes(route.params.stage) ? route.params.stage : "DIAJUKAN");
  const [items, setItems] = useState([]);
  const [adaLagi, setAdaLagi] = useState(false);
  const [status, setStatus] = useState("memuat"); // memuat | siap | gagal
  const [error, setError] = useState("");
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lokal, setLokal] = useState([]);
  const [sinkron, setSinkron] = useState({ busy: false, pesan: "" });
  const permintaan = useRef(0);
  const ringkasan = useRingkasanBiaya(navigation);

  // Tahap dari Beranda (lonceng / statistik hero) diterapkan saat layar dibuka ulang.
  useEffect(() => { const s0 = route?.params?.stage; if (s0 && STAGES.includes(s0)) setStage(s0); }, [route?.params?.stage]);

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
    ringkasan.muat();
  }

  const belumSelesai = lokal.filter((d) => d.status !== "SELESAI");

  const kepala = (
    <View style={{ gap: 14 }}>
      <View style={s.grid}>
        {RINGKAS.map((r) => {
          const aktif = stage === r.k;
          return (
            <Pressable key={r.k} onPress={() => setStage(r.k)} accessibilityRole="button" accessibilityState={{ selected: aktif }}
              accessibilityLabel={`${r.label}: ${labelJumlah(ringkasan.data[r.k])}`}
              style={({ pressed }) => [s.sum, { backgroundColor: t.surface, borderColor: aktif ? t.accent : t.border, opacity: pressed ? 0.9 : 1 }, aktif && { borderWidth: 1.5 }, elevation(t, 1)]}>
              <IconBox name={r.icon} tone={r.tone} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={[s.sumNum, { color: t.ink }]}>{ringkasan.status === "gagal" ? "–" : labelJumlah(ringkasan.data[r.k])}</Text>
                <Text style={{ color: t.ink2, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{r.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {STAGES.map((k) => {
          const aktif = stage === k;
          return (
            <Pressable key={k} onPress={() => setStage(k)} style={[s.tab, { backgroundColor: aktif ? t.tabActive : t.surface, borderColor: aktif ? t.tabActive : t.border }]} accessibilityRole="tab" accessibilityState={{ selected: aktif }}>
              <Text style={{ color: aktif ? t.tabActiveInk : t.ink2, fontWeight: "700", fontSize: 13 }}>{STAGE_LABEL[k]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {belumSelesai.length > 0 && (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <IconBox name="cloudOff" tone="orange" size={36} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: t.ink }]}>Draf lokal ({belumSelesai.length})</Text>
              <Text style={{ color: t.ink3, fontSize: 12 }}>Tersimpan di perangkat ini dan belum dikirim ke server.</Text>
            </View>
          </View>
          {belumSelesai.map((d) => (
            <View key={d.id} style={[s.lokalRow, { borderColor: t.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{d.draft.expenseType || "Biaya"} · {formatRupiah(d.draft.amount)} · {tanggalWIB(d.draft.date)}</Text>
                {!!d.lastError && <Text style={{ color: t.red, fontSize: 12 }}>{d.lastError}</Text>}
              </View>
              <Pressable onPress={async () => { await store.remove(d.id); bacaLokal(); }} accessibilityLabel="Hapus draf lokal" hitSlop={8}>
                <Text style={{ color: t.red, fontWeight: "700", fontSize: 13 }}>Hapus</Text>
              </Pressable>
            </View>
          ))}
          {!!sinkron.pesan && <Text style={{ color: t.ink2, fontSize: 12 }}>{sinkron.pesan}</Text>}
          <Btn title="Kirim draf lokal" icon="send" kind="secondary" onPress={kirimLokal} busy={sinkron.busy} />
        </Card>
      )}

      <View style={s.listHead}>
        <Text style={[type.heading, { color: t.ink }]}>{STAGE_LABEL[stage]}</Text>
        {status === "siap" && <Text style={[type.caption, { color: t.ink3 }]}>{items.length}{adaLagi ? "+" : ""} pengajuan</Text>}
      </View>
      {!!error && status === "siap" && <Box action={<Btn title="Coba lagi" kind="ghost" size="sm" onPress={() => muat()} />}>{error}</Box>}
    </View>
  );

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={s.top}>
        <View style={{ flex: 1 }}>
          <Text style={[type.overline, { color: t.accent }]}>DELIVERY CONTROL</Text>
          <Text style={[type.title, { color: t.ink }]}>Biaya Armada</Text>
        </View>
        <IconBox name="wallet" tone="accent" size={44} />
      </View>

      <FlatList
        data={status === "siap" ? items : []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={[s.list, { paddingBottom: NAV_SPACE + (abilities.submit ? 88 : 24) }]}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.accent} colors={[t.accent]} onRefresh={async () => { setRefreshing(true); await Promise.all([muat(), ringkasan.muat()]); setRefreshing(false); }} />}
        ListHeaderComponent={kepala}
        ListEmptyComponent={
          status === "memuat" ? (
            <View style={{ gap: 12 }}>
              <ActivityIndicator color={t.accent} accessibilityLabel="Memuat" />
              <SkeletonList count={4} />
            </View>
          ) : status === "gagal" ? (
            <StateView icon="alert" tone="red" title="Daftar belum dapat dimuat" message={error}
              action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => muat()} />} />
          ) : (
            <StateView icon="inbox" title="Belum ada pengajuan" message={`Belum ada pengajuan di tahap ${STAGE_LABEL[stage].toLowerCase()}.`}
              action={abilities.submit ? <Btn title="Tambah Pengajuan" icon="plus" kind="secondary" onPress={() => navigation.navigate("BiayaForm", {})} /> : null} />
          )
        }
        ListFooterComponent={adaLagi && status === "siap" ? <Btn title="Muat lebih banyak" kind="ghost" busy={memuatLagi} onPress={() => muat({ tambah: true })} style={{ marginTop: 4 }} /> : null}
        renderItem={({ item }) => {
          const info = statusInfo(item.status);
          const plat = item.vehicleId && item.vehiclePlateSnapshot ? item.vehiclePlateSnapshot : null;
          return (
            <Pressable onPress={() => navigation.navigate("BiayaDetail", { id: item.id })} accessibilityRole="button"
              accessibilityLabel={`${item.expenseType} ${formatRupiah(item.amount)}, ${info.label}`}
              style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.9 : 1 }, elevation(t, 1)]}>
              <IconBox name={iconForExpense(item.expenseType)} tone={info.tone === "neutral" ? "accent" : info.tone} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={s.itemTop}>
                  <Text style={[type.label, { color: t.ink, fontSize: 15, flex: 1 }]} numberOfLines={1}>{item.expenseType}</Text>
                  <Text style={[type.amount, { color: t.ink }]}>{formatRupiah(item.amount)}</Text>
                </View>
                <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={1}>
                  {tanggalWIB(item.date)}{plat ? ` · ${plat}` : ""}{item.requestedBy?.name ? ` · ${item.requestedBy.name}` : ""}
                </Text>
                <View style={[s.itemTop, { marginTop: 3 }]}>
                  <Text style={{ color: t.ink3, fontSize: 11, flex: 1 }} numberOfLines={1}>{item.submissionNumber}</Text>
                  <Chip label={info.label} tone={info.tone} size="sm" />
                </View>
                {item.status === "PERLU_REVISI" && !!item.revisionReason && (
                  <View style={[s.revisi, { backgroundColor: t.orangeBg }]}>
                    <Icon name="edit" size={12} color={t.orange} />
                    <Text style={{ color: t.orange, fontSize: 12, flex: 1 }} numberOfLines={2}>Revisi: {item.revisionReason}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {abilities.submit && (
        <View pointerEvents="box-none" style={[s.fabWrap, { bottom: NAV_SPACE }]}>
          <Btn title="Tambah Pengajuan" icon="plus" size="lg" onPress={() => navigation.navigate("BiayaForm", {})} style={[s.fab, elevation(t, 2)]} />
        </View>
      )}
      <BottomNav navigation={navigation} current="BiayaArmada" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  list: { paddingHorizontal: 18, paddingTop: 8, gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  sum: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1 },
  sumNum: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  tabs: { gap: 8 },
  tab: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1 },
  lokalRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  listHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 2 },
  item: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  revisi: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginTop: 4 },
  fabWrap: { position: "absolute", right: 18, left: 18, alignItems: "flex-end" },
  fab: { borderRadius: radius.pill, paddingHorizontal: 22 },
});
