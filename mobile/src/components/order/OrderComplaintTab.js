// Tab "Komplain" — paritas mobile dari features/complaints/NewComplaintCaseForm.jsx (web):
// daftar kasus komplain order ini + form "Buka Kasus Komplain" (kategori, tingkat, keluhan).
// Alur lanjutan kasus (status, investigasi, tindak lanjut) tetap di web.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { Plus } from "lucide-react-native";
import { api } from "../../api";
import { useTokens } from "../../constants/theme";
import { shortDate } from "../../utils/format";

// Cermin frontend/src/features/complaints/complaintLabels.js — nilai yang benar-benar dikirim backend.
const CATEGORY_LABEL = {
  KUALITAS_PRODUK: "Kualitas Produk", KENYAMANAN: "Kenyamanan", KETERLAMBATAN: "Keterlambatan",
  KERUSAKAN_TRANSIT: "Kerusakan Saat Transit", SALAH_SPESIFIKASI: "Salah Spesifikasi",
  LAYANAN_STAF: "Layanan Staf", LAINNYA: "Lainnya",
};
const SEVERITY_LABEL = { RENDAH: "Rendah", SEDANG: "Sedang", TINGGI: "Tinggi", KRITIS: "Kritis" };
const STATUS_LABEL = {
  BARU: "Baru", VERIFIKASI: "Verifikasi", INVESTIGASI: "Investigasi", ACTION_REQUIRED: "Perlu Tindakan",
  DIJADWALKAN: "Dijadwalkan", DALAM_PENANGANAN: "Dalam Penanganan", QC: "QC", SIAP_DIKIRIM: "Siap Dikirim",
  DIKIRIM_ULANG: "Dikirim Ulang", KONFIRMASI_CUSTOMER: "Konfirmasi Customer", SELESAI: "Selesai",
  MENUNGGU_CUSTOMER: "Menunggu Customer", MENUNGGU_MATERIAL: "Menunggu Material",
  MENUNGGU_JADWAL: "Menunggu Jadwal", DIBATALKAN: "Dibatalkan",
};

export default function OrderComplaintTab({ orderId }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [cases, setCases] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(false);
  const [category, setCategory] = useState("KUALITAS_PRODUK");
  const [severity, setSeverity] = useState("SEDANG");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    api.getComplaintCases({ orderId }).then((r) => setCases(r.cases || [])).catch((e) => setError(e.message));
  }, [orderId]);
  useEffect(() => { setCases(null); load(); }, [load]);

  async function submit() {
    if (!description.trim()) { Alert.alert("Komplain", "Keluhan customer wajib diisi"); return; }
    setBusy(true);
    try {
      await api.createComplaintCase({ orderId, category, severity, description: description.trim() });
      setForm(false); setDescription(""); setCategory("KUALITAS_PRODUK"); setSeverity("SEDANG");
      load();
    } catch (e) {
      Alert.alert("Gagal membuka kasus", e.message);
    } finally {
      setBusy(false);
    }
  }

  const chips = (map, value, set) => (
    <View style={styles.chips}>
      {Object.entries(map).map(([k, label]) => (
        <TouchableOpacity key={k} style={[styles.chip, value === k && styles.chipOn]} onPress={() => set(k)}>
          <Text style={[styles.chipText, value === k && { color: tokens.color.accent }]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={{ gap: 10 }}>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {!cases && !error && <ActivityIndicator color={tokens.color.accent} />}
      {cases?.length === 0 && <Text style={styles.muted}>Belum ada kasus komplain untuk order ini.</Text>}
      {cases?.map((c) => (
        <View key={c.id} style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.number}>{c.caseNumber}</Text>
            <View style={styles.pill}><Text style={styles.pillText}>{STATUS_LABEL[c.status] || c.status}</Text></View>
          </View>
          <Text style={styles.muted}>
            {CATEGORY_LABEL[c.category] || c.category} · {SEVERITY_LABEL[c.severity] || c.severity} · {shortDate(c.createdAt)}
          </Text>
          <Text style={styles.desc}>{c.description}</Text>
        </View>
      ))}

      {!form ? (
        <TouchableOpacity style={styles.open} onPress={() => setForm(true)}>
          <Plus size={14} color={tokens.color.accent} strokeWidth={2.4} />
          <Text style={styles.openText}>Buka Kasus Komplain</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.card}>
          <Text style={styles.section}>Kategori</Text>
          {chips(CATEGORY_LABEL, category, setCategory)}
          <Text style={styles.section}>Tingkat keparahan</Text>
          {chips(SEVERITY_LABEL, severity, setSeverity)}
          <Text style={styles.section}>Keluhan customer</Text>
          <TextInput
            style={styles.input} value={description} onChangeText={setDescription} multiline
            placeholder="Keluhan customer secara rinci…" placeholderTextColor={tokens.color.textMuted}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={styles.ghost} onPress={() => setForm(false)} disabled={busy}><Text style={styles.ghostText}>Batal</Text></TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={submit} disabled={busy}>
              <Text style={styles.primaryText}>{busy ? "Menyimpan…" : "Buat Kasus"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(t) {
  return StyleSheet.create({
    card: { ...t.glass.surface, borderRadius: 12, padding: 12, gap: 8 },
    head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    number: { fontSize: 13, fontWeight: "800", color: t.color.textPrimary, fontFamily: "monospace" },
    pill: { backgroundColor: t.color.accentSoft, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
    pillText: { fontSize: 11, fontWeight: "700", color: t.color.accent },
    muted: { fontSize: 12, color: t.color.textSecondary, lineHeight: 17 },
    desc: { fontSize: 13, color: t.color.textPrimary, lineHeight: 19 },
    section: { fontSize: 10, fontWeight: "700", color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { borderWidth: 1.5, borderColor: t.color.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
    chipOn: { borderColor: t.color.accent, backgroundColor: t.color.accentSoft },
    chipText: { fontSize: 12, fontWeight: "600", color: t.color.textSecondary },
    input: { backgroundColor: t.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, minHeight: 84, textAlignVertical: "top", color: t.color.textPrimary },
    open: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", ...t.glass.surface, borderRadius: 12, paddingVertical: 13 },
    openText: { color: t.color.accent, fontWeight: "700", fontSize: 13.5 },
    primary: { flex: 1, alignItems: "center", backgroundColor: t.color.accent, borderRadius: 11, paddingVertical: 11 },
    primaryText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    ghost: { flex: 1, alignItems: "center", backgroundColor: t.color.subtle, borderRadius: 11, paddingVertical: 11 },
    ghostText: { color: t.color.textSecondary, fontWeight: "600", fontSize: 13 },
    err: { color: t.color.danger, fontSize: 12.5 },
  });
}
