// Skeleton loading — dipakai Inbox/Chat/CustomerSheet selagi data pertama
// kali dimuat, gantikan spinner polos. Primitif `Bone` = kotak pulsing
// opacity (Animated bawaan RN, BUKAN reanimated — ini dipakai di dalam list
// yang juga di-virtualized FlashList, plain Animated.loop lebih ringan &
// tidak perlu worklet per instance).
import React, { useEffect, useMemo, useRef } from "react";
import { View, Animated, StyleSheet } from "react-native";
import { useTokens } from "../constants/theme";

function Bone({ width, height, radius = 8, style }) {
  const tokens = useTokens();
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: tokens.color.subtle, opacity },
        style,
      ]}
    />
  );
}

// 1 baris skeleton Inbox — bentuk mirip ConversationItem (avatar + 2 baris teks)
export function InboxRowSkeleton() {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.inboxRow}>
      <Bone width={48} height={48} radius={24} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Bone width="55%" height={14} style={{ marginBottom: 8 }} />
        <Bone width="80%" height={12} />
      </View>
    </View>
  );
}

export function InboxListSkeleton({ count = 7 }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => <InboxRowSkeleton key={i} />)}
    </View>
  );
}

// Bubble chat skeleton — selang-seling kiri/kanan meniru layout MessageBubble
function ChatBubbleSkeleton({ out }) {
  return (
    <View style={[chatStyles.row, out ? chatStyles.rowOut : chatStyles.rowIn]}>
      <Bone width={out ? 160 : 200} height={out ? 36 : 52} radius={14} />
    </View>
  );
}

export function ChatListSkeleton() {
  return (
    <View style={{ padding: 10 }}>
      <ChatBubbleSkeleton out={false} />
      <ChatBubbleSkeleton out={true} />
      <ChatBubbleSkeleton out={false} />
      <ChatBubbleSkeleton out={false} />
      <ChatBubbleSkeleton out={true} />
    </View>
  );
}

// Profil pelanggan (CustomerSheet/CustomerDetailScreen) — avatar besar +
// nama + beberapa baris section.
export function ProfileSkeleton() {
  return (
    <View style={{ paddingVertical: 20 }}>
      <View style={{ alignItems: "center", marginBottom: 20 }}>
        <Bone width={72} height={72} radius={36} />
        <Bone width={140} height={16} style={{ marginTop: 12 }} />
        <Bone width={100} height={12} style={{ marginTop: 8 }} />
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <Bone width={90} height={10} style={{ marginBottom: 8 }} />
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
          <Bone width={64} height={28} radius={14} />
          <Bone width={64} height={28} radius={14} />
          <Bone width={64} height={28} radius={14} />
        </View>
        <Bone width={90} height={10} style={{ marginBottom: 8 }} />
        <Bone width="100%" height={38} radius={10} style={{ marginBottom: 20 }} />
        <Bone width={90} height={10} style={{ marginBottom: 8 }} />
        <Bone width="100%" height={60} radius={12} />
      </View>
    </View>
  );
}

export default Bone;

function createStyles(tokens) {
  return StyleSheet.create({
    inboxRow: {
      flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.color.subtle,
    },
  });
}

const chatStyles = StyleSheet.create({
  row: { marginVertical: 6 },
  rowIn: { alignItems: "flex-start" },
  rowOut: { alignItems: "flex-end" },
});
