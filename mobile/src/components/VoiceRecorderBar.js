// Rekam pesan suara — mimic WhatsApp voice-note asli:
//   tekan-tahan mic -> mulai rekam (ikon membesar smooth)
//   geser ATAS lewat threshold -> KUNCI rekaman (jari boleh diangkat, tetap rekam)
//   geser KIRI lewat threshold -> BATAL (buang audio, balik ke idle)
//   lepas jari SEBELUM dikunci -> auto-stop + LANGSUNG kirim (tidak ada preview)
//   locked: trash (kiri) | timer | waveform (tengah) | pause/resume | kirim (kanan)
//
// ⚠️ expo-av (yang diminta task) SUDAH DIHAPUS dari project ini — deprecated
// dan CRASH di New Architecture (lihat mobile/AGENTS.md soal Expo SDK 57).
// Tetap pakai expo-audio (useAudioRecorder), API resmi pengganti expo-av
// sejak SDK 54+, sudah jadi standar di seluruh app ini (lihat AudioPlayer.js
// untuk playback). Mengganti balik ke expo-av akan mengulang bug crash lama.
//
// GESTURE: seluruhnya react-native-gesture-handler Gesture.Pan() + reanimated
// shared values (translateX/Y, lockProgress, micScale) — TIDAK ada state React
// biasa untuk lacak koordinat jari (bakal lag di Android, lihat instruksi
// task). Tombol mic SATU elemen yang TETAP MOUNTED dari idle sampai locked
// (cuma style-nya yang berubah) — supaya sesi gesture yang sama tidak pernah
// terputus akibat React unmount/remount elemen di tengah tekan-tahan.
//
// Format rekaman: preset default expo-audio menghasilkan .m4a (AAC), BUKAN
// audio/webm seperti browser. Backend cuma auto-transcode ke ogg/opus untuk
// file bermimetype "audio/webm" (lihat backend/src/routes/conversations.js)
// — konversi itu pakai ffmpeg yang MENDETEKSI ISI FILE (bukan mimetype yang
// diklaim), jadi aman memberi label "audio/webm" ke file .m4a di sini supaya
// tetap lewat jalur konversi yang sama dan terkirim sebagai voice note asli.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSpring,
  interpolate, Extrapolation, runOnJS,
} from "react-native-reanimated";
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from "expo-audio";
import { File } from "expo-file-system";
import { Mic, Trash2, Send, ChevronUp, ChevronLeft, Pause, Play } from "lucide-react-native";
import { api } from "../api";
import { useTokens } from "../constants/theme";
import { lightHaptic, mediumHaptic } from "../lib/haptics";

const MIN_DURATION_SEC = 1;
const HOLD_DELAY_MS = 150;   // tekan-tahan minimal sebelum dianggap "mulai rekam", bukan tap biasa
const LOCK_DISTANCE = 70;    // px geser ke ATAS untuk kunci rekaman
const CANCEL_DISTANCE = 90;  // px geser ke KIRI untuk batal rekam
const DRAG_VISUAL_CLAMP = 26; // gerakan visual tombol mic dibatasi supaya tidak "kabur" dari layar
const MIC_SCALE_ACTIVE = 1.15; // seberapa besar mic "membesar" saat tekan-tahan
const METERING_INTERVAL_MS = 100; // cadence baca amplitude mic — cukup rapat untuk waveform terasa hidup
const LIVE_BARS_MAX = 32;   // jendela bergulir waveform (bar terlama didorong keluar)

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

// Hapus file rekaman yang batal/tidak jadi dikirim — biar tidak numpuk file
// .m4a yatim di cache device (Zero-Bug Guarantee: bukan cuma stop recorder,
// file-nya juga harus benar-benar dibuang, bukan cuma dilupakan referensinya).
function safeDeleteFile(uri) {
  if (!uri) return;
  try { new File(uri).delete(); } catch {}
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Dot merah berdenyut — dipakai di indikator rekam (belum dikunci).
function PulsingDot({ size = 9 }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(withTiming(1.4, { duration: 550 }), -1, true);
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.recDot, { width: size, height: size, borderRadius: size / 2 }, style]} />
  );
}

// "◀ Geser untuk batal" — shimmer halus ke kiri supaya terasa seperti
// mengajak jari digeser, bukan teks statis.
function CancelHintShimmer({ style }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const shift = useSharedValue(0);
  useEffect(() => {
    shift.value = withRepeat(withTiming(-5, { duration: 700 }), -1, true);
  }, [shift]);
  const shimmerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  return (
    <Animated.View style={[styles.cancelHintRow, style, shimmerStyle]}>
      <ChevronLeft size={14} color={tokens.color.textMuted} strokeWidth={2.4} />
      <Text style={styles.cancelHintText}>Geser untuk batal</Text>
    </Animated.View>
  );
}

// Chevron "▲" yang memantul pelan di atas label "Kunci".
function BouncingChevronUp() {
  const tokens = useTokens();
  const bounce = useSharedValue(0);
  useEffect(() => {
    bounce.value = withRepeat(withTiming(-4, { duration: 500 }), -1, true);
  }, [bounce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bounce.value }] }));
  return (
    <Animated.View style={style}>
      <ChevronUp size={14} color={tokens.color.accent} strokeWidth={2.4} />
    </Animated.View>
  );
}

// Waveform hidup dari amplitude mic asli — kalau belum ada sample metering
// sama sekali (device/OS tidak kasih data metering), tidak dirender apa-apa
// (jangan pura-pura ada data).
function LiveWaveform({ bars }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (!bars.length) return null;
  return (
    <View style={styles.liveWaveformRow}>
      {bars.map((v, i) => (
        <View key={i} style={[styles.liveWaveformBar, { height: 4 + v * 18 }]} />
      ))}
    </View>
  );
}

export default function VoiceRecorderBar({ conversationId, onSent }) {
  const tokens = useTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, METERING_INTERVAL_MS);
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [liveBars, setLiveBars] = useState([]);

  const isRecordingRef = useRef(false);
  const pausedRef = useRef(false);
  const startedHoldRef = useRef(false);
  const holdTimerRef = useRef(null);
  const secondsRef = useRef(0);
  const timerRef = useRef(null);
  const meteringSamplesRef = useRef([]);

  // ── Shared values (UI thread) — SEMUA pelacakan gesture & animasi lewat
  // sini, bukan React state, supaya tidak lag di Android (instruksi task). ──
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const lockProgress = useSharedValue(0); // 0..1 seberapa dekat ke threshold kunci
  const micScale = useSharedValue(1);
  const hasLockedSV = useSharedValue(false); // guard: cegah onUpdate trigger handleLock berkali-kali per sesi drag
  const hasCancelledSV = useSharedValue(false); // guard sama untuk handleCancel

  const stage = !recording ? "idle" : (locked ? "locked" : "recording");

  // Kumpulkan sample amplitude selama BENAR-BENAR merekam & TIDAK di-pause.
  // Kalau metering tidak tersedia (undefined) di device ini, effect ini tidak
  // pernah mengisi apa pun -> LiveWaveform otomatis kosong, bukan di-fake.
  useEffect(() => {
    if (!isRecordingRef.current || pausedRef.current) return;
    if (typeof recorderState.metering !== "number") return;
    // dBFS kira-kira -60 (lantai noise) s/d 0 (puncak) — normalisasi ke 0..1.
    const norm = Math.max(0, Math.min(1, (recorderState.metering + 60) / 60));
    meteringSamplesRef.current = [...meteringSamplesRef.current, norm];
    setLiveBars(meteringSamplesRef.current.slice(-LIVE_BARS_MAX));
  }, [recorderState.metering]);

  // Zero-Bug Guarantee: kalau ChatScreen ditinggalkan (back/navigasi) SAAT
  // masih merekam, recorder + timer harus benar-benar dihentikan, bukan
  // dibiarkan jalan di background jadi kebocoran native resource.
  useEffect(() => () => {
    clearTimeout(holdTimerRef.current);
    clearInterval(timerRef.current);
    if (isRecordingRef.current) {
      recorder.stop().catch(() => {});
    }
  }, [recorder]);

  function resetMicScale() {
    micScale.value = withSpring(1, { damping: 14 });
  }

  function startTimer() {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
    }, 1000);
  }

  async function startRecording() {
    if (isRecordingRef.current) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Mikrofon", "Izin mikrofon diperlukan untuk rekam pesan suara");
        resetMicScale();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      isRecordingRef.current = true;
      pausedRef.current = false;
      secondsRef.current = 0;
      meteringSamplesRef.current = [];
      setLiveBars([]);
      setSeconds(0);
      setPaused(false);
      setLocked(false);
      setRecording(true);
      lightHaptic();
      startTimer();
    } catch (err) {
      resetMicScale();
      Alert.alert("Gagal rekam", err.message);
    }
  }

  async function stopRecordingInternal() {
    clearInterval(timerRef.current);
    isRecordingRef.current = false;
    pausedRef.current = false;
    try { await recorder.stop(); } catch {}
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }

  async function togglePause() {
    if (!isRecordingRef.current) return;
    if (pausedRef.current) {
      recorder.record();
      pausedRef.current = false;
      setPaused(false);
      startTimer();
    } else {
      recorder.pause();
      pausedRef.current = true;
      setPaused(true);
      clearInterval(timerRef.current);
    }
  }

  // Lepas jari SEBELUM geser ke atas/kiri -> auto-stop + LANGSUNG kirim
  // (tidak ada langkah preview lagi — persis WhatsApp asli).
  async function autoSendOnRelease() {
    if (!isRecordingRef.current) return;
    const finalSeconds = secondsRef.current;
    await stopRecordingInternal();
    setRecording(false);
    setLocked(false);
    resetMicScale();
    const uri = recorder.uri;
    if (finalSeconds < MIN_DURATION_SEC || !uri) {
      setSeconds(0);
      safeDeleteFile(uri);
      return;
    }
    await doSend(uri);
  }

  // Geser cukup jauh ke KIRI (kapan pun, tahan ATAU locked) -> batal total,
  // audio dibuang, balik ke idle. Dipakai juga oleh tombol trash saat locked.
  async function cancelRecording() {
    if (!isRecordingRef.current) return;
    await stopRecordingInternal();
    const uri = recorder.uri;
    setRecording(false);
    setLocked(false);
    setPaused(false);
    setSeconds(0);
    resetMicScale();
    safeDeleteFile(uri);
  }

  // Mode LOCKED — tombol kirim: stop lalu kirim LANGSUNG (final, tidak ada
  // preview), sama seperti autoSendOnRelease tapi dipicu tombol eksplisit.
  async function sendLocked() {
    if (!isRecordingRef.current) return;
    const finalSeconds = secondsRef.current;
    await stopRecordingInternal();
    setRecording(false);
    setLocked(false);
    setPaused(false);
    resetMicScale();
    const uri = recorder.uri;
    if (finalSeconds < MIN_DURATION_SEC || !uri) {
      setSeconds(0);
      safeDeleteFile(uri);
      return;
    }
    await doSend(uri);
  }

  async function doSend(uri) {
    setSending(true);
    const startedAt = Date.now();
    try {
      const file = { uri, name: `voice-${Date.now()}.webm`, type: "audio/webm" };
      const msg = await api.sendMedia(conversationId, file, "", "media");
      onSent?.(msg);
    } catch (err) {
      const reconciled = await findRecentlySentMedia(conversationId, startedAt);
      if (reconciled) {
        onSent?.(reconciled);
      } else {
        Alert.alert("Gagal kirim pesan suara", err.message);
      }
    } finally {
      setSending(false);
      setSeconds(0);
    }
  }

  // ── Handler JS dipanggil lewat runOnJS dari worklet gesture di bawah —
  // logic bisnis (permission, native recorder, state React) TIDAK BOLEH
  // jalan di UI thread, cuma koordinat mentah & threshold check yang di situ. ──
  function handlePressIn() {
    startedHoldRef.current = false;
    holdTimerRef.current = setTimeout(() => {
      startedHoldRef.current = true;
      startRecording();
    }, HOLD_DELAY_MS);
  }

  function handleLock() {
    setLocked(true);
    mediumHaptic();
  }

  function handleCancelGesture() {
    clearTimeout(holdTimerRef.current);
    if (!startedHoldRef.current) return; // belum sempat mulai rekam sungguhan
    cancelRecording();
  }

  function handleRelease() {
    clearTimeout(holdTimerRef.current);
    if (!startedHoldRef.current) {
      // Tap sebentar (bukan tahan) — jangan diam-diam tidak ngapa-ngapain,
      // kasih tahu caranya supaya tidak terlihat seperti tombol rusak.
      resetMicScale();
      Alert.alert("Pesan Suara", "Tahan tombol mic untuk mulai merekam, lepas untuk berhenti.");
      return;
    }
    autoSendOnRelease();
  }

  // ── Gesture — 100% react-native-gesture-handler + reanimated shared
  // values. onBegin fires SEGERA saat jari menyentuh (bukan nunggu gerakan),
  // jadi "tekan-tahan -> mulai rekam" terasa instan. onUpdate HANYA baca/tulis
  // shared value (UI thread) — runOnJS dipakai SEKALI per event penting
  // (lock/cancel/release), bukan tiap frame gerakan jari. ──
  const panGesture = Gesture.Pan()
    .onBegin(() => {
      micScale.value = withSpring(MIC_SCALE_ACTIVE, { damping: 12 });
      runOnJS(handlePressIn)();
    })
    .onUpdate((e) => {
      if (hasLockedSV.value || hasCancelledSV.value) return;
      const dx = Math.min(0, e.translationX); // cuma peduli geser ke KIRI
      const dy = Math.min(0, e.translationY); // cuma peduli geser ke ATAS
      translateX.value = Math.max(dx, -DRAG_VISUAL_CLAMP);
      translateY.value = Math.max(dy, -DRAG_VISUAL_CLAMP);
      lockProgress.value = Math.min(1, Math.abs(dy) / LOCK_DISTANCE);

      if (Math.abs(dy) >= LOCK_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
        hasLockedSV.value = true;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        runOnJS(handleLock)();
      } else if (Math.abs(dx) >= CANCEL_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
        hasCancelledSV.value = true;
        runOnJS(handleCancelGesture)();
      }
    })
    .onEnd(() => {
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      if (!hasLockedSV.value && !hasCancelledSV.value) {
        runOnJS(handleRelease)();
      }
    })
    .onFinalize(() => {
      hasLockedSV.value = false;
      hasCancelledSV.value = false;
    });

  const micAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: micScale.value },
    ],
  }));
  const cancelHintFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lockProgress.value, [0, 1], [1, 0.3], Extrapolation.CLAMP),
  }));
  const lockHintAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lockProgress.value, [0, 1], [0.5, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(lockProgress.value, [0, 1], [0, -6], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={stage === "idle" ? styles.rootIdle : styles.rootActive}>
      {stage !== "idle" && (
        <>
          <View style={styles.leftWrap}>
            {stage === "locked" ? (
              <TouchableOpacity style={styles.discardBtn} onPress={cancelRecording} disabled={sending}>
                <Trash2 size={18} color={tokens.color.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            ) : (
              <PulsingDot />
            )}
            <Text style={styles.recTime}>{fmtTime(seconds)}</Text>
          </View>

          <View style={styles.centerCol}>
            <LiveWaveform bars={liveBars} />
            {stage === "recording" && <CancelHintShimmer style={cancelHintFadeStyle} />}
          </View>

          {stage === "recording" && (
            <Animated.View style={[styles.lockWrap, lockHintAnimStyle]} pointerEvents="none">
              <BouncingChevronUp />
              <Text style={styles.lockKunciText}>Kunci</Text>
            </Animated.View>
          )}

          {stage === "locked" && (
            <TouchableOpacity style={styles.pauseBtn} onPress={togglePause} disabled={sending}>
              {paused
                ? <Play size={16} color={tokens.color.accent} strokeWidth={2.2} />
                : <Pause size={16} color={tokens.color.accent} strokeWidth={2.2} />}
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Tombol mic — SATU elemen yang TETAP MOUNTED dari idle sampai locked,
          cuma style yang berubah (kecil transparan <-> besar merah). Ini yang
          menjaga sesi GestureDetector tidak pernah terputus di tengah tekan-tahan. */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[stage === "idle" ? styles.micBtn : styles.micBtnBig, micAnimatedStyle]}
        >
          <Mic size={20} color={stage === "idle" ? tokens.color.textSecondary : "#fff"} strokeWidth={2} />
        </Animated.View>
      </GestureDetector>

      {stage === "locked" && (
        <TouchableOpacity style={styles.sendBtnBig} onPress={sendLocked} disabled={sending}>
          <Send size={20} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function createStyles(tokens) {
  return StyleSheet.create({
  micBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
  },
  micBtnBig: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.danger,
  },
  // rootIdle: ukuran kecil normal, inline sejajar tombol kirim teks.
  rootIdle: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  // rootActive: overlay lebar PENUH — menutupi seluruh baris input (termasuk
  // TextInput di baliknya, lihat ChatScreen.js inputBar) supaya tombol
  // trash/pause/kirim SELALU dapat ruang cukup, tidak pernah kepotong. Posisi
  // absolute di RN selalu relatif ke PARENT LANGSUNG (inputBar ChatScreen),
  // bukan butuh parent ber-position:relative eksplisit seperti CSS web.
  rootActive: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: tokens.color.card, paddingHorizontal: 8,
  },
  leftWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  recDot: { backgroundColor: tokens.color.danger },
  recTime: { fontSize: 13, color: tokens.color.textPrimary, fontWeight: "700", minWidth: 36 },
  centerCol: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  liveWaveformRow: { flexDirection: "row", alignItems: "center", gap: 2, height: 22 },
  liveWaveformBar: { width: 3, borderRadius: 1.5, backgroundColor: tokens.color.accent },
  cancelHintRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  cancelHintText: { fontSize: 12, color: tokens.color.textMuted },
  lockWrap: { position: "absolute", right: 8, top: -36, alignItems: "center" },
  lockKunciText: { fontSize: 10, fontWeight: "700", color: tokens.color.accent, marginTop: 1 },
  discardBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.subtle,
  },
  pauseBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accentSoft,
  },
  sendBtnBig: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accent,
  },
  });
}
