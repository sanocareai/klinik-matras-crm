// Template Pesan (quick reply) picker — dibuka dari tombol di composer chat.
// BUG (gap): mobile sudah punya api.getTemplates() sejak lama tapi TIDAK
// PERNAH dipakai di UI manapun — sales cuma bisa pakai template kalau balas
// dari CRM web, padahal template dikelola satu tempat (backend, dibuat lewat
// Pengaturan > Template Pesan di web, adminOnly). Komponen ini menutup gap
// itu: read+insert-only (SAMA seperti Composer.jsx web — TemplatePicker di
// sana juga cuma pilih & sisip, bukan CRUD; kelola/buat/hapus template TETAP
// cuma di web Pengaturan, sengaja tidak diport ke sini karena section itu
// adminOnly, sales tidak butuh & tidak seharusnya bisa ubah template dari HP).
//
// Data model & variable substitution SAMA PERSIS dengan
// frontend/src/features/inbox/components/ChatWindow/Composer.jsx#TemplatePicker
// — {nama_customer}/{nomor_wa}/{kota} diganti data pelanggan aktif sebelum
// disisipkan ke composer, supaya hasilnya identik dgn yang dilihat di web.
import React, { useEffect, useMemo, useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList } from "react-native";
import { X, MessageSquare } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";

const KATEGORI_LABELS = {
  pembukaan: "Pembukaan", follow_up: "Follow Up", penawaran: "Penawaran",
  konfirmasi: "Konfirmasi", penutupan: "Penutupan", lainnya: "Lainnya",
};
const KATEGORI_COLORS = {
  pembukaan:  { bg: "#dbeafe", color: "#1e40af" },
  follow_up:  { bg: "#ede9fe", color: "#5b21b6" },
  penawaran:  { bg: "#dcfce7", color: "#166534" },
  konfirmasi: { bg: "#fef9c3", color: "#854d0e" },
  penutupan:  { bg: "#fee2e2", color: "#991b1b" },
  lainnya:    { bg: "#f3f4f6", color: "#374151" },
};

function applyVariables(text, customer) {
  return text
    .replace(/\{nama_customer\}/g, customer?.name || "Kak")
    .replace(/\{nomor_wa\}/g,      customer?.phone || "")
    .replace(/\{kota\}/g,          customer?.city  || "");
}

export default function TemplatePickerSheet({ visible, customer, onSelect, onClose }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setLoading(true);
    api.getTemplates().then(setTemplates).catch(() => setTemplates([])).finally(() => setLoading(false));
  }, [visible]);

  const q = search.trim().toLowerCase();
  const filtered = templates.filter((t) =>
    !q || t.nama.toLowerCase().includes(q) || t.isi.toLowerCase().includes(q)
  );
  const grouped = Object.keys(KATEGORI_LABELS)
    .map((kat) => ({ kat, items: filtered.filter((t) => t.kategori === kat) }))
    .filter((g) => g.items.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Pilih Template</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.search}
            placeholder="Cari template…"
            placeholderTextColor={tokens.color.textMuted}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />

          <FlatList
            data={grouped}
            keyExtractor={(g) => g.kat}
            style={{ maxHeight: 420 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              !loading ? (
                <View style={styles.emptyWrap}>
                  <MessageSquare size={28} color={tokens.color.textMuted} strokeWidth={1.8} />
                  <Text style={styles.emptyText}>
                    {templates.length === 0 ? "Belum ada template — minta admin buat di CRM web." : "Tidak ada template cocok."}
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item: group }) => (
              <View>
                <Text style={styles.catLabel}>{KATEGORI_LABELS[group.kat]}</Text>
                {group.items.map((tpl) => {
                  const c = KATEGORI_COLORS[tpl.kategori] || KATEGORI_COLORS.lainnya;
                  const preview = applyVariables(tpl.isi, customer);
                  return (
                    <TouchableOpacity
                      key={tpl.id}
                      style={styles.item}
                      onPress={() => { onSelect(preview); onClose(); }}
                    >
                      <View style={styles.itemHead}>
                        <Text style={[styles.badge, { backgroundColor: c.bg, color: c.color }]}>{KATEGORI_LABELS[tpl.kategori]}</Text>
                        <Text style={styles.itemName}>{tpl.nama}</Text>
                      </View>
                      <Text style={styles.itemPreview} numberOfLines={2}>{preview}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 24, maxHeight: "80%" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    headerTitle: { fontWeight: "700", fontSize: 15, color: tokens.color.textPrimary },
    search: {
      backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
      fontSize: 14, color: tokens.color.textPrimary, marginBottom: 8,
    },
    catLabel: {
      fontSize: 10, fontWeight: "700", color: tokens.color.textMuted, textTransform: "uppercase",
      letterSpacing: 0.4, marginTop: 12, marginBottom: 6,
    },
    item: { backgroundColor: tokens.color.subtle, borderRadius: 10, padding: 10, marginBottom: 6 },
    itemHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
    badge: { fontSize: 10, fontWeight: "700", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
    itemName: { fontSize: 12.5, fontWeight: "600", color: tokens.color.textPrimary },
    itemPreview: { fontSize: 12, color: tokens.color.textSecondary },
    emptyWrap: { alignItems: "center", paddingVertical: 32, gap: 8 },
    emptyText: { fontSize: 12.5, color: tokens.color.textMuted, textAlign: "center", paddingHorizontal: 24 },
  });
}
