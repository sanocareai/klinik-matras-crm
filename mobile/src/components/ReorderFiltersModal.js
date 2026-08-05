// Atur urutan tab filter Inbox — GAP yang diperbaiki (5 Agustus 2026): versi
// web sudah bisa digeser (drag, framer-motion Reorder) tapi mobile belum ada
// jalan sama sekali untuk mengubah urutan tab ("Milik Saya" dkk), padahal
// tab itu sendiri hidup di dalam ScrollView horizontal yang SUDAH punya
// gesture pan sendiri (scroll) — drag-reorder inline di situ berisiko
// bentrok gesture (pan reorder vs pan scroll) tanpa perangkat asli untuk
// diuji langsung. Modal terpisah ini (tombol atas/bawah, bukan drag) 100%
// aman dari konflik gesture manapun, tetap memberi kemampuan yang sama:
// urutan tersimpan per-perangkat (AsyncStorage), bukan cuma sesi ini.
import React from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity } from "react-native";
import { ChevronUp, ChevronDown, X, GripVertical } from "lucide-react-native";
import { useTokens } from "../constants/theme";
import PressableScale from "./PressableScale";

export default function ReorderFiltersModal({ visible, tabs, order, onChangeOrder, onClose }) {
  const tokens = useTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);
  const labelByKey = React.useMemo(() => Object.fromEntries(tabs.map((t) => [t.key, t.label])), [tabs]);

  function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChangeOrder(next);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Urutan Filter Inbox</Text>
            <PressableScale style={styles.closeBtn} onPress={onClose}>
              <X size={18} color={tokens.color.textPrimary} strokeWidth={2} />
            </PressableScale>
          </View>
          <Text style={styles.sub}>Atur tab mana yang tampil duluan — tersimpan di HP ini saja.</Text>

          <View style={styles.list}>
            {order.map((key, i) => (
              <View key={key} style={styles.row}>
                <GripVertical size={16} color={tokens.color.textMuted} strokeWidth={1.8} />
                <Text style={styles.rowLabel}>{labelByKey[key] || key}</Text>
                <View style={styles.rowBtns}>
                  <TouchableOpacity
                    style={[styles.arrowBtn, i === 0 && styles.arrowBtnDisabled]}
                    disabled={i === 0}
                    onPress={() => move(i, -1)}
                  >
                    <ChevronUp size={16} color={i === 0 ? tokens.color.textMuted : tokens.color.textPrimary} strokeWidth={2} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.arrowBtn, i === order.length - 1 && styles.arrowBtnDisabled]}
                    disabled={i === order.length - 1}
                    onPress={() => move(i, 1)}
                  >
                    <ChevronDown size={16} color={i === order.length - 1 ? tokens.color.textMuted : tokens.color.textPrimary} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          <PressableScale style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Selesai</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: tokens.color.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 20, paddingBottom: 32,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
    closeBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    sub: { fontSize: 12.5, color: tokens.color.textMuted, marginTop: 4, marginBottom: 16 },
    list: { gap: 4 },
    row: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: tokens.color.card,
    },
    rowLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: tokens.color.textPrimary },
    rowBtns: { flexDirection: "row", gap: 4 },
    arrowBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8 },
    arrowBtnDisabled: { opacity: 0.35 },
    doneBtn: {
      marginTop: 18, backgroundColor: tokens.color.accent, borderRadius: 14,
      paddingVertical: 13, alignItems: "center",
    },
    doneBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  });
}
