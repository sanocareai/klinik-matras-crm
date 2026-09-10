// Kartu rute di atas daftar Job (10 Sep 2026, laporan owner: 1 mobil bisa
// bawa 7 stop — tidak masuk akal foto "mulai perjalanan" 7x di bengkel).
// Dua aksi tingkat-rute:
//   1. "Buka Rute di Maps" — 1 tap buka semua titik. Sumber link SAMA
//      dengan yang di-input admin delivery di web (route.manualMapsUrl),
//      fallback auto multi-stop kalau admin belum tempel.
//   2. "Mulai Perjalanan (N stop)" — foto muatan SEKALI, semua job
//      ASSIGNED di rute jadi EN_ROUTE + notif ke tiap customer.
// Per stop tetap Tiba/Selesai/Gagal sendiri-sendiri (foto bukti serah
// terima tetap wajib per stop — itu yang penting).
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, Alert, ActivityIndicator } from "react-native";
import { Map, Navigation } from "lucide-react-native";
import PhotoCapture from "./PhotoCapture";
import { api } from "../api";
import { useTheme } from "../hooks/useTheme";

export default function RouteStartCard({ route, assignedCount, sampleJobId, onChanged }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [mode, setMode] = useState("idle"); // idle | starting
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mapBusy, setMapBusy] = useState(false);

  async function bukaMaps() {
    setMapBusy(true);
    try {
      const { url } = await api.getRouteMap(route.id);
      if (!url) {
        Alert.alert("Belum ada link rute", "Admin belum menempel link Maps dan titik rute belum punya koordinat.");
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Gagal ambil link rute", e.message || "Coba lagi.");
    } finally {
      setMapBusy(false);
    }
  }

  async function mulai() {
    setBusy(true);
    setErr("");
    try {
      const { urls } = await api.uploadJobPhotos(sampleJobId, photos);
      await api.startRoute(route.id, { proofPhotoUrls: urls });
      setMode("idle");
      setPhotos([]);
      onChanged();
    } catch (e) {
      setErr(e.message || "Gagal memulai rute");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.code}>Rute {route.code}</Text>
          {assignedCount > 0 ? (
            <Text style={styles.sub}>{assignedCount} stop siap berangkat</Text>
          ) : (
            <Text style={styles.sub}>Perjalanan sudah dimulai</Text>
          )}
        </View>
      </View>

      <Pressable style={styles.mapsBtn} onPress={bukaMaps} disabled={mapBusy}>
        {mapBusy ? <ActivityIndicator size="small" color={theme.ACCENT} /> : <Map size={15} color={theme.ACCENT} />}
        <Text style={styles.mapsBtnText}>Buka Rute di Google Maps</Text>
      </Pressable>

      {assignedCount > 0 && mode === "idle" && (
        <Pressable style={styles.startBtn} onPress={() => setMode("starting")}>
          <Navigation size={15} color="#FFFFFF" />
          <Text style={styles.startBtnText}>Mulai Perjalanan ({assignedCount} stop)</Text>
        </Pressable>
      )}

      {mode === "starting" && (
        <View style={styles.form}>
          <PhotoCapture photos={photos} onChange={setPhotos} label="Foto muatan di mobil (wajib, sekali untuk semua stop)" />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <View style={styles.btnRow}>
            <Pressable
              style={[styles.secondaryBtn, { flex: 1 }]}
              onPress={() => { setMode("idle"); setPhotos([]); setErr(""); }}
              disabled={busy}
            >
              <Text style={styles.secondaryBtnText}>Batal</Text>
            </Pressable>
            <Pressable
              style={[styles.startBtn, { flex: 1.4, marginTop: 0 }, (busy || photos.length === 0) && styles.disabled]}
              disabled={busy || photos.length === 0}
              onPress={mulai}
            >
              {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.startBtnText}>Kirim & Mulai</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    card: { backgroundColor: t.SURFACE, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: t.ACCENT + "40" },
    headerRow: { flexDirection: "row", alignItems: "center" },
    code: { color: t.INK, fontSize: 15, fontWeight: "800" },
    sub: { color: t.INK2, fontSize: 12, marginTop: 2 },
    mapsBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      marginTop: 12, paddingVertical: 11, borderRadius: 12,
      borderWidth: 1, borderColor: t.ACCENT + "66",
    },
    mapsBtnText: { color: t.ACCENT, fontWeight: "700", fontSize: 13 },
    startBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      marginTop: 10, paddingVertical: 12, borderRadius: 12, backgroundColor: t.ACCENT,
    },
    startBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13.5 },
    secondaryBtn: {
      alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12,
      borderWidth: 1, borderColor: t.BORDER,
    },
    secondaryBtnText: { color: t.INK2, fontWeight: "600", fontSize: 13.5 },
    form: { marginTop: 10, gap: 10 },
    btnRow: { flexDirection: "row", gap: 8 },
    err: { color: t.RED, fontSize: 12 },
    disabled: { opacity: 0.4 },
  });
}
