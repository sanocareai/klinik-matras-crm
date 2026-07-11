// Banner kecil di atas layar saat notifikasi pesan masuk diterima selagi
// app foreground (bukan chat yang sedang dibuka — itu disupresi total di
// push.js, lihat catatan di sana). Tap → buka chat terkait, auto-hilang
// setelah beberapa detik.
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "../constants/theme";
import { useNotificationBannerStore } from "../store/notificationBannerStore";
import { navigateToChat } from "../lib/navigationRef";

const AUTO_HIDE_MS = 4000;

export default function InAppBanner() {
  const banner = useNotificationBannerStore((s) => s.banner);
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const hideTimerRef = useRef(null);

  useEffect(() => {
    clearTimeout(hideTimerRef.current);
    if (!banner) return;

    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
    hideTimerRef.current = setTimeout(() => dismiss(), AUTO_HIDE_MS);
    return () => clearTimeout(hideTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner]);

  function dismiss() {
    Animated.timing(translateY, { toValue: -120, duration: 180, useNativeDriver: true }).start(() => {
      useNotificationBannerStore.getState().hide();
    });
  }

  function handlePress() {
    if (!banner) return;
    const { conversationId, customerId, isGroup, title } = banner;
    dismiss();
    navigateToChat({ conversationId, name: title, isGroup, customerId });
  }

  if (!banner) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: insets.top + 6, transform: [{ translateY }] }]}
    >
      <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={handlePress}>
        <Text style={styles.title} numberOfLines={1}>{banner.title}</Text>
        <Text style={styles.body} numberOfLines={2}>{banner.body}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 999, paddingHorizontal: 12,
  },
  card: {
    backgroundColor: tokens.color.card, borderRadius: tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: tokens.color.border,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: { fontSize: 14, fontWeight: "700", color: tokens.color.textPrimary, marginBottom: 2 },
  body: { fontSize: 13, color: tokens.color.textSecondary },
});
