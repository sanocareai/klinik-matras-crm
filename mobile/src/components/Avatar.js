// Avatar inisial berwarna — sama gayanya dengan versi web
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Users } from "lucide-react-native";
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
      {isGroup ? (
        <Users size={size * 0.5} color="#fff" strokeWidth={2} />
      ) : (
        <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700" },
});
