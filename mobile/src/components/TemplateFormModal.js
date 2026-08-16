// Form buat/edit Template Pesan — GAP (fix): dulu template CRUD cuma bisa
// dari web Pengaturan; backend (bisaKelola() di templates.js) sebenarnya
// SUDAH izinkan siapa pun kelola template PRIBADINYA sendiri (isShared=false),
// cuma "jadi Template Tim" yang admin-only — jadi form ini dibuka untuk semua
// role, toggle "Template Tim" saja yang di-gate ADMIN (server juga menegakkan
// ulang, ini cuma UI gating tambahan, bukan satu-satunya proteksi).
import React, { useEffect, useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Switch } from "react-native";
import { X } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { useSheetMaxHeight } from "../lib/useSheetMaxHeight";
import { useAuth } from "../context/AuthContext";

const KATEGORI_OPTIONS = ["pembukaan", "follow_up", "penawaran", "konfirmasi", "penutupan", "lainnya"];
const KATEGORI_LABELS = {
  pembukaan: "Pembukaan", follow_up: "Follow Up", penawaran: "Penawaran",
  konfirmasi: "Konfirmasi", penutupan: "Penutupan", lainnya: "Lainnya",
};

export default function TemplateFormModal({ visible, template, onClose, onSaved }) {
  // Sheet ikut mengecil saat keyboard muncul — tanpa ini kolom isian &
  // tombol di bawahnya tertutup keyboard (lihat lib/useSheetMaxHeight.js).
  // overlayStyle MENDORONG sheet naik ke atas keyboard; maxHeight
  // membatasi tingginya. Keduanya wajib bersama — lihat lib/useSheetMaxHeight.js.
  const { maxHeight: sheetMaxHeight, overlayStyle } = useSheetMaxHeight(0.88);
  const tokens = useTokens();
  const styles = createStyles(tokens);
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isEdit = !!template;

  const [nama, setNama] = useState("");
  const [kategori, setKategori] = useState("lainnya");
  const [isi, setIsi] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setNama(template?.nama || "");
    setKategori(template?.kategori || "lainnya");
    setIsi(template?.isi || "");
    setIsShared(!!template?.isShared);
  }, [visible, template]);

  async function handleSave() {
    if (!nama.trim() || !isi.trim()) {
      Alert.alert("Lengkapi dulu", "Nama dan isi template wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const payload = { nama: nama.trim(), kategori, isi: isi.trim(), isShared };
      if (isEdit) {
        await api.updateTemplate(template.id, payload);
      } else {
        await api.createTemplate(payload);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      Alert.alert("Gagal menyimpan template", err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, overlayStyle]}>
        <View style={[styles.modal, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{isEdit ? "Edit Template" : "Template Baru"}</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Nama</Text>
          <TextInput
            style={styles.input}
            placeholder="mis. Salam Pembuka"
            placeholderTextColor={tokens.color.textMuted}
            value={nama}
            onChangeText={setNama}
          />

          <Text style={styles.label}>Kategori</Text>
          <View style={styles.chipRow}>
            {KATEGORI_OPTIONS.map((k) => {
              const active = kategori === k;
              return (
                <TouchableOpacity
                  key={k}
                  style={[styles.chip, active && { backgroundColor: tokens.color.accentSoft, borderColor: tokens.color.accent }]}
                  onPress={() => setKategori(k)}
                >
                  <Text style={[styles.chipText, active && { color: tokens.color.accent }]}>{KATEGORI_LABELS[k]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Isi Pesan</Text>
          <Text style={styles.hint}>Variabel tersedia: {"{nama_customer}"} · {"{nomor_wa}"} · {"{kota}"}</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Tulis isi template…"
            placeholderTextColor={tokens.color.textMuted}
            value={isi}
            onChangeText={setIsi}
            multiline
          />

          {isAdmin && (
            <View style={styles.sharedRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Jadikan Template Tim</Text>
                <Text style={styles.hint}>Semua sales bisa pakai (bukan cuma kamu).</Text>
              </View>
              <Switch
                value={isShared}
                onValueChange={setIsShared}
                trackColor={{ false: tokens.color.border, true: tokens.color.accentSoft }}
                thumbColor={isShared ? tokens.color.accent : "#f4f3f4"}
              />
            </View>
          )}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Simpan</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    modal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 28, maxHeight: "88%" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    headerTitle: { fontWeight: "700", fontSize: 16, color: tokens.color.textPrimary },
    label: { fontSize: 11, fontWeight: "700", color: tokens.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
    hint: { fontSize: 11, color: tokens.color.textMuted, marginBottom: 6 },
    input: {
      backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
      fontSize: 14, color: tokens.color.textPrimary, marginBottom: 14,
    },
    textarea: { minHeight: 90, textAlignVertical: "top" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: tokens.color.border, backgroundColor: tokens.color.card },
    chipText: { fontSize: 11.5, fontWeight: "600", color: tokens.color.textSecondary },
    sharedRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
    saveBtn: {
      backgroundColor: tokens.color.accent, borderRadius: tokens.radius.pill, paddingVertical: 12,
      alignItems: "center", marginTop: 4,
    },
    saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
