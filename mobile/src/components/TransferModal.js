// Modal transfer percakapan ke sales lain — GET /users (endpoint existing)
// + PATCH /conversations/:id { assignedToId } (endpoint existing, sama
// dengan yang dipakai fitur "Ambil Alih" di web, cuma target user beda-beda
// bukan diri sendiri).
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, ScrollView, Alert,
} from "react-native";
import { UserCog, X } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import Avatar from "./Avatar";
import { bolehMenerimaTransfer, labelPeranTransfer } from "../lib/targetTransfer";
import { pilihanAwal, validasiKeputusan, buatPayloadTransfer, ringkasanKeputusan } from "../lib/kreditTransfer";
import { formatRupiah } from "../utils/format";

export default function TransferModal({ visible, conversationId, currentAssignedId, onClose, onTransferred }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  // Langkah 2 (kredit closing): muncul bila ada order atas nama pemegang lama. null = masih memilih orang.
  const [keputusan, setKeputusan] = useState(null); // { user, dari, penerimaSales, orders, pilihan, alasan }

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    api.getUsers().then((list) => setUsers((list || []).filter(bolehMenerimaTransfer))).catch(() => {}).finally(() => setLoading(false));
  }, [visible]);

  async function kirim(data) {
    setTransferring(true);
    try {
      const updated = await api.updateConversation(conversationId, data);
      onTransferred?.(updated);
      setKeputusan(null);
      onClose();
    } catch (err) {
      Alert.alert("Gagal transfer", err.message);
    } finally {
      setTransferring(false);
    }
  }

  async function handleTransfer(user) {
    if (transferring) return;
    setTransferring(true);
    let info;
    try {
      info = await api.getOrderTerdampakTransfer(conversationId, user.id);
    } catch (err) {
      Alert.alert("Gagal transfer", err.message);
      setTransferring(false);
      return;
    }
    if (!info.orders?.length) { setTransferring(false); await kirim({ assignedToId: user.id }); return; }
    setKeputusan({ user, dari: info.dari, penerimaSales: !!info.penerimaSales, orders: info.orders, pilihan: pilihanAwal(info.orders, info.penerimaSales), alasan: "" });
    setTransferring(false);
  }

  function tutup() { setKeputusan(null); onClose(); }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={tutup}>
      <View style={styles.overlay}>
        {keputusan ? (() => {
          const { user, dari, penerimaSales, orders, pilihan, alasan } = keputusan;
          const galat = validasiKeputusan({ pilihan, alasan, penerimaSales });
          const namaDari = dari?.name || "pemegang lama";
          return (
            <View style={styles.modal} testID="dialog-kredit-transfer">
              <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                  <UserCog size={16} color={tokens.color.textPrimary} strokeWidth={2} style={{ marginRight: 6 }} />
                  <Text style={styles.headerTitle}>Transfer ke {user.name}</Text>
                </View>
                <TouchableOpacity onPress={tutup}><X size={20} color={tokens.color.textSecondary} strokeWidth={2.2} /></TouchableOpacity>
              </View>
              <Text style={styles.penjelasan}>
                {orders.length} order masih atas nama {namaDari}. Tentukan kreditnya
                {penerimaSales ? ` — ikut ke ${user.name} atau tetap di ${namaDari}.` : `. ${user.name} bukan Sales, jadi semua order tetap di ${namaDari}.`}
              </Text>
              <ScrollView style={{ maxHeight: 280 }}>
                {orders.map((o) => {
                  const ikut = !!pilihan[o.id];
                  return (
                    <TouchableOpacity
                      key={o.id} style={styles.row} disabled={!penerimaSales || transferring}
                      onPress={() => setKeputusan({ ...keputusan, pilihan: { ...pilihan, [o.id]: !ikut } })}
                      accessibilityRole="checkbox" accessibilityState={{ checked: ikut, disabled: !penerimaSales }} testID={`ikut-${o.orderNumber}`}
                    >
                      <View style={[styles.kotak, ikut && styles.kotakOn, !penerimaSales && { opacity: 0.4 }]}>
                        {ikut ? <Text style={styles.centang}>✓</Text> : null}
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.rowName}>{o.orderNumber} · {formatRupiah(o.value)}</Text>
                        <Text style={styles.rowRole}>
                          {o.paymentStatus === "LUNAS" ? "Sudah lunas — komisi sudah terhitung" : o.paymentStatus === "DP" ? "DP" : "Belum bayar"}
                          {o.sumber === "PEMILIK_ORDER" ? " · pemilik order tercatat" : " · mengikuti pemegang chat"}
                        </Text>
                      </View>
                      <Text style={[styles.currentBadge, !ikut && styles.badgeTetap]}>{ikut ? "Ikut" : "Tetap"}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {penerimaSales && Object.values(pilihan).some(Boolean) ? (
                <TextInput
                  style={styles.input} value={alasan} maxLength={300} placeholder="Alasan memindahkan kredit (wajib)"
                  placeholderTextColor={tokens.color.textMuted} onChangeText={(v) => setKeputusan({ ...keputusan, alasan: v })} testID="alasan-kredit"
                />
              ) : null}
              <Text style={styles.ringkas}>{ringkasanKeputusan({ orders, pilihan, penerimaSales, namaPenerima: user.name })}</Text>
              {galat ? <Text style={styles.galat}>{galat}</Text> : null}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={styles.btnGhost} onPress={tutup} disabled={transferring}><Text style={styles.btnGhostText}>Batal</Text></TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnPrimary, (galat || transferring) && { opacity: 0.45 }]} disabled={!!galat || transferring} testID="kirim-transfer"
                  onPress={() => kirim(buatPayloadTransfer({ userId: user.id, orders, pilihan, alasan, penerimaSales }))}
                >
                  <Text style={styles.btnPrimaryText}>{transferring ? "Memproses…" : "Transfer"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })() : (
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
                  onPress={() => handleTransfer(u)}
                >
                  <Avatar name={u.name} avatarUrl={u.avatarUrl} size={36} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowName}>{u.name}</Text>
                    <Text style={styles.rowRole}>{labelPeranTransfer(u)}</Text>
                  </View>
                  {u.id === currentAssignedId && <Text style={styles.currentBadge}>Sekarang</Text>}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
        )}
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
    penjelasan: { fontSize: 13, lineHeight: 19, color: tokens.color.textSecondary, marginBottom: 8 },
    kotak: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: tokens.color.border, alignItems: "center", justifyContent: "center" },
    kotakOn: { backgroundColor: tokens.color.accent, borderColor: tokens.color.accent },
    centang: { color: "#fff", fontWeight: "800", fontSize: 14, lineHeight: 16 },
    badgeTetap: { color: tokens.color.textMuted, backgroundColor: tokens.color.subtle },
    input: { backgroundColor: tokens.color.subtle, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: tokens.color.textPrimary, marginTop: 8 },
    ringkas: { fontSize: 12, color: tokens.color.textSecondary, marginTop: 8 },
    galat: { fontSize: 12, color: tokens.color.danger, marginTop: 4 },
    btnPrimary: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.accent, borderRadius: 12, paddingVertical: 12 },
    btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
    btnGhost: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.subtle, borderRadius: 12, paddingVertical: 12 },
    btnGhostText: { color: tokens.color.textPrimary, fontWeight: "600", fontSize: 13 },
    currentBadge: {
      fontSize: 10, fontWeight: "700", color: tokens.color.accent, backgroundColor: tokens.color.accentSoft,
      paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    },
  });
}
