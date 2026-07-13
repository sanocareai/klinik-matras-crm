// Riwayat LENGKAP siapa saja yang pernah menangani percakapan ini — versi
// mobile dari frontend/src/features/inbox/components/ChatWindow/
// HandoverHistoryBanner.jsx, sumber data & endpoint SAMA PERSIS
// (GET /conversations/:id/handover-history).
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ChevronDown, ChevronUp, History } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";

function formatEventTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }) + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export default function HandoverHistoryBanner({ conversationId }) {
  const [events, setEvents] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setEvents(null);
    setExpanded(false);
    if (!conversationId) return;
    api.getHandoverHistory(conversationId).then(setEvents).catch(() => setEvents([]));
  }, [conversationId]);

  if (!events || events.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.toggle} onPress={() => setExpanded((v) => !v)}>
        <History size={13} color={tokens.color.textMuted} strokeWidth={2} />
        <Text style={styles.toggleText}>Riwayat Penanganan ({events.length})</Text>
        {expanded ? <ChevronUp size={14} color={tokens.color.textMuted} /> : <ChevronDown size={14} color={tokens.color.textMuted} />}
      </TouchableOpacity>
      {expanded && (
        <View style={styles.list}>
          {events.map((e) => (
            <View key={e.id} style={styles.item}>
              <Text style={styles.itemText}>
                {e.fromUser
                  ? <>Diambil alih dari <Text style={styles.bold}>{e.fromUser.name}</Text> oleh <Text style={styles.bold}>{e.toUser.name}</Text></>
                  : <><Text style={styles.bold}>{e.toUser.name}</Text> mengambil percakapan ini</>}
                {e.reason === "transfer" ? " (transfer admin)" : ""}
              </Text>
              <Text style={styles.itemTime}>{formatEventTime(e.createdAt)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: tokens.color.subtle, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.border },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  toggleText: { flex: 1, fontSize: 12, fontWeight: "500", color: tokens.color.textMuted },
  list: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  itemText: { flex: 1, fontSize: 12, color: tokens.color.textSecondary },
  bold: { fontWeight: "700", color: tokens.color.textPrimary },
  itemTime: { fontSize: 11, color: tokens.color.textMuted, flexShrink: 0 },
});
