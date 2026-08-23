// Modal "Filter per Sales" — GET /users (endpoint existing, sama yang
// dipakai TransferModal.js) untuk daftar orang, lalu memilih salah satu
// cuma mengubah state LOKAL (conversationStore.salesFilter), TIDAK memanggil
// endpoint apa pun — beda dari TransferModal yang benar-benar memindahkan
// kepemilikan (PATCH /conversations/:id). Ini murni menyaring TAMPILAN
// daftar percakapan yang sudah ada.
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList,
} from "react-native";
import { Users, X, Check } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import Avatar from "./Avatar";

// filterRole (opsional, mis. "SALES") — batasi daftar ke user yang PUNYA
// role itu di array `roles` (multi-role, D-010 — lihat GET /users di
// backend/src/routes/users.js yang selalu fallback ke [role] tunggal kalau
// belum ada baris UserRole). Dipakai OrdersScreen.js supaya pilihan cuma
// sales sungguhan (sama seperti dropdown "Filter Sales" di web
// frontend/src/pages/Orders.jsx yang menyaring `rolesOf(u).includes("SALES")`).
// Kosongkan untuk tampilkan SEMUA user (dipakai ChatListScreen.js — chat bisa
// dipegang admin juga, bukan cuma sales).
export default function SalesFilterModal({ visible, selectedId, onClose, onSelect, filterRole }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api.getUsers()
      .then((list) => {
        const all = list || [];
        setUsers(filterRole ? all.filter((u) => (u.roles || [u.role]).includes(filterRole)) : all);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible, filterRole]);

  function pick(user) {
    onSelect(user); // null = "Semua Sales" (hapus filter)
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Users size={16} color={tokens.color.textPrimary} strokeWidth={2} style={{ marginRight: 6 }} />
              <Text style={styles.headerTitle}>Filter per Sales</Text>
            </View>
            <TouchableOpacity onPress={onClose}><X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} /></TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={tokens.color.accent} />
          ) : (
            <FlatList
              data={users}
              keyExtractor={(u) => u.id}
              style={{ maxHeight: 420 }}
              ListHeaderComponent={
                <TouchableOpacity style={styles.row} onPress={() => pick(null)}>
                  <View style={[styles.allIcon, { backgroundColor: tokens.color.accentSoft }]}>
                    <Users size={16} color={tokens.color.accent} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowName}>Semua Sales</Text>
                    <Text style={styles.rowRole}>Tidak difilter berdasarkan pemegang</Text>
                  </View>
                  {!selectedId && <Check size={18} color={tokens.color.accent} strokeWidth={2.4} />}
                </TouchableOpacity>
              }
              renderItem={({ item: u }) => (
                <TouchableOpacity style={styles.row} onPress={() => pick(u)}>
                  <Avatar name={u.name} avatarUrl={u.avatarUrl} size={36} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowName}>{u.name}</Text>
                    <Text style={styles.rowRole}>{u.role === "ADMIN" ? "Admin" : "Sales"}</Text>
                  </View>
                  {u.id === selectedId && <Check size={18} color={tokens.color.accent} strokeWidth={2.4} />}
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
    row: {
      flexDirection: "row", alignItems: "center", paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border,
    },
    allIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    rowName: { fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
    rowRole: { fontSize: 11, color: tokens.color.textMuted },
  });
}
