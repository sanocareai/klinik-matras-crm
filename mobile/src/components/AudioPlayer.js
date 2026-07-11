// Player pesan suara kustom (play/pause + progress bar + durasi) — bukan
// widget bawaan, sesuai spec Fase M-C. Pola state SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/MessageBubble.jsx#AudioPlayer,
// cuma sumber playback-nya expo-audio useAudioPlayer (RN tidak punya <audio> HTML).
//
// ⚠️ Ganti dari expo-av (deprecated, crash New Architecture — lihat
// mobile/CLAUDE.md) ke expo-audio, API resmi pengganti sejak SDK 54+.
// useAudioPlayer/useAudioPlayerStatus pakai satuan DETIK (currentTime/duration),
// BUKAN milidetik seperti expo-av (positionMillis/durationMillis) — konversi
// ke ms cuma dilakukan di fmtDuration untuk format tampilan, state internal
// sekarang simpan detik langsung dari status hook.
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { tokens } from "../constants/theme";

function fmtDuration(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const totalSec = Math.floor(sec);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioPlayer({ uri, tint = tokens.color.accent }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [finished, setFinished] = useState(false);

  const playing = status.playing;
  const positionSec = status.currentTime || 0;
  const durationSec = status.duration || 0;

  // useAudioPlayer tidak punya event "didJustFinish" seperti expo-av —
  // deteksi manual dari status: sudah loaded, ada durasi, posisi mentok di
  // ujung durasi, dan tidak lagi playing (lawan dari "baru saja di-pause").
  useEffect(() => {
    if (status.isLoaded && durationSec > 0 && !playing && positionSec >= durationSec - 0.05) {
      if (!finished) {
        setFinished(true);
        player.seekTo(0).catch(() => {});
      }
    } else if (positionSec < durationSec - 0.05) {
      setFinished(false);
    }
  }, [status.isLoaded, playing, positionSec, durationSec]);

  function toggle() {
    if (playing) player.pause();
    else player.play();
  }

  const progress = durationSec > 0 ? positionSec / durationSec : 0;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={[styles.btn, { backgroundColor: tint }]} onPress={toggle}>
        <Text style={styles.btnIcon}>{playing ? "⏸" : "▶"}</Text>
      </TouchableOpacity>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, progress * 100)}%`, backgroundColor: tint }]} />
      </View>
      <Text style={styles.time}>{fmtDuration(playing || positionSec ? positionSec : durationSec)}</Text>
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
