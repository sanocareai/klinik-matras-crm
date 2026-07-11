// Bottom sheet Info Pelanggan — dibuka dari tap nama/avatar di header chat.
// INDIVIDUAL: profil + pipeline (tap ubah) + info (sumber lead/kondisi
// kasur/tipe/kota, inline edit) + order (list + tambah) + catatan.
// GROUP: nama grup + jumlah media (member count TIDAK tersedia — WAHA
// group-participants belum diintegrasikan backend, lihat catatan yang sama
// di frontend/src/features/inbox/components/CustomerPanel/GroupPanel.jsx).
// Pola SAMA dengan CustomerPanel/* versi web (ProfileSection, PipelineSection,
// InfoSection, OrdersSection, NotesSection), disatukan jadi 1 file RN.
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, Modal, FlatList,
} from "react-native";
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { Pencil, Copy, Check } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { stageLabels, stageColors } from "../theme";
import { formatRupiah, shortDate } from "../utils/format";
import Avatar from "./Avatar";
import OrderFormModal from "./OrderFormModal";
import { useMessagesForConv } from "../store/messageStore";

const STAGE_ORDER = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
const ORDER_STATUS_LABELS = { WAITING_LIST: "Waiting List", PENGAMBILAN: "Pengambilan", PENGERJAAN: "Pengerjaan", FINISH: "Finish" };
const LEAD_SOURCE_LABELS = {
  META_ADS: "Iklan Meta", GOOGLE_ADS: "Google Ads", WEBSITE_ORGANIC: "Website Organik",
  INSTAGRAM: "Instagram", WHATSAPP_DIRECT: "WA Langsung", REFERRAL: "Referral", OTHER: "Lainnya",
};
const KOTA_LIST = [
  "Jakarta Selatan", "Jakarta Barat", "Jakarta Utara", "Jakarta Pusat", "Jakarta Timur",
  "Bekasi", "Tangerang", "Bogor", "Depok", "Bandung", "Sukabumi", "Karawang",
];

function parseOrderNotes(order) {
  try { return JSON.parse(order.notes) || {}; } catch { return null; }
}

// Sheet pilih 1 opsi dari daftar (dipakai Sumber Lead & Kota) — kecil,
// tidak perlu file terpisah.
function PickerSheet({ visible, title, options, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerItem} onPress={() => { onSelect(item.value); onClose(); }}>
                <Text style={styles.pickerItemText}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

const CustomerSheet = forwardRef(function CustomerSheet({ conversation }, ref) {
  const sheetRef = useRef(null);
  const snapPoints = useMemo(() => ["60%", "95%"], []);

  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showLeadSourcePicker, setShowLeadSourcePicker] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);

  const isGroup = conversation?.type === "GROUP";
  const customerId = conversation?.customerId;
  const groupMessages = useMessagesForConv(conversation?.id);
  const mediaCount = useMemo(
    () => groupMessages.filter((m) => !!m.mediaType && !!m.mediaUrl).length,
    [groupMessages],
  );

  const load = useCallback(async () => {
    if (isGroup || !customerId) return;
    setLoading(true);
    try {
      const data = await api.getCustomer(customerId);
      setCustomer(data);
    } catch (err) {
      Alert.alert("Gagal memuat data pelanggan", err.message);
    } finally {
      setLoading(false);
    }
  }, [customerId, isGroup]);

  useImperativeHandle(ref, () => ({
    open: () => { load(); sheetRef.current?.present(); },
    close: () => sheetRef.current?.dismiss(),
  }), [load]);

  const renderBackdrop = useCallback((props) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  ), []);

  function update(patch) {
    setCustomer((c) => (c ? { ...c, ...patch } : c));
  }

  async function handleStageChange(stage) {
    if (!customer || stage === customer.pipelineStage) return;
    const prev = customer.pipelineStage;
    update({ pipelineStage: stage }); // optimistic
    try {
      const updated = await api.updateCustomer(customerId, { pipelineStage: stage });
      update(updated);
    } catch (err) {
      update({ pipelineStage: prev });
      Alert.alert("Gagal ubah pipeline", err.message);
    }
  }

  async function toggleHealth(value) {
    const newVal = customer.healthStatus === value ? null : value;
    const prev = customer.healthStatus;
    update({ healthStatus: newVal });
    try {
      const updated = await api.updateCustomer(customerId, { healthStatus: newVal });
      update({ healthStatus: updated.healthStatus });
    } catch (err) {
      update({ healthStatus: prev });
      Alert.alert("Gagal", err.message);
    }
  }

  async function toggleCustomerType(value) {
    if ((customer.customerType || "END_USER") === value) return;
    const prev = customer.customerType;
    update({ customerType: value });
    try {
      const updated = await api.updateCustomer(customerId, { customerType: value });
      update({ customerType: updated.customerType });
    } catch (err) {
      update({ customerType: prev });
      Alert.alert("Gagal", err.message);
    }
  }

  async function saveLeadSource(value) {
    try {
      const updated = await api.updateCustomer(customerId, { leadSource: value });
      update(updated);
    } catch (err) {
      Alert.alert("Gagal simpan sumber lead", err.message);
    }
  }

  async function saveCity(value) {
    try {
      const updated = await api.updateCustomer(customerId, { city: value || null });
      update(updated);
    } catch (err) {
      Alert.alert("Gagal simpan kota", err.message);
    }
  }

  async function saveName() {
    try {
      const updated = await api.updateCustomer(customerId, { name: nameDraft.trim() || null });
      update(updated);
      setNameEditing(false);
    } catch (err) {
      Alert.alert("Gagal ubah nama", err.message);
    }
  }

  async function copyPhone() {
    if (!customer?.phone) return;
    await Clipboard.setStringAsync(customer.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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

  function handleOrderCreated(order) {
    setCustomer((c) => (c ? { ...c, orders: [order, ...(c.orders || [])] } : c));
  }

  if (isGroup) {
    const groupName = conversation?.groupName || "Grup WhatsApp";
    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: tokens.color.card }}
        handleIndicatorStyle={{ backgroundColor: tokens.color.border }}
      >
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={styles.profile}>
            <Avatar name={groupName} isGroup size={72} />
            <Text style={styles.name}>{groupName}</Text>
            <Text style={styles.phone}>Percakapan Grup WhatsApp</Text>
          </View>
          <Section title={`Media (${mediaCount})`}>
            <Text style={styles.detailValue}>
              {mediaCount > 0
                ? `${mediaCount} foto/video/dokumen dibagikan di percakapan ini`
                : "Belum ada media dibagikan"}
            </Text>
          </Section>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  }

  const orders = customer?.orders || [];
  const notes = customer?.notes || [];
  const totalValue = orders.reduce((sum, o) => sum + (o.value || 0), 0);

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: tokens.color.card }}
      handleIndicatorStyle={{ backgroundColor: tokens.color.border }}
    >
      {loading || !customer ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={tokens.color.accent} size="large" /></View>
      ) : (
        <BottomSheetScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Header profil */}
          <View style={styles.profile}>
            <Avatar name={customer.name || customer.phone} size={72} />
            {nameEditing ? (
              <View style={styles.nameEditRow}>
                <TextInput
                  autoFocus
                  style={styles.nameInput}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Nama pelanggan…"
                  placeholderTextColor={tokens.color.textMuted}
                />
                <TouchableOpacity style={styles.nameSaveBtn} onPress={saveName}>
                  <Text style={styles.nameSaveText}>Simpan</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.nameRow}
                onPress={() => { setNameDraft(customer.name || ""); setNameEditing(true); }}
              >
                <Text style={styles.name}>{customer.name || "Tanpa nama"}</Text>
                <Pencil size={14} color={tokens.color.textMuted} strokeWidth={2} style={styles.editIcon} />
              </TouchableOpacity>
            )}
            <View style={styles.phoneRow}>
              <Text style={styles.phone}>{customer.phone ? "+" + customer.phone : "-"}</Text>
              {customer.phone && (
                <TouchableOpacity onPress={copyPhone} style={styles.copyBtnRow}>
                  {copied ? (
                    <Check size={13} color={tokens.color.success} strokeWidth={2.2} style={styles.copyBtnIcon} />
                  ) : (
                    <Copy size={13} color={tokens.color.accent} strokeWidth={2} style={styles.copyBtnIcon} />
                  )}
                  <Text style={styles.copyBtnText}>{copied ? "Disalin" : "Salin"}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Pipeline pills */}
          <Section title="Tahap Pipeline">
            <View style={styles.pillRow}>
              {STAGE_ORDER.map((s) => {
                const active = customer.pipelineStage === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.stagePill, active && { backgroundColor: tokens.color.accent, borderColor: tokens.color.accent }]}
                    onPress={() => handleStageChange(s)}
                  >
                    <Text style={[styles.stagePillText, active && styles.stagePillTextActive]}>{stageLabels[s] || s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          {/* Info */}
          <Section title="Sumber Lead">
            <TouchableOpacity style={styles.selectBox} onPress={() => setShowLeadSourcePicker(true)}>
              <Text style={styles.selectBoxText}>{LEAD_SOURCE_LABELS[customer.leadSource] || "— Pilih —"}</Text>
            </TouchableOpacity>
          </Section>

          <Section title="Kondisi Kasur">
            <View style={styles.pillRow}>
              {[{ v: "SAKIT", l: "Sakit" }, { v: "TIDAK_SAKIT", l: "Tidak Sakit" }].map(({ v, l }) => {
                const active = customer.healthStatus === v;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.smallPill, active && (v === "SAKIT" ? styles.pillDangerActive : styles.pillSuccessActive)]}
                    onPress={() => toggleHealth(v)}
                  >
                    <Text style={[styles.smallPillText, active && styles.smallPillTextActive]}>{l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!customer.healthStatus && <Text style={styles.hint}>Belum ditanyakan ke customer</Text>}
          </Section>

          <Section title="Tipe Customer">
            <View style={styles.pillRow}>
              {[{ v: "END_USER", l: "End User" }, { v: "CORPORATE", l: "Corporate" }].map(({ v, l }) => {
                const active = (customer.customerType || "END_USER") === v;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.smallPill, active && styles.pillAccentActive]}
                    onPress={() => toggleCustomerType(v)}
                  >
                    <Text style={[styles.smallPillText, active && styles.smallPillTextActive]}>{l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          <Section title="Kota">
            <TouchableOpacity style={styles.selectBox} onPress={() => setShowCityPicker(true)}>
              <Text style={styles.selectBoxText}>{customer.city || "— Pilih Kota —"}</Text>
            </TouchableOpacity>
          </Section>

          {/* Order */}
          <Section title={`Order (${orders.length}) · Total ${formatRupiah(totalValue)}`}>
            {orders.length === 0 && <Text style={styles.hint}>Belum ada order</Text>}
            {orders.map((o) => {
              const detail = parseOrderNotes(o);
              const layanan = (o.items || []).map((it) => it.layananName).filter(Boolean).join(", ");
              return (
                <View key={o.id} style={styles.orderCard}>
                  <View style={styles.orderTop}>
                    <Text style={styles.orderTitle} numberOfLines={1}>
                      {o.orderNumber || layanan || "Order"}
                    </Text>
                    <Text style={styles.orderStatus}>{ORDER_STATUS_LABELS[o.status] || o.status}</Text>
                  </View>
                  <Text style={styles.orderValue}>{formatRupiah(o.value)}</Text>
                  {layanan ? <Text style={styles.orderNote}>Layanan: {layanan}</Text> : null}
                  {detail?.keluhanCustomer ? <Text style={styles.orderNote}>Keluhan: {detail.keluhanCustomer}</Text> : null}
                  {!detail && o.notes ? <Text style={styles.orderNote}>{o.notes}</Text> : null}
                  <Text style={styles.orderDate}>{shortDate(o.createdAt)}</Text>
                </View>
              );
            })}
            <TouchableOpacity style={styles.addOrderBtn} onPress={() => setShowOrderForm(true)}>
              <Text style={styles.addOrderBtnText}>+ Order</Text>
            </TouchableOpacity>
          </Section>

          {/* Catatan */}
          <Section title={`Catatan Internal (${notes.length})`}>
            <View style={styles.noteInputRow}>
              <TextInput
                style={styles.noteInput}
                placeholder="Tulis catatan baru…"
                placeholderTextColor={tokens.color.textMuted}
                value={noteText}
                onChangeText={setNoteText}
                multiline
              />
              <TouchableOpacity
                style={[styles.noteBtn, (!noteText.trim() || savingNote) && { opacity: 0.5 }]}
                onPress={handleAddNote}
                disabled={!noteText.trim() || savingNote}
              >
                <Text style={styles.noteBtnText}>Simpan</Text>
              </TouchableOpacity>
            </View>
            {notes.map((n) => (
              <View key={n.id} style={styles.noteRow}>
                <Text style={styles.noteContent}>{n.content}</Text>
                <Text style={styles.noteMeta}>{n.author?.name || "?"} · {shortDate(n.createdAt)}</Text>
              </View>
            ))}
          </Section>
        </BottomSheetScrollView>
      )}

      <PickerSheet
        visible={showLeadSourcePicker}
        title="Sumber Lead"
        options={Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
        onSelect={saveLeadSource}
        onClose={() => setShowLeadSourcePicker(false)}
      />
      <PickerSheet
        visible={showCityPicker}
        title="Pilih Kota"
        options={KOTA_LIST.map((k) => ({ value: k, label: k }))}
        onSelect={saveCity}
        onClose={() => setShowCityPicker(false)}
      />
      {customer && (
        <OrderFormModal
          visible={showOrderForm}
          customerId={customerId}
          onClose={() => setShowOrderForm(false)}
          onCreated={handleOrderCreated}
        />
      )}
    </BottomSheetModal>
  );
});

export default CustomerSheet;

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  profile: { alignItems: "center", padding: 20 },
  name: { fontSize: 19, fontWeight: "700", color: tokens.color.textPrimary },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  editIcon: { marginLeft: 6 },
  nameEditRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, width: "100%", paddingHorizontal: 20 },
  nameInput: {
    flex: 1, backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, fontSize: 15, color: tokens.color.textPrimary,
  },
  nameSaveBtn: { backgroundColor: tokens.color.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  nameSaveText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  phone: { fontSize: 14, color: tokens.color.textSecondary },
  copyBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  copyBtnRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 2 },
  copyBtnIcon: { marginRight: 4 },
  copyBtnText: { fontSize: 12, color: tokens.color.accent, fontWeight: "600" },
  section: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: tokens.color.border },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.textMuted, marginBottom: 8, textTransform: "uppercase" },
  hint: { fontSize: 12, color: tokens.color.textMuted },
  detailValue: { fontSize: 13, color: tokens.color.textPrimary },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stagePill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: tokens.color.border,
    backgroundColor: tokens.color.card,
  },
  stagePillText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  stagePillTextActive: { color: "#fff" },
  smallPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: tokens.color.border },
  smallPillText: { fontSize: 12, fontWeight: "600", color: tokens.color.textSecondary },
  smallPillTextActive: { color: tokens.color.textPrimary },
  pillDangerActive: { backgroundColor: "#fee2e2", borderColor: tokens.color.danger },
  pillSuccessActive: { backgroundColor: "#dcfce7", borderColor: tokens.color.success },
  pillAccentActive: { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent },
  selectBox: {
    backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
  selectBoxText: { fontSize: 13, color: tokens.color.textPrimary },
  orderCard: {
    backgroundColor: tokens.color.subtle, borderRadius: 12, padding: 12, marginBottom: 8,
  },
  orderTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderTitle: { fontSize: 13, fontWeight: "700", color: tokens.color.textPrimary, flex: 1, marginRight: 8 },
  orderStatus: {
    fontSize: 10, fontWeight: "700", color: tokens.color.accent, backgroundColor: tokens.color.accentSoft,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
  },
  orderValue: { fontSize: 14, fontWeight: "700", color: tokens.color.success, marginTop: 4 },
  orderNote: { fontSize: 12, color: tokens.color.textSecondary, marginTop: 2 },
  orderDate: { fontSize: 11, color: tokens.color.textMuted, marginTop: 4 },
  addOrderBtn: {
    alignSelf: "flex-start", backgroundColor: tokens.color.accentSoft, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8, marginTop: 4,
  },
  addOrderBtnText: { color: tokens.color.accent, fontWeight: "700", fontSize: 13 },
  noteInputRow: { flexDirection: "row", gap: 8, alignItems: "flex-end", marginBottom: 10 },
  noteInput: {
    flex: 1, backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, fontSize: 13, color: tokens.color.textPrimary, maxHeight: 90,
  },
  noteBtn: { backgroundColor: tokens.color.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  noteBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  noteRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border, paddingVertical: 8 },
  noteContent: { fontSize: 13, color: tokens.color.textPrimary },
  noteMeta: { fontSize: 11, color: tokens.color.textMuted, marginTop: 3 },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "70%" },
  pickerTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 8 },
  pickerItem: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  pickerItemText: { fontSize: 14, color: tokens.color.textPrimary },
});
