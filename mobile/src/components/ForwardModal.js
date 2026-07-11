// Modal teruskan pesan — cari percakapan tujuan, kirim via endpoint existing
// (POST /conversations/:id/forward). Pola SAMA dengan ForwardModal di
// frontend/src/features/inbox/components/ChatWindow/index.jsx.
import React, { useEffect, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert,
} from "react-native";
import { Forward, X } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import Avatar from "./Avatar";

export default function ForwardModal({ visible, message, onClose }) {
  const [convs, setConvs] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [forwarding, setForwarding] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api.getConversations({}).then((res) => { setConvs(res.data || []); setLoading(false); }).catch(() => setLoading(false));
  }, [visible]);

  const q = search.trim().toLowerCase();
  const filtered = convs.filter((c) => {
    if (!q) return true;
    return (c.customer?.name || "").toLowerCase().includes(q)
      || (c.customer?.phone || "").includes(q)
      || (c.groupName || "").toLowerCase().includes(q);
  });

  async function handleForward(targetConvId) {
    if (forwarding || !message) return;
    setForwarding(true);
    try {
      await api.forwardMessage(message.conversationId, message.id, targetConvId);
      onClose();
    } catch (err) {
      Alert.alert("Gagal teruskan pesan", err.message);
    } finally {
      setForwarding(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Forward size={16} color={tokens.color.textPrimary} strokeWidth={2} style={{ marginRight: 6 }} />
              <Text style={styles.headerTitle}>Teruskan Pesan</Text>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} /></TouchableOpacity>
          </View>
          {message && (
            <View style={styles.quotePreview}>
              <Text style={styles.quoteText} numberOfLines={2}>
                {message.content || (message.mediaType ? `[${message.mediaType}]` : "Pesan")}
              </Text>
            </View>
          )}
          <TextInput
            style={styles.search}
            placeholder="Cari percakapan…"
            placeholderTextColor={tokens.color.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={tokens.color.accent} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.id}
              style={{ maxHeight: 360 }}
              ListEmptyComponent={<Text style={styles.empty}>Tidak ditemukan</Text>}
              renderItem={({ item: c }) => {
                const isGroup = c.type === "GROUP";
                const name = isGroup ? (c.groupName || "Grup WhatsApp") : (c.customer?.name || c.customer?.phone || "Pelanggan");
                return (
                  <TouchableOpacity style={styles.row} disabled={forwarding} onPress={() => handleForward(c.id)}>
                    <Avatar name={name} isGroup={isGroup} size={36} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                      {c.customer?.phone && <Text style={styles.rowPhone}>{c.customer.phone}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "80%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  headerTitleRow: { flexDirection: "row", alignItems: "center" },
  headerTitle: { fontWeight: "700", fontSize: 15, color: tokens.color.textPrimary },
  closeText: { fontSize: 16, color: tokens.color.textSecondary, padding: 4 },
  quotePreview: {
    backgroundColor: tokens.color.subtle, borderLeftWidth: 3, borderLeftColor: tokens.color.accent,
    borderRadius: 8, padding: 10, marginBottom: 10,
  },
  quoteText: { fontSize: 12, color: tokens.color.textSecondary },
  search: {
    backgroundColor: tokens.color.subtle, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9,
    fontSize: 14, color: tokens.color.textPrimary, marginBottom: 8,
  },
  empty: { textAlign: "center", color: tokens.color.textMuted, marginTop: 24 },
  row: {
    flexDirection: "row", alignItems: "center", paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
  },
  rowName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
  rowPhone: { fontSize: 11, color: tokens.color.textMuted },
});
