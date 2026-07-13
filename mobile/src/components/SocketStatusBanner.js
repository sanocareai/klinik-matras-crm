// Banner kecil "Menyambung ulang..." saat Socket.IO putus, auto-hilang saat
// reconnect. Delay tampil 1.5 detik supaya tidak flicker untuk putus-nyambung
// sekejap (mis. app baru dibuka, socket masih handshake).
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WifiOff } from "lucide-react-native";
import { useTokens } from "../constants/theme";
import { useSocketStatusStore } from "../store/socketStatusStore";

const SHOW_DELAY_MS = 1500;

export default function SocketStatusBanner() {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const connected = useSocketStatusStore((s) => s.connected);
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [connected]);

  if (!visible) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + 4 }]} pointerEvents="none">
      <View style={styles.pill}>
        <WifiOff size={13} color="#fff" strokeWidth={2.2} style={{ marginRight: 6 }} />
        <Text style={styles.text}>Menyambung ulang…</Text>
      </View>
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
    wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 998 },
    pill: {
      flexDirection: "row", alignItems: "center", backgroundColor: tokens.color.textPrimary,
      borderRadius: tokens.radius.pill, paddingHorizontal: 14, paddingVertical: 7,
    },
    text: { color: "#fff", fontSize: 12, fontWeight: "600" },
  });
}
