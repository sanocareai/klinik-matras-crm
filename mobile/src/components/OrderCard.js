// Order card — expandable, VIEW mode + quick-status + hapus + komplain.
// Full edit (semua field termasuk status) sekarang dibuka lewat
// OrderFormModal.js yang SAMA dengan form "+ Order" (mode edit, lihat
// CustomerProfileContent.js#editingOrder) — komponen ini TIDAK LAGI punya
// implementasi form edit sendiri (sebelumnya ada, dobel dengan
// OrderFormModal, berisiko saling drift kalau salah satu diubah tapi yang
// lain lupa — sama persis masalah yang sudah dicatat CLAUDE.md soal AddOrder
// web vs drawer).
//
// Endpoint dipakai (sama dengan web, lihat OrderSection.jsx):
// PATCH /orders/:id (quick status change), DELETE /orders/:id,
// PATCH /orders/:id/complaint.
import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, TextInput } from "react-native";
import { ChevronDown, ChevronUp, Trash2, AlertTriangle } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import {
  formatRupiah, shortDate,
  ORDER_STATUS_LABELS, ORDER_STATUS_BADGE, ORDER_STATUSES,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_BADGE,
  CATEGORY_LABELS, CATEGORY_BADGE,
} from "../utils/format";

function parseNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "" };
  try {
    const p = JSON.parse(notes);
    return { merkKasur: p.merkKasur || "", ukuranKasur: p.ukuranKasur || "", keluhanCustomer: p.keluhanCustomer || "" };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes };
  }
}

// Chip row kecil — dipakai quick status change tanpa masuk form edit penuh,
// sama seperti dropdown cepat di web (OrderSection.jsx, di luar blok editing).
function ChipPicker({ options, labels, value, onChange }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.chipRow}>
      {options.map((v) => {
        const active = value === v;
        return (
          <TouchableOpacity
            key={v}
            style={[styles.chip, active && { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent }]}
            onPress={() => onChange(v)}
          >
            <Text style={[styles.chipText, active && { color: tokens.color.accent }]}>{labels[v] || v}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function OrderCard({ order, onRefresh, onDeleted, onEdit }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const info = parseNotes(order.notes);
  const isLayanan = !order.category || order.category === "LAYANAN";

  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showComplaintForm, setShowComplaintForm] = useState(false);
  const [complaintDetail, setComplaintDetail] = useState("");
  const [savingComplaint, setSavingComplaint] = useState(false);

  function handleDelete() {
    Alert.alert("Hapus order ini?", "Semua item & data terkait juga akan dihapus.", [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus", style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deleteOrder(order.id);
            onDeleted(order.id);
          } catch (err) {
            Alert.alert("Gagal hapus order", err.message);
            setDeleting(false);
          }
        },
      },
    ]);
  }

  async function handleQuickStatusChange(newStatus) {
    try {
      await api.updateOrder(order.id, { status: newStatus });
      onRefresh();
    } catch (err) {
      Alert.alert("Gagal ubah status", err.message);
    }
  }

  async function handleSaveComplaint() {
    if (!complaintDetail.trim()) { Alert.alert("Isi detail komplain terlebih dahulu"); return; }
    setSavingComplaint(true);
    try {
      await api.markOrderComplaint(order.id, { complaintDetail: complaintDetail.trim() });
      setShowComplaintForm(false);
      setComplaintDetail("");
      onRefresh();
    } catch (err) {
      Alert.alert("Gagal simpan komplain", err.message);
    } finally {
      setSavingComplaint(false);
    }
  }

  const weightDisplay = (order.weightEntries && order.weightEntries.length > 0)
    ? order.weightEntries.map((e) => `${e.label}: ${e.beratKg} kg`).join(" · ")
    : null;
  const layananSummary = (order.items || []).map((it) => it.layananName).filter(Boolean).join(", ");
  const catBadge = CATEGORY_BADGE[order.category] || CATEGORY_BADGE.LAYANAN;
  const statusBadge = ORDER_STATUS_BADGE[order.status] || {};

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.summaryRow} onPress={() => setExpanded((v) => !v)}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.summaryTop}>
            <Text style={[styles.orderNumber, catBadge]}>{order.orderNumber || layananSummary || "Order"}</Text>
            {order.hasComplaint && <AlertTriangle size={13} color={tokens.color.danger} strokeWidth={2.2} style={{ marginLeft: 6 }} />}
          </View>
          <Text style={styles.orderValue}>{formatRupiah(order.value)}</Text>
        </View>
        <Text style={[styles.statusBadge, statusBadge]}>{ORDER_STATUS_LABELS[order.status] || order.status}</Text>
        {expanded ? <ChevronUp size={16} color={tokens.color.textMuted} /> : <ChevronDown size={16} color={tokens.color.textMuted} />}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.detail}>
          {/* Tombol aksi */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.editBtn} onPress={() => onEdit(order)}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
              <Trash2 size={12} color={tokens.color.danger} strokeWidth={2.2} />
              <Text style={styles.deleteBtnText}>{deleting ? "..." : "Hapus"}</Text>
            </TouchableOpacity>
          </View>

          {/* Badge komplain */}
          {order.hasComplaint && (
            <View style={styles.complaintBadge}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
                <AlertTriangle size={13} color={tokens.color.danger} strokeWidth={2.2} />
                <Text style={styles.complaintBadgeTitle}>Ada Komplain</Text>
                <Text style={styles.complaintBadgeDate}>{order.complaintDate ? shortDate(order.complaintDate) : ""}</Text>
              </View>
              {order.complaintDetail && <Text style={styles.complaintBadgeText}>{order.complaintDetail}</Text>}
            </View>
          )}

          {/* Status + Pembayaran (read-only) + quick status change */}
          <Text style={styles.metaLabel}>Status</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
            <Text style={[styles.pillBadge, ORDER_STATUS_BADGE[order.status]]}>{ORDER_STATUS_LABELS[order.status] || order.status}</Text>
            <Text style={[styles.pillBadge, PAYMENT_STATUS_BADGE[order.paymentStatus || "BELUM_BAYAR"]]}>
              {PAYMENT_STATUS_LABELS[order.paymentStatus || "BELUM_BAYAR"]}
            </Text>
          </View>
          <View style={{ marginBottom: 8 }}>
            <ChipPicker options={ORDER_STATUSES} labels={ORDER_STATUS_LABELS} value={order.status} onChange={handleQuickStatusChange} />
          </View>

          {/* ID Order */}
          <Text style={styles.metaLabel}>ID Order</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
            <Text style={[styles.idBadge, catBadge]}>{order.orderNumber || "—"}</Text>
            {order.category && order.category !== "LAYANAN" && (
              <Text style={styles.categoryHint}> · {CATEGORY_LABELS[order.category]}</Text>
            )}
          </View>

          {/* Berat Badan */}
          <Text style={styles.metaLabel}>Berat Badan</Text>
          <Text style={[styles.plainText, { marginBottom: 8 }]}>{weightDisplay || "—"}</Text>

          {/* Merk + Ukuran */}
          {(info.merkKasur || info.ukuranKasur || !isLayanan) ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              <Text style={styles.chipStatic}>{isLayanan ? (info.merkKasur || "—") : "Sano"}</Text>
              {info.ukuranKasur ? <Text style={styles.chipStatic}>{info.ukuranKasur}</Text> : null}
            </View>
          ) : null}

          {/* Layanan add-ons — hanya LAYANAN */}
          {isLayanan && (order.items && order.items.length > 0) ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>Layanan</Text>
              {order.items.map((it) => (
                <View key={it.id} style={styles.itemLine}>
                  <Text style={styles.itemLineName}>{it.layananName}</Text>
                  <Text style={styles.itemLinePrice}>{formatRupiah(it.harga)}</Text>
                </View>
              ))}
              <View style={styles.itemTotalRow}>
                <Text style={styles.itemTotalLabel}>Total</Text>
                <Text style={styles.itemTotalValue}>{formatRupiah(order.value)}</Text>
              </View>
            </View>
          ) : null}

          {/* Nilai untuk BARU/SEWA */}
          {!isLayanan && order.value > 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>Nilai</Text>
              <Text style={styles.nilaiValue}>{formatRupiah(order.value)}</Text>
            </View>
          )}

          {/* Keluhan/Catatan */}
          {info.keluhanCustomer ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>{isLayanan ? "Keluhan" : "Catatan"}</Text>
              <Text style={styles.plainText}>{info.keluhanCustomer}</Text>
            </View>
          ) : null}

          {/* Tandai komplain — hanya order DELIVERED yang belum ada komplain */}
          {order.status === "DELIVERED" && !order.hasComplaint && (
            <View style={{ marginTop: 4 }}>
              {!showComplaintForm ? (
                <TouchableOpacity style={styles.complaintToggleBtn} onPress={() => setShowComplaintForm(true)}>
                  <AlertTriangle size={12} color={tokens.color.danger} strokeWidth={2.2} />
                  <Text style={styles.complaintToggleText}>+ Tandai Komplain</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.complaintForm}>
                  <Text style={styles.complaintFormLabel}>Detail Komplain</Text>
                  <TextInput
                    style={[styles.input, styles.textarea, { borderWidth: 1, borderColor: "#fca5a5" }]}
                    placeholder="Jelaskan masalah yang dilaporkan customer…"
                    placeholderTextColor={tokens.color.textMuted}
                    value={complaintDetail}
                    onChangeText={setComplaintDetail}
                    multiline
                  />
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                    <TouchableOpacity style={styles.complaintSaveBtn} onPress={handleSaveComplaint} disabled={savingComplaint}>
                      <Text style={styles.complaintSaveBtnText}>{savingComplaint ? "Menyimpan…" : "Simpan Komplain"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.editBtn} onPress={() => { setShowComplaintForm(false); setComplaintDetail(""); }}>
                      <Text style={styles.editBtnText}>Batal</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  card: { backgroundColor: tokens.color.subtle, borderRadius: 12, marginBottom: 8, overflow: "hidden" },
  summaryRow: { flexDirection: "row", alignItems: "center", padding: 12, gap: 8 },
  summaryTop: { flexDirection: "row", alignItems: "center" },
  orderNumber: {
    fontSize: 12, fontWeight: "700", color: tokens.color.textPrimary,
    paddingHorizontal: 6, borderRadius: 5, overflow: "hidden",
  },
  orderValue: { fontSize: 14, fontWeight: "700", color: tokens.color.success, marginTop: 4 },
  statusBadge: { fontSize: 10, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: "hidden" },
  detail: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border, paddingTop: 10 },
  actionRow: { flexDirection: "row", gap: 6, justifyContent: "flex-end", marginBottom: 10 },
  editBtn: { backgroundColor: tokens.color.card, borderWidth: 1, borderColor: tokens.color.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  editBtnText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#fee2e2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  deleteBtnText: { fontSize: 12, fontWeight: "600", color: tokens.color.danger },
  complaintBadge: { marginBottom: 10, padding: 10, backgroundColor: "#fee2e2", borderRadius: 8, borderWidth: 1, borderColor: "#fca5a5" },
  complaintBadgeTitle: { fontSize: 12, fontWeight: "700", color: "#991b1b", marginLeft: 6 },
  complaintBadgeDate: { fontSize: 11, color: "#b91c1c", marginLeft: "auto" },
  complaintBadgeText: { fontSize: 12, color: "#7f1d1d" },
  metaLabel: { fontSize: 10, fontWeight: "700", color: tokens.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, marginTop: 4 },
  pillBadge: { fontSize: 11.5, fontWeight: "700", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  idBadge: { fontFamily: "monospace", fontSize: 12, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  categoryHint: { fontSize: 11, color: tokens.color.textMuted },
  plainText: { fontSize: 13, color: tokens.color.textSecondary },
  chipStatic: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: "#f3f4f6", color: "#374151", fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card },
  chipText: { fontSize: 11, fontWeight: "600", color: tokens.color.textSecondary },
  input: { backgroundColor: tokens.color.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: tokens.color.textPrimary },
  textarea: { minHeight: 56, textAlignVertical: "top" },
  itemLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  itemLineName: { fontSize: 12, color: tokens.color.textSecondary },
  itemLinePrice: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  itemTotalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border },
  itemTotalLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.textPrimary },
  itemTotalValue: { fontSize: 12, fontWeight: "700", color: tokens.color.textPrimary },
  nilaiValue: { fontSize: 14, fontWeight: "700", color: tokens.color.accent },
  complaintToggleBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  complaintToggleText: { fontSize: 12, color: tokens.color.danger, fontWeight: "600" },
  complaintForm: { padding: 10, backgroundColor: "#fff7f7", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8 },
  complaintFormLabel: { fontSize: 12, fontWeight: "700", color: "#991b1b", marginBottom: 6 },
  complaintSaveBtn: { flex: 1, backgroundColor: tokens.color.danger, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  complaintSaveBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  });
}
