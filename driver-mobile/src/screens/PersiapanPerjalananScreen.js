// Halaman Persiapan Perjalanan (7 Okt 2026) — dibuka dari RouteStartCard
// SEBELUM "Mulai Perjalanan". Menampilkan instruksi admin per item +
// upload foto/tanda-selesai, dan item mana yang belum lengkap. Gerbang
// SEBENARNYA tetap di server (POST /routes/:id/start menolak 409
// CHECKLIST_BELUM_LENGKAP terlepas dari halaman ini) — screen ini murni
// supaya driver tidak perlu menebak dari error mentah, dan fetch SELALU
// dari server (bukan dari cache offline) supaya "upload yang masih
// mengantre offline" tidak pernah dianggap terpenuhi (lihat catatan
// panjang di prepChecklistStatus.js & requirement "belum memenuhi gate").
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeft, Camera, CheckCircle2, Circle, RefreshCw } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { api } from "../api";
import { useTheme } from "../hooks/useTheme";
import { createIdempotencyKey } from "../lib/executionCore";
import { checklistSiapBerangkat, hitungItemBelum } from "../lib/prepChecklistStatus";

async function ambilDanKompresFoto() {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  let result;
  if (perm.granted) {
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
  } else {
    const permGaleri = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permGaleri.granted) throw new Error("Izin kamera/galeri ditolak — aktifkan di pengaturan HP.");
    result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  }
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const out = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: Math.min(1600, asset.width || 1600) } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );
  return { uri: out.uri, type: "image/jpeg", name: `checklist-${Date.now()}.jpg` };
}

function ItemCard({ item, routeId, onUploaded }) {
  const theme = useTheme();
  const styles = useMemoStyles(theme);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function kirimFoto() {
    setBusy(true); setErr("");
    try {
      const file = await ambilDanKompresFoto();
      if (!file) return;
      await api.submitRoutePrepChecklistProof(routeId, item.id, file, { idempotencyKey: createIdempotencyKey("checklist") });
      onUploaded();
    } catch (e) {
      setErr(e.message || "Gagal mengunggah foto");
    } finally {
      setBusy(false);
    }
  }

  async function tandaiSelesai() {
    setBusy(true); setErr("");
    try {
      await api.confirmRoutePrepChecklistItemDone(routeId, item.id, { idempotencyKey: createIdempotencyKey("checklist") });
      onUploaded();
    } catch (e) {
      setErr(e.message || "Gagal menandai selesai");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, item.terpenuhi && styles.cardDone]}>
      <View style={styles.row}>
        {item.terpenuhi ? <CheckCircle2 size={16} color={theme.GREEN} /> : <Circle size={16} color={theme.INK3} />}
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title}>
            {item.title}{item.required ? <Text style={styles.wajib}> · WAJIB</Text> : null}
          </Text>
          {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
          {item.quantity != null ? <Text style={styles.meta}>Jumlah: {item.quantity}</Text> : null}
          {item.customerName ? <Text style={styles.meta}>Stop: {item.customerName}{item.orderNumber ? ` (${item.orderNumber})` : ""}</Text> : null}
          {item.buktiBasi ? <Text style={styles.warn}>Instruksi diperbarui admin — unggah ulang bukti.</Text> : null}
        </View>
      </View>

      {!item.terpenuhi && (
        <View style={{ marginTop: 10 }}>
          {item.photoRequired ? (
            <Pressable style={styles.actionBtn} onPress={kirimFoto} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={theme.ACCENT} /> : <Camera size={14} color={theme.ACCENT} />}
              <Text style={styles.actionBtnText}>Ambil / Pilih Foto</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.actionBtn} onPress={tandaiSelesai} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={theme.ACCENT} /> : <CheckCircle2 size={14} color={theme.ACCENT} />}
              <Text style={styles.actionBtnText}>Tandai Selesai</Text>
            </Pressable>
          )}
        </View>
      )}
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
}

export default function PersiapanPerjalananScreen({ route, navigation }) {
  const { routeId, routeCode } = route.params;
  const theme = useTheme();
  const styles = useMemoStyles(theme);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      setData(await api.getRoutePrepChecklist(routeId));
    } catch (e) {
      setErr(e.message || "Gagal memuat checklist");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const siap = data ? checklistSiapBerangkat(data.items) : false;
  const belum = data ? hitungItemBelum(data.items) : 0;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={18} color={theme.INK} />
        </Pressable>
        <Text style={styles.headerTitle}>Persiapan Perjalanan</Text>
        <Pressable onPress={load} style={styles.backBtn}>
          <RefreshCw size={16} color={theme.INK2} />
        </Pressable>
      </View>
      <Text style={styles.sub}>Rute {routeCode}</Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.ACCENT} /></View>
      ) : err ? (
        <View style={styles.center}><Text style={styles.err}>{err}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {data.items.length === 0 ? (
            <Text style={styles.meta}>Tidak ada checklist untuk rute ini — langsung bisa berangkat.</Text>
          ) : (
            data.items.map((item) => <ItemCard key={item.id} item={item} routeId={routeId} onUploaded={load} />)
          )}
        </ScrollView>
      )}

      {data && data.items.length > 0 && (
        <View style={styles.footer}>
          {siap ? (
            <Text style={styles.siapText}>Semua item wajib sudah lengkap — kembali untuk Mulai Perjalanan.</Text>
          ) : (
            <Text style={styles.belumText}>{belum} item wajib belum lengkap.</Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function useMemoStyles(theme) {
  return React.useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.BG },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 8 },
    backBtn: { padding: 6 },
    headerTitle: { fontSize: 16, fontWeight: "800", color: theme.INK },
    sub: { fontSize: 12, color: theme.INK2, paddingHorizontal: 14, marginTop: 2, marginBottom: 6 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: 14, paddingBottom: 24, gap: 10 },
    card: { backgroundColor: theme.SURFACE, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: theme.BORDER },
    cardDone: { borderColor: theme.GREEN + "55", backgroundColor: theme.GREEN + "0D" },
    row: { flexDirection: "row", alignItems: "flex-start" },
    title: { fontSize: 13.5, fontWeight: "700", color: theme.INK },
    wajib: { fontSize: 10.5, fontWeight: "800", color: theme.RED },
    detail: { fontSize: 12, color: theme.INK2, marginTop: 2 },
    meta: { fontSize: 11, color: theme.INK3, marginTop: 2 },
    warn: { fontSize: 11, color: theme.ORANGE, marginTop: 4, fontWeight: "600" },
    actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 38, borderRadius: 10, borderWidth: 1, borderColor: theme.ACCENT + "66" },
    actionBtnText: { color: theme.ACCENT, fontWeight: "700", fontSize: 12.5 },
    err: { color: theme.RED, fontSize: 11.5, marginTop: 6 },
    footer: { padding: 14, borderTopWidth: 1, borderTopColor: theme.BORDER },
    siapText: { color: theme.GREEN, fontWeight: "700", fontSize: 12.5, textAlign: "center" },
    belumText: { color: theme.ORANGE, fontWeight: "700", fontSize: 12.5, textAlign: "center" },
  }), [theme]);
}
