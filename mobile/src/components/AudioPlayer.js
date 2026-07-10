// Player pesan suara kustom (play/pause + progress bar + durasi) — bukan
// widget bawaan, sesuai spec Fase M-C. Pola state SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/MessageBubble.jsx#AudioPlayer,
// cuma sumber playback-nya expo-av Audio.Sound (RN tidak punya <audio> HTML).
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Audio } from "expo-av";
import { tokens } from "../constants/theme";

function fmtDuration(ms) {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioPlayer({ uri, tint = tokens.color.accent }) {
  const soundRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, [uri]);

  function onStatus(status) {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis || 0);
    setDurationMs(status.durationMillis || 0);
    setPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setPlaying(false);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  }

  async function toggle() {
    if (!soundRef.current) {
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, onStatus);
      soundRef.current = sound;
      return;
    }
    if (playing) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  }

  const progress = durationMs > 0 ? positionMs / durationMs : 0;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={[styles.btn, { backgroundColor: tint }]} onPress={toggle}>
        <Text style={styles.btnIcon}>{playing ? "⏸" : "▶"}</Text>
      </TouchableOpacity>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, progress * 100)}%`, backgroundColor: tint }]} />
      </View>
      <Text style={styles.time}>{fmtDuration(playing || positionMs ? positionMs : durationMs)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 180, paddingVertical: 2 },
  btn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btnIcon: { color: "#fff", fontSize: 13 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(0,0,0,0.15)", overflow: "hidden" },
  fill: { height: "100%" },
  time: { fontSize: 11, color: tokens.color.textMuted, minWidth: 34 },
});
