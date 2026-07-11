// Rekam pesan suara — tahan tombol mic (expo-audio useAudioRecorder), lepas →
// preview (player + Kirim/Batal). Pola SAMA dengan
// frontend/src/features/inbox/components/ChatWindow/VoiceRecorder.jsx,
// diadaptasi ke expo-audio (RN tidak punya MediaRecorder browser).
//
// ⚠️ Ganti dari expo-av (deprecated, crash New Architecture — lihat
// mobile/CLAUDE.md) ke expo-audio, API resmi pengganti sejak SDK 54+.
//
// ⚠️ Format rekaman: preset default menghasilkan .m4a (AAC), BUKAN
// audio/webm seperti browser. Backend cuma auto-transcode ke ogg/opus untuk
// file bermimetype "audio/webm" (lihat backend/src/routes/conversations.js)
// — konversi itu pakai ffmpeg yang MENDETEKSI ISI FILE (bukan mimetype yang
// diklaim), jadi aman memberi label "audio/webm" ke file .m4a di sini supaya
// tetap lewat jalur konversi yang sama dan terkirim sebagai voice note asli,
// bukan attachment dokumen biasa.
import React, { useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { Mic } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import AudioPlayer from "./AudioPlayer";

const MIN_DURATION_SEC = 1;

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function VoiceRecorderBar({ conversationId, onSent }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState(null); // { uri, seconds }
  const [sending, setSending] = useState(false);

  const isRecordingRef = useRef(false);
  const secondsRef = useRef(0);
  const timerRef = useRef(null);

  async function startRecording() {
    if (isRecordingRef.current) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Mikrofon", "Izin mikrofon diperlukan untuk rekam pesan suara");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      isRecordingRef.current = true;
      secondsRef.current = 0;
      setSeconds(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch (err) {
      Alert.alert("Gagal rekam", err.message);
    }
  }

  async function finishRecording() {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    clearInterval(timerRef.current);
    setRecording(false);
    try {
      await recorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const finalSeconds = secondsRef.current;
    const uri = recorder.uri;
    if (finalSeconds < MIN_DURATION_SEC || !uri) return; // kepencet sebentar — buang diam-diam
    setPreview({ uri, seconds: finalSeconds });
  }

  function discardPreview() {
    setPreview(null);
  }

  async function sendVoiceNote() {
    if (!preview || sending) return;
    setSending(true);
    try {
      const file = { uri: preview.uri, name: `voice-${Date.now()}.webm`, type: "audio/webm" };
      const msg = await api.sendMedia(conversationId, file, "", "media");
      onSent?.(msg);
      setPreview(null);
    } catch (err) {
      Alert.alert("Gagal kirim pesan suara", err.message);
    } finally {
      setSending(false);
    }
  }

  if (preview) {
    return (
      <View style={styles.previewBar}>
        <AudioPlayer uri={preview.uri} />
        <TouchableOpacity style={styles.pillBtn} onPress={discardPreview} disabled={sending}>
          <Text style={styles.pillBtnText}>Batal</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pillBtn, styles.pillBtnPrimary]} onPress={sendVoiceNote} disabled={sending}>
          <Text style={[styles.pillBtnText, styles.pillBtnTextPrimary]}>{sending ? "…" : "Kirim"}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {recording && (
        <View style={styles.recordingInfo}>
          <View style={styles.recDot} />
          <Text style={styles.recTime}>{fmtTime(seconds)}</Text>
          <Text style={styles.recHint}>Lepas untuk selesai</Text>
        </View>
      )}
      {/* TouchableOpacity ini SENGAJA tidak pernah unmount selama gesture
          tekan-tahan berlangsung (cuma style yang berubah) — kalau tombol
          diganti komponen lain saat state `recording` berubah, responder
          gesture RN bisa putus dan onPressOut tidak terpanggil. */}
      <TouchableOpacity
        style={[styles.micBtn, recording && styles.micBtnActive]}
        onLongPress={startRecording}
        delayLongPress={150}
        onPressOut={() => { if (isRecordingRef.current) finishRecording(); }}
      >
        <Mic size={20} color={recording ? "#fff" : tokens.color.textSecondary} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center" },
  micBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
  },
  micBtnActive: { backgroundColor: tokens.color.danger },
  micIcon: { fontSize: 18 },
  recordingInfo: {
    position: "absolute", right: 48, bottom: 4, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: tokens.color.card, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: tokens.color.border, minWidth: 140,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.color.danger },
  recTime: { fontSize: 12, color: tokens.color.textPrimary, fontWeight: "700" },
  recHint: { fontSize: 11, color: tokens.color.textMuted },
  previewBar: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: tokens.color.card, borderRadius: 22, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: tokens.color.border,
  },
  pillBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: tokens.color.subtle,
  },
  pillBtnPrimary: { backgroundColor: tokens.color.accent },
  pillBtnText: { fontSize: 13, fontWeight: "600", color: tokens.color.textSecondary },
  pillBtnTextPrimary: { color: "#fff" },
});
