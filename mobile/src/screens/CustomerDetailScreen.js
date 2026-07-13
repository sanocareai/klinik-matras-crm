// CustomerDetailScreen — full screen profil pelanggan, dibuka dari tab
// Pelanggan (PelangganScreen.js). Konten profil (avatar, pipeline, info,
// order, catatan) SAMA PERSIS dengan CustomerSheet.js (bottom sheet dari
// header ChatScreen) — reuse CustomerProfileContent.js supaya tidak
// duplikasi logic, cuma beda chrome (header+back di sini vs handle
// indicator bottom sheet di sana) dan tombol "Buka Chat" (cuma relevan di
// sini — CustomerSheet dibuka DARI chat yang sudah aktif).
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useTokens, useIsDarkMode } from "../constants/theme";
import { api } from "../api";
import CustomerProfileContent from "../components/CustomerProfileContent";

export default function CustomerDetailScreen({ route, navigation }) {
  const tokens = useTokens();
  const isDark = useIsDarkMode();
  const styles = useMemo(() => createStyles(tokens, isDark), [tokens, isDark]);
  const { customerId, name: routeName, phone: routePhone } = route.params;
  const [headerName, setHeaderName] = useState(routeName || routePhone || "Pelanggan");
  const [openingChat, setOpeningChat] = useState(false);

  async function handleOpenChat(customer) {
    if (openingChat) return;
    setOpeningChat(true);
    try {
      const conversations = await api.getCustomerConversations(customerId);
      const target = conversations?.[0]; // sudah urut lastMessageAt desc (lihat backend)
      if (!target) {
        Alert.alert(
          "Belum Ada Percakapan",
          "Pelanggan ini belum pernah chat WhatsApp — CRM cuma bisa membalas percakapan yang sudah ada, tidak bisa memulai chat baru."
        );
        return;
      }
      navigation.navigate("ChatRoom", {
        conversationId: target.id,
        name: customer?.name || customer?.phone || headerName,
        isGroup: false,
        customerId,
      });
    } catch (err) {
      Alert.alert("Gagal buka chat", err.message);
    } finally {
      setOpeningChat(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={26} color={tokens.color.textPrimary} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{headerName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <CustomerProfileContent
          customerId={customerId}
          onOpenChat={handleOpenChat}
          onCustomerLoaded={(c) => setHeaderName(c.name || c.phone || "Pelanggan")}
        />
      </ScrollView>

      {openingChat && (
        <View style={styles.openingOverlay}>
          <ActivityIndicator color={tokens.color.accent} size="large" />
        </View>
      )}
    </View>
  );
}

function createStyles(tokens, isDark) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.color.bg },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: tokens.color.border,
      backgroundColor: tokens.color.card,
    },
    backBtn: { paddingHorizontal: 8, width: 40 },
    headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700", color: tokens.color.textPrimary },
    openingOverlay: {
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)", alignItems: "center", justifyContent: "center",
    },
  });
}
