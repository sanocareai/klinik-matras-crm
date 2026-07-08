// Info pelanggan (mirip "Info Kontak" di WhatsApp) — data dari CRM:
// pipeline stage, kota, tags, riwayat order, keluhan, dan catatan internal.
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert,
  TouchableOpacity, TextInput,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { api } from "../api";
import { colors, stageColors, stageLabels } from "../theme";
import { formatRupiah, shortDate } from "../utils/format";
import Avatar from "../components/Avatar";

const ORDER_STATUS_LABELS = {
  WAITING_LIST: "Waiting List",
  PENGAMBILAN: "Pengambilan",
  PENGERJAAN: "Pengerjaan",
  FINISH: "Finish",
};

// Detail order (merk, ukuran, keluhan) disimpan backend sebagai JSON di Order.notes
function parseOrderNotes(order) {
  try { return JSON.parse(order.notes) || {}; } catch { return {}; }
}

export default function CustomerScreen({ route, navigation }) {
  const { customerId } = route.params;
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const data = await api.getCustomer(customerId);
          setCustomer(data);
        } catch (err) {
          Alert.alert("Gagal memuat", err.message);
        } finally {
          setLoading(false);
        }
      })();
    }, [customerId])
  );

  async function handleAddNote() {
    const content = noteText.trim();
    if (!content || savingNote) return;
    setSavingNote(true);
    try {
      await api.addNote(customerId, content);
      setNoteText("");
      const data = await api.getCustomer(customerId);
      setCustomer(data);
    } catch (err) {
      Alert.alert("Gagal simpan catatan", err.message);
    } finally {
      setSavingNote(false);
    }
  }

  if (loading) {
    return <ActivityIndicator style={{ flex: 1 }} color={colors.header} size="large" />;
  }
  if (!customer) {
    return <Text style={styles.empty}>Data pelanggan tidak ditemukan</Text>;
  }

  const stage = customer.pipelineStage;
  const orders = customer.orders || [];
  const notes = customer.notes || [];
  const hasComplaint = orders.some((o) => o.hasComplaint);
  const totalValue = orders.reduce((sum, o) => sum + (o.value || 0), 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Info Pelanggan</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Profil ringkas */}
        <View style={styles.profile}>
          <Avatar name={customer.name || customer.phone} size={72} />
          <Text style={styles.name}>{customer.name || "Tanpa nama"}</Text>
          <Text style={styles.phone}>{customer.phone ? "+" + customer.phone : "-"}</Text>
          <View style={styles.badgeRow}>
            {stage && (
              <Text style={[styles.stageBadge, { backgroundColor: stageColors[stage] || colors.textMuted }]}>
                {stageLabels[stage] || stage}
              </Text>
            )}
            {customer.customerType === "CORPORATE" && (
              <Text style={[styles.stageBadge, { backgroundColor: colors.primary }]}>Korporat</Text>
            )}
            {customer.healthStatus === "SAKIT" && (
              <Text style={[styles.stageBadge, { backgroundColor: colors.danger }]}>Sakit</Text>
            )}
            {hasComplaint && (
              <Text style={[styles.stageBadge, { backgroundColor: colors.warning }]}>Pernah Komplain</Text>
            )}
          </View>
        </View>

        {/* Detail */}
        <View style={styles.card}>
          <Row label="Kota" value={customer.city || "-"} />
          <Row label="Email" value={customer.email || "-"} />
          <Row label="Sumber Lead" value={customer.leadSource || "-"} />
          <Row label="Sales Person" value={customer.assignedSales?.name || "-"} />
          <Row label="Tags" value={(customer.tags || []).join(", ") || "-"} />
          <Row label="Total Nilai Order" value={formatRupiah(totalValue)} />
        </View>

        {/* Riwayat order */}
        <Text style={styles.sectionTitle}>Riwayat Order ({orders.length})</Text>
        {orders.length === 0 && <Text style={styles.emptySmall}>Belum ada order</Text>}
        {orders.map((o) => {
          const detail = parseOrderNotes(o);
          const layanan = (o.items || []).map((it) => it.layananName).filter(Boolean).join(", ");
          return (
          <View key={o.id} style={styles.card}>
            <View style={styles.orderTop}>
              <Text style={styles.orderTitle}>
                {o.orderNumber || detail.merkKasur || "Order"}
                {detail.ukuran ? ` · ${detail.ukuran}` : ""}
              </Text>
              <Text style={styles.orderStatus}>{ORDER_STATUS_LABELS[o.status] || o.status}</Text>
            </View>
            <Text style={styles.orderValue}>{formatRupiah(o.value)}</Text>
            {layanan ? <Text style={styles.orderNote}>Layanan: {layanan}</Text> : null}
            {detail.keluhanCustomer ? (
              <Text style={styles.orderNote}>Keluhan: {detail.keluhanCustomer}</Text>
            ) : null}
            {o.hasComplaint ? (
              <Text style={[styles.orderNote, { color: colors.danger }]}>
                ⚠️ Komplain{o.complaintDate ? ` (${shortDate(o.complaintDate)})` : ""}: {o.complaintDetail || "-"}
              </Text>
            ) : null}
            <Text style={styles.orderDate}>{shortDate(o.createdAt)}</Text>
          </View>
          );
        })}

        {/* Catatan internal */}
        <Text style={styles.sectionTitle}>Catatan Internal ({notes.length})</Text>
        <View style={styles.card}>
          <View style={styles.noteInputRow}>
            <TextInput
              style={styles.noteInput}
              placeholder="Tulis catatan baru…"
              placeholderTextColor={colors.textMuted}
              value={noteText}
              onChangeText={setNoteText}
              multiline
            />
            <TouchableOpacity
              style={[styles.noteBtn, (!noteText.trim() || savingNote) && { opacity: 0.5 }]}
              onPress={handleAddNote}
              disabled={!noteText.trim() || savingNote}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Simpan</Text>
            </TouchableOpacity>
          </View>
          {notes.map((n) => (
            <View key={n.id} style={styles.note}>
              <Text style={styles.noteContent}>{n.content}</Text>
              <Text style={styles.noteMeta}>
                {n.author?.name || "?"} · {shortDate(n.createdAt)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.header, flexDirection: "row", alignItems: "center",
    paddingHorizontal: 8, paddingVertical: 12,
  },
  backBtn: { paddingHorizontal: 8 },
  backText: { color: "#fff", fontSize: 30, lineHeight: 32 },
  headerTitle: { color: colors.headerText, fontSize: 17, fontWeight: "700", marginLeft: 6 },
  profile: { alignItems: "center", padding: 20, backgroundColor: colors.card },
  name: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 10 },
  phone: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap", justifyContent: "center" },
  stageBadge: {
    color: "#fff", fontSize: 12, fontWeight: "700",
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: "hidden",
  },
  card: {
    backgroundColor: colors.card, marginHorizontal: 12, marginTop: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border,
  },
  detailRow: { flexDirection: "row", paddingVertical: 5 },
  detailLabel: { width: 130, fontSize: 13, color: colors.textSecondary },
  detailValue: { flex: 1, fontSize: 13, color: colors.text, fontWeight: "500" },
  sectionTitle: {
    fontSize: 14, fontWeight: "700", color: colors.text,
    marginTop: 18, marginHorizontal: 14,
  },
  emptySmall: { marginHorizontal: 14, marginTop: 6, color: colors.textMuted, fontSize: 13 },
  orderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderTitle: { fontSize: 14, fontWeight: "700", color: colors.text, flex: 1 },
  orderStatus: {
    fontSize: 11, fontWeight: "700", color: colors.primary,
    backgroundColor: "#eff6ff", paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 8, overflow: "hidden",
  },
  orderValue: { fontSize: 15, fontWeight: "700", color: "#16a34a", marginTop: 4 },
  orderNote: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  orderDate: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  noteInputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end", marginBottom: 8 },
  noteInput: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: colors.text,
    backgroundColor: colors.bg, maxHeight: 90,
  },
  noteBtn: {
    backgroundColor: colors.header, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  note: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingVertical: 8,
  },
  noteContent: { fontSize: 13, color: colors.text },
  noteMeta: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  empty: { textAlign: "center", marginTop: 60, color: colors.textMuted },
});
