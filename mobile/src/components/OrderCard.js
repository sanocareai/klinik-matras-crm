// Order card — expandable, dengan edit/hapus/status/komplain penuh, PARITY
// dengan OrderDetail di frontend/src/components/customer/OrderSection.jsx.
// Sebelumnya CustomerProfileContent.js render order READ-ONLY saja (cuma
// list + "+ Order" utk bikin baru) — tidak bisa edit/hapus/ubah status/
// tandai komplain sama sekali, padahal endpoint backend-nya sudah ada dan
// sudah dipakai versi web sejak lama. Komponen ini menutup gap itu.
//
// Struktur field & endpoint SAMA PERSIS dengan web (lihat OrderSection.jsx):
// PATCH /orders/:id (status, paymentStatus, notes), DELETE /orders/:id,
// PATCH/DELETE /orders/items/:itemId, POST /orders/:id/items,
// PATCH/DELETE/POST /orders/weight-entries & /orders/:id/weight-entries,
// PATCH /orders/:id/complaint.
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, FlatList } from "react-native";
import { ChevronDown, ChevronUp, Trash2, AlertTriangle, X } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import {
  formatRupiah, shortDate,
  ORDER_STATUS_LABELS, ORDER_STATUS_BADGE, ORDER_STATUSES,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_BADGE, PAYMENT_STATUSES,
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
function buildNotes(info) {
  return JSON.stringify({ merkKasur: info.merkKasur || "", ukuranKasur: info.ukuranKasur || "", keluhanCustomer: info.keluhanCustomer || "" });
}
function newItem() { return { key: String(Date.now()) + Math.random(), layananName: "", harga: "" }; }
function newWeightEntry() { return { key: String(Date.now()) + Math.random(), label: "", beratKg: "" }; }

// Bottom-sheet pilih 1 opsi — pola SAMA dengan OrderFormModal.js/
// CustomerProfileContent.js (tidak diekstrak ke shared component, konvensi
// yang sudah dipakai berulang di codebase ini).
function PickerSheet({ visible, title, options, onSelect, onClose }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(o) => o}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerItem} onPress={() => { onSelect(item); onClose(); }}>
                <Text style={styles.pickerItemText}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// Chip row kecil (≤6 opsi) — dipakai status/paymentStatus, tidak perlu
// bottom sheet terpisah kayak merk/ukuran/layanan yang opsinya lebih panjang.
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

export default function OrderCard({ order, orderOptions, onRefresh, onDeleted }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const info = parseNotes(order.notes);
  const isLayanan = !order.category || order.category === "LAYANAN";

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus || "BELUM_BAYAR");
  const [merkKasur, setMerkKasur] = useState(info.merkKasur);
  const [ukuran, setUkuran] = useState(info.ukuranKasur);
  const [keluhan, setKeluhan] = useState(info.keluhanCustomer);
  const [items, setItems] = useState((order.items || []).map((it) => ({ ...it, key: it.id, harga: String(it.harga) })));
  const [weightEntries, setWeightEntries] = useState(
    (order.weightEntries && order.weightEntries.length > 0)
      ? order.weightEntries.map((e) => ({ ...e, key: e.id, beratKg: String(e.beratKg) }))
      : [newWeightEntry()]
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showComplaintForm, setShowComplaintForm] = useState(false);
  const [complaintDetail, setComplaintDetail] = useState("");
  const [savingComplaint, setSavingComplaint] = useState(false);

  const [showMerkPicker, setShowMerkPicker] = useState(false);
  const [showUkuranPicker, setShowUkuranPicker] = useState(false);
  const [layananPickerTarget, setLayananPickerTarget] = useState(null);

  const totalItems = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);

  function addItem() { setItems((p) => [...p, newItem()]); }
  function removeItem(key) { setItems((p) => (p.length > 1 ? p.filter((it) => it.key !== key) : p)); }
  function setItemField(key, field, val) { setItems((p) => p.map((it) => (it.key === key ? { ...it, [field]: val } : it))); }

  function addWeight() { setWeightEntries((p) => [...p, newWeightEntry()]); }
  function removeWeight(key) { setWeightEntries((p) => (p.length > 1 ? p.filter((e) => e.key !== key) : p)); }
  function setWeightField(key, field, val) { setWeightEntries((p) => p.map((e) => (e.key === key ? { ...e, [field]: val } : e))); }

  function startEdit() {
    const inf = parseNotes(order.notes);
    setStatus(order.status);
    setPaymentStatus(order.paymentStatus || "BELUM_BAYAR");
    setMerkKasur(inf.merkKasur);
    setUkuran(inf.ukuranKasur);
    setKeluhan(inf.keluhanCustomer);
    setItems((order.items || []).map((it) => ({ ...it, key: it.id, harga: String(it.harga) })));
    setWeightEntries(
      (order.weightEntries && order.weightEntries.length > 0)
        ? order.weightEntries.map((e) => ({ ...e, key: e.id, beratKg: String(e.beratKg) }))
        : [newWeightEntry()]
    );
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const finalMerk = isLayanan ? merkKasur : "Sano";
      await api.updateOrder(order.id, {
        status, paymentStatus,
        notes: buildNotes({ merkKasur: finalMerk, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
      });

      // Berat badan — hapus yang dihilangkan, update yang ada, tambah yang baru
      const existingIds = (order.weightEntries || []).map((e) => e.id);
      const currentIds = weightEntries.filter((e) => e.id).map((e) => e.id);
      for (const id of existingIds) {
        if (!currentIds.includes(id)) await api.deleteWeightEntry(id);
      }
      for (const e of weightEntries.filter((e) => e.id)) {
        if (e.label?.trim() && e.beratKg) await api.updateWeightEntry(e.id, { label: e.label.trim(), beratKg: Number(e.beratKg) });
      }
      for (let i = 0; i < weightEntries.length; i++) {
        const e = weightEntries[i];
        if (!e.id && e.label?.trim() && e.beratKg) await api.addWeightEntry(order.id, { label: e.label.trim(), beratKg: Number(e.beratKg), sortOrder: i });
      }

      // Layanan add-ons — hanya utk LAYANAN
      if (isLayanan) {
        const existingItemIds = (order.items || []).map((it) => it.id);
        const currentItemIds = items.filter((it) => it.id).map((it) => it.id);
        for (const id of existingItemIds) {
          if (!currentItemIds.includes(id)) await api.deleteOrderItem(id);
        }
        for (const it of items.filter((it) => it.id)) {
          if (it.layananName?.trim()) await api.updateOrderItem(it.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
        }
        for (const it of items.filter((it) => !it.id)) {
          if (it.layananName?.trim()) await api.addOrderItem(order.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
        }
      }

      setEditing(false);
      onRefresh();
    } catch (err) {
      Alert.alert("Gagal simpan order", err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() { setEditing(false); }

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
            {!editing ? (
              <>
                <TouchableOpacity style={styles.editBtn} onPress={startEdit}>
                  <Text style={styles.editBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleting}>
                  <Trash2 size={12} color={tokens.color.danger} strokeWidth={2.2} />
                  <Text style={styles.deleteBtnText}>{deleting ? "..." : "Hapus"}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                  <Text style={styles.saveBtnText}>{saving ? "..." : "Simpan"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.editBtn} onPress={handleCancel} disabled={saving}>
                  <Text style={styles.editBtnText}>Batal</Text>
                </TouchableOpacity>
              </>
            )}
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

          {/* Status + Pembayaran */}
          <Text style={styles.metaLabel}>Status</Text>
          {editing ? (
            <>
              <ChipPicker options={ORDER_STATUSES} labels={ORDER_STATUS_LABELS} value={status} onChange={setStatus} />
              <ChipPicker options={PAYMENT_STATUSES} labels={PAYMENT_STATUS_LABELS} value={paymentStatus} onChange={setPaymentStatus} />
            </>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
              <Text style={[styles.pillBadge, ORDER_STATUS_BADGE[order.status]]}>{ORDER_STATUS_LABELS[order.status] || order.status}</Text>
              <Text style={[styles.pillBadge, PAYMENT_STATUS_BADGE[order.paymentStatus || "BELUM_BAYAR"]]}>
                {PAYMENT_STATUS_LABELS[order.paymentStatus || "BELUM_BAYAR"]}
              </Text>
            </View>
          )}
          {/* Quick status change — tanpa masuk mode edit penuh, sama seperti dropdown di web */}
          {!editing && (
            <View style={{ marginBottom: 8 }}>
              <ChipPicker options={ORDER_STATUSES} labels={ORDER_STATUS_LABELS} value={order.status} onChange={handleQuickStatusChange} />
            </View>
          )}

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
          {editing ? (
            <View style={{ marginBottom: 8 }}>
              {weightEntries.map((e) => (
                <View key={e.key} style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, { flex: 2 }]}
                    placeholder="cth: Suami / Istri / Sendiri"
                    placeholderTextColor={tokens.color.textMuted}
                    value={e.label}
                    onChangeText={(v) => setWeightField(e.key, "label", v)}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1, marginLeft: 8 }]}
                    placeholder="kg"
                    placeholderTextColor={tokens.color.textMuted}
                    value={e.beratKg}
                    onChangeText={(v) => setWeightField(e.key, "beratKg", v)}
                    keyboardType="numeric"
                  />
                  {weightEntries.length > 1 && (
                    <TouchableOpacity onPress={() => removeWeight(e.key)} style={styles.removeBtn}>
                      <X size={16} color={tokens.color.danger} strokeWidth={2.2} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              <TouchableOpacity onPress={addWeight}><Text style={styles.linkText}>+ Tambah Orang</Text></TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.plainText, { marginBottom: 8 }]}>{weightDisplay || "—"}</Text>
          )}

          {/* Merk + Ukuran */}
          {editing ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>Merk Kasur</Text>
              {isLayanan ? (
                <TouchableOpacity style={styles.selectBox} onPress={() => setShowMerkPicker(true)}>
                  <Text style={styles.selectBoxText}>{merkKasur || "— Pilih Merk —"}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.forcedSano}>Sano ✓</Text>
              )}
              <Text style={styles.metaLabel}>Ukuran</Text>
              <TouchableOpacity style={styles.selectBox} onPress={() => setShowUkuranPicker(true)}>
                <Text style={styles.selectBoxText}>{ukuran || "— Pilih Ukuran —"}</Text>
              </TouchableOpacity>
            </View>
          ) : (info.merkKasur || info.ukuranKasur || !isLayanan) ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              <Text style={styles.chipStatic}>{isLayanan ? (info.merkKasur || "—") : "Sano"}</Text>
              {(info.ukuranKasur || ukuran) ? <Text style={styles.chipStatic}>{info.ukuranKasur || ukuran}</Text> : null}
            </View>
          ) : null}

          {/* Layanan add-ons — hanya LAYANAN */}
          {isLayanan && (editing ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>Layanan (add-ons)</Text>
              {items.map((it) => (
                <View key={it.key} style={styles.itemBlock}>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Nama layanan…"
                      placeholderTextColor={tokens.color.textMuted}
                      value={it.layananName}
                      onChangeText={(v) => setItemField(it.key, "layananName", v)}
                    />
                    <TouchableOpacity style={styles.pickBtn} onPress={() => setLayananPickerTarget(it.key)}>
                      <Text style={styles.pickBtnText}>Pilih</Text>
                    </TouchableOpacity>
                    {items.length > 1 && (
                      <TouchableOpacity onPress={() => removeItem(it.key)} style={styles.removeBtn}>
                        <X size={16} color={tokens.color.danger} strokeWidth={2.2} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Harga (Rp)"
                    placeholderTextColor={tokens.color.textMuted}
                    value={it.harga}
                    onChangeText={(v) => setItemField(it.key, "harga", v)}
                    keyboardType="numeric"
                  />
                </View>
              ))}
              <TouchableOpacity onPress={addItem}><Text style={styles.linkText}>+ Tambah layanan lain</Text></TouchableOpacity>
              <Text style={styles.previewValue}>Total: {formatRupiah(totalItems)}</Text>
            </View>
          ) : (order.items && order.items.length > 0) ? (
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
          ) : null)}

          {/* Nilai untuk BARU/SEWA */}
          {!isLayanan && order.value > 0 && (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>Nilai</Text>
              <Text style={styles.nilaiValue}>{formatRupiah(order.value)}</Text>
            </View>
          )}

          {/* Keluhan/Catatan */}
          {editing ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>{isLayanan ? "Keluhan Customer" : "Catatan"}</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder={isLayanan ? "Keluhan kasur customer…" : "Catatan order…"}
                placeholderTextColor={tokens.color.textMuted}
                value={keluhan}
                onChangeText={setKeluhan}
                multiline
              />
            </View>
          ) : info.keluhanCustomer ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.metaLabel}>{isLayanan ? "Keluhan" : "Catatan"}</Text>
              <Text style={styles.plainText}>{info.keluhanCustomer}</Text>
            </View>
          ) : null}

          {/* Tandai komplain — hanya order DELIVERED yang belum ada komplain */}
          {!editing && order.status === "DELIVERED" && !order.hasComplaint && (
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

      <PickerSheet visible={showMerkPicker} title="Pilih Merk Kasur" options={orderOptions.merkKasur} onSelect={setMerkKasur} onClose={() => setShowMerkPicker(false)} />
      <PickerSheet visible={showUkuranPicker} title="Pilih Ukuran Kasur" options={orderOptions.ukuranKasur} onSelect={setUkuran} onClose={() => setShowUkuranPicker(false)} />
      <PickerSheet
        visible={!!layananPickerTarget}
        title="Pilih Jenis Layanan"
        options={orderOptions.jenisLayanan}
        onSelect={(v) => layananPickerTarget && setItemField(layananPickerTarget, "layananName", v)}
        onClose={() => setLayananPickerTarget(null)}
      />
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
  saveBtn: { backgroundColor: tokens.color.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  saveBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },
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
  inputRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  selectBox: { backgroundColor: tokens.color.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 8 },
  selectBoxText: { fontSize: 13, color: tokens.color.textPrimary },
  forcedSano: { fontSize: 13, fontWeight: "700", color: tokens.color.success, paddingVertical: 6, marginBottom: 8 },
  removeBtn: { marginLeft: 8, padding: 4 },
  linkText: { fontSize: 12, color: tokens.color.accent, fontWeight: "600", marginTop: 2 },
  previewValue: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary, marginTop: 6 },
  itemBlock: { marginBottom: 8 },
  itemLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  itemLineName: { fontSize: 12, color: tokens.color.textSecondary },
  itemLinePrice: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  itemTotalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border },
  itemTotalLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.textPrimary },
  itemTotalValue: { fontSize: 12, fontWeight: "700", color: tokens.color.textPrimary },
  nilaiValue: { fontSize: 14, fontWeight: "700", color: tokens.color.accent },
  pickBtn: { backgroundColor: tokens.color.accentSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginLeft: 8 },
  pickBtnText: { fontSize: 12, fontWeight: "700", color: tokens.color.accent },
  complaintToggleBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  complaintToggleText: { fontSize: 12, color: tokens.color.danger, fontWeight: "600" },
  complaintForm: { padding: 10, backgroundColor: "#fff7f7", borderWidth: 1, borderColor: "#fca5a5", borderRadius: 8 },
  complaintFormLabel: { fontSize: 12, fontWeight: "700", color: "#991b1b", marginBottom: 6 },
  complaintSaveBtn: { flex: 1, backgroundColor: tokens.color.danger, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  complaintSaveBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70%" },
  pickerTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  pickerItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  pickerItemText: { fontSize: 14, color: tokens.color.textPrimary },
  });
}
