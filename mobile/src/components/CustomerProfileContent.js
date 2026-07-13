// Konten profil pelanggan INDIVIDUAL — di-extract dari CustomerSheet.js
// (bottom sheet, dipanggil dari header ChatScreen) supaya bisa dipakai
// ULANG PERSIS SAMA di CustomerDetailScreen.js (full screen, dari tab
// Pelanggan) tanpa duplikasi ~300 baris logic profil/pipeline/info/order/
// catatan. Komponen ini SELF-CONTAINED: terima customerId, urus sendiri
// fetch + semua inline-edit handler-nya. Parent (CustomerSheet ATAU
// CustomerDetailScreen) cuma sediakan container scroll-nya sendiri
// (BottomSheetScrollView vs ScrollView biasa) + chrome (header/back).
//
// Kasus GROUP (grup WhatsApp, bukan Customer record) TETAP di CustomerSheet.js
// saja — tidak di-extract ke sini, karena tab Pelanggan/CustomerDetail
// tidak pernah berurusan dengan grup (grup tidak punya Customer record,
// lihat CLAUDE.md "Conversation type GROUP").
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Modal, FlatList,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Pencil, Copy, Check, MessageCircle, AlertTriangle, RefreshCw } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { stageLabels } from "../theme";
import { formatRupiah, shortDate } from "../utils/format";
import Avatar from "./Avatar";
import OrderCard from "./OrderCard";
import OrderFormModal from "./OrderFormModal";
import { ProfileSkeleton } from "./SkeletonLoader";
import PressableScale from "./PressableScale";

const STAGE_ORDER = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
const LEAD_SOURCE_LABELS = {
  META_ADS: "Iklan Meta", GOOGLE_ADS: "Google Ads", WEBSITE_ORGANIC: "Website Organik",
  INSTAGRAM: "Instagram", WHATSAPP_DIRECT: "WA Langsung", REFERRAL: "Referral", OTHER: "Lainnya",
};
const KOTA_LIST = [
  "Jakarta Selatan", "Jakarta Barat", "Jakarta Utara", "Jakarta Pusat", "Jakarta Timur",
  "Bekasi", "Tangerang", "Bogor", "Depok", "Bandung", "Sukabumi", "Karawang",
];

// Sheet pilih 1 opsi dari daftar (dipakai Sumber Lead & Kota) — kecil,
// tidak perlu file terpisah. Komponen TERPISAH dari CustomerProfileContent
// (bukan nested closure), jadi butuh useTokens()+styles sendiri, tidak bisa
// pinjam punya parent.
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
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

// onOpenChat: opsional — CustomerDetailScreen kasih ini (tombol "Buka Chat"),
// CustomerSheet TIDAK (karena sheet itu sendiri sudah dibuka DARI chat yang
// sedang aktif, tombol buka-chat jadi tidak relevan di situ).
// reloadKey: opsional — komponen ini TETAP MOUNT di background selama sheet/
// screen induknya hidup (bottom sheet gorhom & stack screen React Navigation
// sama-sama TIDAK unmount-remount konten tiap kali dibuka/ditutup/di-blur),
// jadi useEffect([customerId]) SAJA tidak akan refetch kalau customerId-nya
// sama persis dengan sebelumnya. Naikkan reloadKey (mis. counter) tiap kali
// parent ingin data dipaksa fresh lagi (CustomerSheet: tiap open(); belum
// dipakai CustomerDetailScreen karena screen baru selalu instance baru).
export default function CustomerProfileContent({ customerId, onOpenChat, onCustomerLoaded, reloadKey }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  // Order yang sedang di-edit (tap kartu order -> buka OrderFormModal yang
  // SAMA persis dengan form "+ Order" tapi mode edit, bukan implementasi
  // form terpisah lagi di OrderCard.js — lihat catatan panjang di
  // OrderFormModal.js kenapa ini disatukan.
  const [editingOrder, setEditingOrder] = useState(null);
  const [showLeadSourcePicker, setShowLeadSourcePicker] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);
  // Merk Kasur/Ukuran Kasur/Jenis Layanan — satu sumber dipakai OrderFormModal
  // (bikin order baru) DAN OrderCard (edit order) di bawah, fetch sekali di
  // sini supaya tidak dobel-request tiap kartu order render.
  const [orderOptions, setOrderOptions] = useState({ jenisLayanan: [], merkKasur: [], ukuranKasur: [] });

  useEffect(() => {
    api.getOrderOptions().then(setOrderOptions).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const data = await api.getCustomer(customerId);
      setCustomer(data);
      onCustomerLoaded?.(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message || "Gagal memuat data pelanggan");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => { load(); }, [load, reloadKey]);

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

  // Dipanggil OrderCard setelah edit/ubah status/tandai komplain berhasil —
  // order.value & relasi (items/weightEntries) bisa berubah dari sisi
  // server (mis. auto-hitung ulang value), jadi refetch penuh lebih aman
  // daripada coba merge manual di client seperti handleOrderCreated di atas.
  async function refreshOrders() {
    try {
      const fresh = await api.getCustomer(customerId);
      setCustomer(fresh);
    } catch {}
  }

  function handleOrderDeleted(orderId) {
    setCustomer((c) => (c ? { ...c, orders: (c.orders || []).filter((o) => o.id !== orderId) } : c));
    setEditingOrder(null);
  }

  function closeOrderForm() {
    setShowOrderForm(false);
    setEditingOrder(null);
  }

  function handleOrderUpdated() {
    setEditingOrder(null);
    refreshOrders();
  }

  if (loading) {
    return <ProfileSkeleton />;
  }
  if (loadError && !customer) {
    return (
      <View style={styles.loadingWrap}>
        <AlertTriangle size={32} color={tokens.color.danger} strokeWidth={1.8} style={{ marginBottom: 8 }} />
        <Text style={styles.hint}>Gagal memuat data pelanggan</Text>
        <Text style={[styles.hint, { marginTop: 2 }]}>{loadError}</Text>
        <PressableScale style={styles.retryBtn} onPress={load}>
          <RefreshCw size={14} color="#fff" strokeWidth={2.2} style={{ marginRight: 6 }} />
          <Text style={styles.retryBtnText}>Coba Lagi</Text>
        </PressableScale>
      </View>
    );
  }
  if (!customer) return null;

  const orders = customer?.orders || [];
  const notes = customer?.notes || [];
  const totalValue = orders.reduce((sum, o) => sum + (o.value || 0), 0);

  return (
    <>
      {/* Header profil */}
      <View style={styles.profile}>
        <Avatar name={customer.name || customer.phone} size={72} avatarUrl={customer.profilePictureUrl} />
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
        {onOpenChat && (
          <TouchableOpacity style={styles.openChatBtn} onPress={() => onOpenChat(customer)}>
            <MessageCircle size={16} color="#fff" strokeWidth={2.2} style={{ marginRight: 6 }} />
            <Text style={styles.openChatBtnText}>Buka Chat</Text>
          </TouchableOpacity>
        )}
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

      <Section title="Kondisi Pelanggan">
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

      {/* Order — OrderCard urus expand/quick-status/hapus/komplain (view
          mode); tap "Edit" buka OrderFormModal yang SAMA dengan form
          "+ Order" tapi mode edit (lihat editingOrder + OrderFormModal di
          bawah), bukan implementasi form terpisah lagi. */}
      <Section title={`Order (${orders.length}) · Total ${formatRupiah(totalValue)}`}>
        {orders.length === 0 && <Text style={styles.hint}>Belum ada order</Text>}
        {orders.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            onRefresh={refreshOrders}
            onDeleted={handleOrderDeleted}
            onEdit={setEditingOrder}
          />
        ))}
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
          visible={showOrderForm || !!editingOrder}
          order={editingOrder}
          customerId={customerId}
          orderOptions={orderOptions}
          onClose={closeOrderForm}
          onCreated={handleOrderCreated}
          onUpdated={handleOrderUpdated}
          onDeleted={handleOrderDeleted}
        />
      )}
    </>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60, paddingHorizontal: 24 },
  retryBtn: {
    flexDirection: "row", alignItems: "center", backgroundColor: tokens.color.accent,
    borderRadius: tokens.radius.pill, paddingHorizontal: 18, paddingVertical: 10, marginTop: 16,
  },
  retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
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
  copyBtnRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 2 },
  copyBtnIcon: { marginRight: 4 },
  copyBtnText: { fontSize: 12, color: tokens.color.accent, fontWeight: "600" },
  openChatBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accent, borderRadius: tokens.radius.pill,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 14,
  },
  openChatBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  section: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: tokens.color.border },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: tokens.color.textMuted, marginBottom: 8, textTransform: "uppercase" },
  hint: { fontSize: 12, color: tokens.color.textMuted },
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
}
