// Modal transfer percakapan ke sales lain — GET /users (endpoint existing)
// + PATCH /conversations/:id { assignedToId } (endpoint existing, sama
// dengan yang dipakai fitur "Ambil Alih" di web, cuma target user beda-beda
// bukan diri sendiri).
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, Alert,
} from "react-native";
import { UserCog, X } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import Avatar from "./Avatar";

export default function TransferModal({ visible, conversationId, currentAssignedId, onClose, onTransferred }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api.getUsers().then((list) => setUsers(list || [])).catch(() => {}).finally(() => setLoading(false));
  }, [visible]);

  async function handleTransfer(userId) {
    if (transferring) return;
    setTransferring(true);
    try {
      const updated = await api.updateConversation(conversationId, { assignedToId: userId });
      onTransferred?.(updated);
      onClose();
    } catch (err) {
      Alert.alert("Gagal transfer", err.message);
    } finally {
      setTransferring(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <UserCog size={16} color={tokens.color.textPrimary} strokeWidth={2} style={{ marginRight: 6 }} />
              <Text style={styles.headerTitle}>Transfer Percakapan</Text>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} /></TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={tokens.color.accent} />
          ) : (
            <FlatList
              data={users}
              keyExtractor={(u) => u.id}
              style={{ maxHeight: 360 }}
              ListEmptyComponent={<Text style={styles.empty}>Tidak ada user lain</Text>}
              renderItem={({ item: u }) => (
                <TouchableOpacity
                  style={styles.row}
                  disabled={transferring || u.id === currentAssignedId}
                  onPress={() => handleTransfer(u.id)}
                >
                  <Avatar name={u.name} avatarUrl={u.avatarUrl} size={36} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowName}>{u.name}</Text>
                    <Text style={styles.rowRole}>{u.role === "ADMIN" ? "Admin" : "Sales"}</Text>
                  </View>
                  {u.id === currentAssignedId && <Text style={styles.currentBadge}>Sekarang</Text>}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    modal: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: "80%" },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    headerTitleRow: { flexDirection: "row", alignItems: "center" },
    headerTitle: { fontWeight: "700", fontSize: 15, color: tokens.color.textPrimary },
    closeText: { fontSize: 16, color: tokens.color.textSecondary, padding: 4 },
    empty: { textAlign: "center", color: tokens.color.textMuted, marginTop: 24 },
    row: {
      flexDirection: "row", alignItems: "center", paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    rowName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
    rowRole: { fontSize: 11, color: tokens.color.textMuted },
    currentBadge: {
      fontSize: 10, fontWeight: "700", color: tokens.color.accent, backgroundColor: tokens.color.accentSoft,
      paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    },
  });
}
