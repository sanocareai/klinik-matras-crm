// Avatar inisial berwarna — sama gayanya dengan versi web
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { initials, avatarColor } from "../utils/format";

export default function Avatar({ name, size = 48, isGroup = false }) {
  const bg = isGroup ? "#6b7280" : avatarColor(name);
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>
        {isGroup ? "👥" : initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700" },
});
