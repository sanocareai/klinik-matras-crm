// Rekam pesan suara — pola WhatsApp asli: tekan-tahan mic → rekam (geser ke
// ATAS → kunci rekaman tanpa perlu tahan lagi, geser ke KIRI → batal), lepas
// tanpa geser → preview (player + Kirim/Batal). Pakai expo-audio
// (useAudioRecorder), diadaptasi ke PanResponder RN karena butuh lacak posisi
// jari mentah (dx/dy), bukan cuma event tekan/lepas biasa.
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
//
// BUG LAMA (fix): saat recording/preview aktif, komponen ini dulu tetap jadi
// sibling flex biasa di baris input ChatScreen.js — TextInput di sebelahnya
// (flex:1) TETAP dirender & ikut berebut lebar, sementara AudioPlayer sendiri
// minta minWidth 180 — hasilnya tombol Kirim/Batal kepotong/tidak kelihatan
// (persis bug di screenshot). Sekarang recording/preview dirender sebagai
// overlay position:absolute yang menutupi SELURUH baris input (termasuk
// TextInput di baliknya), jadi dapat lebar penuh tanpa perlu ubah
// ChatScreen.js sama sekali.
import React, { useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Animated, PanResponder,
} from "react-native";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { Mic, Trash2, Send, Lock, ChevronLeft } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { lightHaptic, mediumHaptic } from "../lib/haptics";
import AudioPlayer from "./AudioPlayer";

const MIN_DURATION_SEC = 1;
const HOLD_DELAY_MS = 150;   // tekan-tahan minimal sebelum dianggap "mulai rekam", bukan tap biasa
const LOCK_DISTANCE = 70;    // px geser ke ATAS untuk kunci rekaman
const CANCEL_DISTANCE = 90;  // px geser ke KIRI untuk batal rekam
const DRAG_VISUAL_CLAMP = 26; // gerakan visual tombol mic dibatasi supaya tidak "kabur" dari layar

// Sama seperti AttachComposer.js — uploadFile() kadang gagal cuma di sisi
// respons (VN sudah terkirim ke WhatsApp, koneksi lemah pas respons balik).
// Cek riwayat sebelum vonis gagal, supaya tidak ada dorongan kirim ulang
// (dobel VN ke customer beneran).
async function findRecentlySentMedia(conversationId, sinceMs) {
  try {
    const msgs = await api.getMessages(conversationId);
    const cutoff = sinceMs - 3000;
    const candidates = msgs
      .filter((m) => m.direction === "OUTBOUND" && m.mediaType && new Date(m.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function VoiceRecorderBar({ conversationId, onSent }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState(null); // { uri, seconds }
  const [sending, setSending] = useState(false);

  const isRecordingRef = useRef(false);
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);
  const startedHoldRef = useRef(false);
  const holdTimerRef = useRef(null);
  const secondsRef = useRef(0);
  const timerRef = useRef(null);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lockProgress = useRef(new Animated.Value(0)).current; // 0..1 seberapa dekat ke kunci

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
      cancelledRef.current = false;
      lockedRef.current = false;
      secondsRef.current = 0;
      setSeconds(0);
      setLocked(false);
      setRecording(true);
      lightHaptic();
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch (err) {
      Alert.alert("Gagal rekam", err.message);
    }
  }

  async function stopRecordingInternal() {
    clearInterval(timerRef.current);
    isRecordingRef.current = false;
    try { await recorder.stop(); } catch {}
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }

  // Lepas jari TANPA geser ke atas/kiri → preview (player + Kirim/Batal jelas)
  async function finishToPreview() {
    if (!isRecordingRef.current) return;
    const finalSeconds = secondsRef.current;
    await stopRecordingInternal();
    setRecording(false);
    setLocked(false);
    const uri = recorder.uri;
    if (finalSeconds < MIN_DURATION_SEC || !uri) { setSeconds(0); return; } // kepencet sebentar — buang diam-diam
    setPreview({ uri, seconds: finalSeconds });
  }

  // Geser cukup jauh ke KIRI (kapan pun, tahan ATAU locked) → batal total,
  // tidak ada preview — sama seperti "slide to cancel" WhatsApp asli.
  async function cancelRecording() {
    if (!isRecordingRef.current) return;
    cancelledRef.current = true;
    await stopRecordingInternal();
    setRecording(false);
    setLocked(false);
    setSeconds(0);
  }

  // Mode LOCKED — tombol kirim (panah biru): stop lalu kirim LANGSUNG, tanpa
  // preview lagi (persis WhatsApp: begitu dikunci, kirim = final).
  async function sendLocked() {
    if (!isRecordingRef.current) return;
    const finalSeconds = secondsRef.current;
    await stopRecordingInternal();
    setRecording(false);
    setLocked(false);
    const uri = recorder.uri;
    if (finalSeconds < MIN_DURATION_SEC || !uri) { setSeconds(0); return; }
    await doSend(uri);
  }

  async function doSend(uri) {
    setSending(true);
    const startedAt = Date.now();
    try {
      const file = { uri, name: `voice-${Date.now()}.webm`, type: "audio/webm" };
      const msg = await api.sendMedia(conversationId, file, "", "media");
      onSent?.(msg);
      setPreview(null);
    } catch (err) {
      const reconciled = await findRecentlySentMedia(conversationId, startedAt);
      if (reconciled) {
        onSent?.(reconciled);
        setPreview(null);
      } else {
        Alert.alert("Gagal kirim pesan suara", err.message);
      }
    } finally {
      setSending(false);
      setSeconds(0);
    }
  }

  function discardPreview() {
    setPreview(null);
  }

  async function sendVoiceNote() {
    if (!preview || sending) return;
    await doSend(preview.uri);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        startedHoldRef.current = false;
        pan.setValue({ x: 0, y: 0 });
        lockProgress.setValue(0);
        // Delay singkat supaya TAP biasa (bukan tahan) tidak langsung
        // mulai rekam — dibedakan dari tekan-tahan sungguhan.
        holdTimerRef.current = setTimeout(() => {
          startedHoldRef.current = true;
          startRecording();
        }, HOLD_DELAY_MS);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (!isRecordingRef.current || lockedRef.current) return;
        const dx = Math.min(0, gestureState.dx); // cuma peduli geser ke KIRI
        const dy = Math.min(0, gestureState.dy); // cuma peduli geser ke ATAS
        pan.setValue({
          x: Math.max(dx, -DRAG_VISUAL_CLAMP),
          y: Math.max(dy, -DRAG_VISUAL_CLAMP),
        });
        lockProgress.setValue(Math.min(1, Math.abs(dy) / LOCK_DISTANCE));

        if (Math.abs(dy) >= LOCK_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
          lockedRef.current = true;
          setLocked(true);
          mediumHaptic();
          pan.setValue({ x: 0, y: 0 });
        } else if (Math.abs(dx) >= CANCEL_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
          cancelRecording();
        }
      },
      onPanResponderRelease: () => {
        clearTimeout(holdTimerRef.current);
        pan.setValue({ x: 0, y: 0 });
        if (!startedHoldRef.current) {
          // Tap sebentar (bukan tahan) — tidak memicu apa pun secara diam-diam,
          // kasih tahu caranya supaya tidak terlihat seperti tombol rusak.
          Alert.alert("Pesan Suara", "Tahan tombol mic untuk mulai merekam, lepas untuk berhenti.");
          return;
        }
        if (lockedRef.current || cancelledRef.current) return; // sudah dikunci / sudah dibatalkan lewat slide
        finishToPreview();
      },
      onPanResponderTerminate: () => {
        clearTimeout(holdTimerRef.current);
        if (startedHoldRef.current && !lockedRef.current && !cancelledRef.current) {
          finishToPreview();
        }
      },
    })
  ).current;

  // ── Preview: player + Kirim/Batal — overlay lebar PENUH supaya tombol
  // tidak pernah kepotong oleh TextInput di baliknya (lihat catatan bug di atas). ──
  if (preview) {
    return (
      <View style={styles.overlay}>
        <AudioPlayer uri={preview.uri} />
        <TouchableOpacity style={styles.discardBtn} onPress={discardPreview} disabled={sending}>
          <Trash2 size={18} color={tokens.color.danger} strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sendBtnBig} onPress={sendVoiceNote} disabled={sending}>
          <Send size={20} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    );
  }

  // ── Sedang merekam (belum dikunci ATAU sudah dikunci) — overlay lebar penuh juga. ──
  if (recording) {
    return (
      <View style={styles.overlay}>
        <View style={styles.recDotWrap}>
          <View style={styles.recDot} />
          <Text style={styles.recTime}>{fmtTime(seconds)}</Text>
        </View>

        {!locked ? (
          <>
            <Animated.View
              style={[
                styles.cancelHintRow,
                { opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
              ]}
            >
              <ChevronLeft size={14} color={tokens.color.textMuted} strokeWidth={2.4} />
              <Text style={styles.cancelHintText}>Geser untuk batal</Text>
            </Animated.View>

            <View style={styles.lockWrap} pointerEvents="none">
              <Animated.View
                style={[
                  styles.lockPill,
                  {
                    opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
                    transform: [{ translateY: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
                  },
                ]}
              >
                <Lock size={14} color={tokens.color.accent} strokeWidth={2.2} />
              </Animated.View>
            </View>

            <Animated.View
              style={[styles.micBtnBig, { transform: pan.getTranslateTransform() }]}
              {...panResponder.panHandlers}
            >
              <Mic size={20} color="#fff" strokeWidth={2} />
            </Animated.View>
          </>
        ) : (
          <>
            <Text style={styles.lockedHint}>Rekaman terkunci</Text>
            <TouchableOpacity style={styles.discardBtn} onPress={cancelRecording}>
              <Trash2 size={18} color={tokens.color.danger} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sendBtnBig} onPress={sendLocked}>
              <Send size={20} color="#fff" strokeWidth={2.4} />
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // ── Idle — tombol mic kecil biasa, inline seperti tombol kirim teks. ──
  return (
    <View
      style={[styles.micBtn]}
      {...panResponder.panHandlers}
    >
      <Mic size={20} color={tokens.color.textSecondary} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  micBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
  },
  micBtnBig: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.danger,
  },
  // Overlay lebar PENUH — menutupi seluruh baris input (termasuk TextInput
  // di baliknya) supaya tombol Kirim/Batal/lock SELALU dapat ruang cukup,
  // tidak pernah kepotong. Warna background SAMA dengan inputBar ChatScreen
  // (tokens.color.card) jadi menyatu tanpa perlu tahu padding parent persis.
  overlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: tokens.color.card, paddingHorizontal: 8,
  },
  recDotWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: tokens.color.danger },
  recTime: { fontSize: 13, color: tokens.color.textPrimary, fontWeight: "700", minWidth: 36 },
  cancelHintRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  cancelHintText: { fontSize: 12, color: tokens.color.textMuted },
  lockedHint: { flex: 1, fontSize: 12, color: tokens.color.textMuted, textAlign: "center" },
  lockWrap: {
    position: "absolute", right: 12, top: -6, alignItems: "center",
  },
  lockPill: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: tokens.color.accentSoft,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: tokens.color.border,
  },
  discardBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.subtle,
  },
  sendBtnBig: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accent,
  },
});
