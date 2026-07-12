// Pipeline Board — tampilan kanban mini untuk tab Pelanggan (pengganti
// drag-and-drop antar kolom, yang rawan konflik dengan scroll horizontal di
// mobile — dipindah ke long-press → action sheet "Pindahkan ke...").
// Kolom horizontal snap-scroll (85% lebar layar), isi tiap kolom FlashList
// vertikal sendiri (windowing client-side, konsisten dengan pola windowing
// lain di app ini — GET /customers tidak paginated di backend).
import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, ScrollView, ActivityIndicator, Modal,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Check } from "lucide-react-native";
import Avatar from "./Avatar";
import { tokens } from "../constants/theme";
import { formatRupiah } from "../utils/format";
import { lightHaptic } from "../lib/haptics";

const SCREEN_W = Dimensions.get("window").width;
const COLUMN_WIDTH = Math.round(SCREEN_W * 0.85);
const COLUMN_GAP = 10;
const PAGE_SIZE = 15;

function daysSinceChat(lastMessageAt) {
  if (!lastMessageAt) return "Belum pernah chat";
  const days = Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 86_400_000);
  if (days <= 0) return "Chat hari ini";
  if (days === 1) return "1 hari sejak chat terakhir";
  return `${days} hari sejak chat terakhir`;
}

function PipelineCard({ customer, onPress, onLongPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} onLongPress={onLongPress} delayLongPress={350}>
      <View style={styles.cardTop}>
        <Avatar name={customer.name || customer.phone} size={36} avatarUrl={customer.profilePictureUrl} />
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>{customer.name || "Tanpa nama"}</Text>
          <Text style={styles.cardPhone} numberOfLines={1}>{customer.phone ? "+" + customer.phone : "-"}</Text>
        </View>
      </View>
      {customer.orderValue > 0 && (
        <Text style={styles.cardValue}>{formatRupiah(customer.orderValue)}</Text>
      )}
      <Text style={styles.cardMeta} numberOfLines={1}>{daysSinceChat(customer.lastMessageAt)}</Text>
    </TouchableOpacity>
  );
}

function StageColumn({ stageKey, label, color, customers, onCardPress, onLongPressCard }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visible = customers.slice(0, visibleCount);

  return (
    <View style={[styles.column, { width: COLUMN_WIDTH, marginRight: COLUMN_GAP }]}>
      <View style={[styles.columnHeader, { backgroundColor: color + "18" }]}>
        <View style={[styles.columnDot, { backgroundColor: color }]} />
        <Text style={[styles.columnTitle, { color }]} numberOfLines={1}>{label}</Text>
        <Text style={styles.columnCount}>{customers.length}</Text>
      </View>
      {customers.length === 0 ? (
        <View style={styles.columnEmpty}>
          <Text style={styles.columnEmptyText}>Tidak ada pelanggan</Text>
        </View>
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <PipelineCard
              customer={item}
              onPress={() => onCardPress(item)}
              onLongPress={() => onLongPressCard(item, stageKey)}
            />
          )}
          estimatedItemSize={92}
          onEndReached={() => setVisibleCount((v) => Math.min(v + PAGE_SIZE, customers.length))}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            visibleCount < customers.length ? (
              <ActivityIndicator style={{ marginVertical: 12 }} color={tokens.color.accent} />
            ) : null
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}
    </View>
  );
}

// customersByStage: { LEAD: [...], QUALIFIED: [...], ... }
// stageOrder: array kunci stage, urut tampil
// pipelineLabels/pipelineColors: { STAGE: label/color }
export default function PipelineBoard({
  customersByStage, stageOrder, pipelineLabels, pipelineColors, onCardPress, onMoveStage,
}) {
  const [moveTarget, setMoveTarget] = useState(null); // { customer, fromStage } | null
  const [moving, setMoving] = useState(false);

  function handleLongPressCard(customer, fromStage) {
    lightHaptic();
    setMoveTarget({ customer, fromStage });
  }

  async function handleMoveTo(newStage) {
    if (!moveTarget || moving) return;
    const { customer, fromStage } = moveTarget;
    if (newStage === fromStage) { setMoveTarget(null); return; }
    setMoving(true);
    try {
      await onMoveStage(customer, newStage);
      lightHaptic();
    } finally {
      setMoving(false);
      setMoveTarget(null);
    }
  }

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={COLUMN_WIDTH + COLUMN_GAP}
        decelerationRate="fast"
        snapToAlignment="start"
        contentContainerStyle={styles.boardContent}
      >
        {stageOrder.map((stageKey) => (
          <StageColumn
            key={stageKey}
            stageKey={stageKey}
            label={pipelineLabels[stageKey] || stageKey}
            color={pipelineColors[stageKey] || tokens.color.textMuted}
            customers={customersByStage[stageKey] || []}
            onCardPress={onCardPress}
            onLongPressCard={handleLongPressCard}
          />
        ))}
      </ScrollView>

      <Modal visible={!!moveTarget} transparent animationType="fade" onRequestClose={() => setMoveTarget(null)}>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => !moving && setMoveTarget(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              Pindahkan "{moveTarget?.customer?.name || moveTarget?.customer?.phone || "Pelanggan"}" ke...
            </Text>
            {stageOrder.map((stageKey) => {
              const isCurrent = stageKey === moveTarget?.fromStage;
              return (
                <TouchableOpacity
                  key={stageKey}
                  style={styles.sheetItem}
                  onPress={() => handleMoveTo(stageKey)}
                  disabled={moving}
                >
                  <View style={[styles.sheetDot, { backgroundColor: pipelineColors[stageKey] }]} />
                  <Text style={styles.sheetItemText}>{pipelineLabels[stageKey] || stageKey}</Text>
                  {isCurrent && <Check size={16} color={tokens.color.accent} strokeWidth={2.4} style={{ marginLeft: "auto" }} />}
                </TouchableOpacity>
              );
            })}
            {moving && <ActivityIndicator style={{ marginTop: 10 }} color={tokens.color.accent} />}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  boardContent: { paddingHorizontal: 16, paddingBottom: 16 },
  column: { backgroundColor: tokens.color.card, borderRadius: tokens.radius.card, overflow: "hidden", ...tokens.shadow.soft },
  columnHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  columnDot: { width: 8, height: 8, borderRadius: 4 },
  columnTitle: { flex: 1, fontSize: 13, fontWeight: "700" },
  columnCount: { fontSize: 12, fontWeight: "700", color: tokens.color.textMuted },
  columnEmpty: { padding: 24, alignItems: "center" },
  columnEmptyText: { fontSize: 12, color: tokens.color.textMuted },
  card: {
    marginHorizontal: 10, marginTop: 10, backgroundColor: tokens.color.subtle, borderRadius: 12, padding: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center" },
  cardBody: { flex: 1, marginLeft: 8 },
  cardName: { fontSize: 13, fontWeight: "600", color: tokens.color.textPrimary },
  cardPhone: { fontSize: 11, color: tokens.color.textSecondary, marginTop: 1 },
  cardValue: { fontSize: 12, fontWeight: "700", color: tokens.color.success, marginTop: 6 },
  cardMeta: { fontSize: 10, color: tokens.color.textMuted, marginTop: 4 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: tokens.color.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18 },
  sheetTitle: { fontSize: 14, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 12 },
  sheetItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.color.border,
  },
  sheetDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  sheetItemText: { fontSize: 14, color: tokens.color.textPrimary },
});
