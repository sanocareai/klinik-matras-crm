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
//
// RESTYLE (WhatsApp look & feel): dot rekam berdenyut, teks "Geser untuk
// batal" shimmer halus, "Kunci" + chevron memantul di atas tombol mic,
// waveform hidup dari amplitude mic asli (expo-audio metering — BUKAN
// data palsu, kalau metering tidak tersedia baris waveform disembunyikan
// total). Sample amplitude yang direkam selama sesi rekam disimpan supaya
// preview (setelah lepas jari) bisa tampil sebagai waveform statis dengan
// bagian sudah-diputar vs belum, bukan cuma progress bar polos.
import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Animated, PanResponder,
} from "react-native";
import Reanimated, {
  FadeIn, ZoomIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming,
} from "react-native-reanimated";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { Mic, Trash2, Send, ChevronUp, ChevronLeft } from "lucide-react-native";
import { api } from "../api";
import { tokens } from "../constants/theme";
import { lightHaptic, mediumHaptic } from "../lib/haptics";
import AudioPlayer from "./AudioPlayer";

const MIN_DURATION_SEC = 1;
const HOLD_DELAY_MS = 150;   // tekan-tahan minimal sebelum dianggap "mulai rekam", bukan tap biasa
const LOCK_DISTANCE = 70;    // px geser ke ATAS untuk kunci rekaman
const CANCEL_DISTANCE = 90;  // px geser ke KIRI untuk batal rekam
const DRAG_VISUAL_CLAMP = 26; // gerakan visual tombol mic dibatasi supaya tidak "kabur" dari layar
const METERING_INTERVAL_MS = 100; // cadence baca amplitude mic — cukup rapat untuk waveform terasa hidup
const LIVE_BARS_MAX = 32;   // jendela bergulir waveform SAAT merekam (bar terlama didorong keluar)
const PREVIEW_BARS = 40;    // jumlah bar waveform statis di layar preview

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

// Rata-ratakan array sample amplitude mentah (bisa ratusan untuk VN panjang)
// jadi jumlah bar tetap (PREVIEW_BARS) untuk ditampilkan statis di preview.
function downsampleWaveform(samples, targetCount) {
  if (!samples.length) return [];
  if (samples.length <= targetCount) return samples;
  const bucket = samples.length / targetCount;
  const out = [];
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < samples.length; j++) { sum += samples[j]; n++; }
    out.push(n ? sum / n : 0);
  }
  return out;
}

// Dot merah berdenyut — dipakai di indikator rekam (belum dikunci) & di
// tengah saat sudah dikunci.
function PulsingDot({ size = 9 }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(withTiming(1.4, { duration: 550 }), -1, true);
  }, [scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Reanimated.View style={[styles.recDot, { width: size, height: size, borderRadius: size / 2 }, style]} />
  );
}

// "◀ Geser untuk batal" — shimmer halus ke kiri supaya terasa seperti
// mengajak jari digeser, bukan teks statis.
function CancelHintShimmer() {
  const shift = useSharedValue(0);
  useEffect(() => {
    shift.value = withRepeat(withTiming(-5, { duration: 700 }), -1, true);
  }, [shift]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));
  return (
    <Reanimated.View style={[styles.cancelHintRow, style]}>
      <ChevronLeft size={14} color={tokens.color.textMuted} strokeWidth={2.4} />
      <Text style={styles.cancelHintText}>Geser untuk batal</Text>
    </Reanimated.View>
  );
}

// Waveform hidup dari amplitude mic asli SAAT merekam — kalau belum ada
// sample metering sama sekali (device/OS tidak kasih data metering), tidak
// dirender apa-apa (jangan pura-pura ada data).
function LiveWaveform({ bars }) {
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
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, METERING_INTERVAL_MS);
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState(null); // { uri, seconds, waveform }
  const [sending, setSending] = useState(false);
  const [liveBars, setLiveBars] = useState([]);

  const isRecordingRef = useRef(false);
  const lockedRef = useRef(false);
  const cancelledRef = useRef(false);
  const startedHoldRef = useRef(false);
  const holdTimerRef = useRef(null);
  const secondsRef = useRef(0);
  const timerRef = useRef(null);
  const meteringSamplesRef = useRef([]); // riwayat amplitude penuh sesi rekam ini (untuk waveform statis preview)
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lockProgress = useRef(new Animated.Value(0)).current; // 0..1 seberapa dekat ke kunci

  // Kumpulkan sample amplitude selama BENAR-BENAR merekam (isRecordingRef,
  // bukan state "recording" — dibaca via ref supaya tidak kena closure basi
  // dari PanResponder yang dibuat sekali, sama alasannya dengan fungsi2 di
  // bawah). Kalau metering tidak tersedia (undefined) di device ini, effect
  // ini tidak pernah mengisi apa pun → LiveWaveform & waveform preview
  // otomatis kosong/skip, bukan di-fake.
  useEffect(() => {
    if (!isRecordingRef.current) return;
    if (typeof recorderState.metering !== "number") return;
    // dBFS kira-kira -60 (lantai noise) s/d 0 (puncak) — normalisasi ke 0..1.
    const norm = Math.max(0, Math.min(1, (recorderState.metering + 60) / 60));
    meteringSamplesRef.current = [...meteringSamplesRef.current, norm];
    setLiveBars(meteringSamplesRef.current.slice(-LIVE_BARS_MAX));
  }, [recorderState.metering]);

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
      meteringSamplesRef.current = [];
      setLiveBars([]);
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
    const waveform = downsampleWaveform(meteringSamplesRef.current, PREVIEW_BARS);
    setPreview({ uri, seconds: finalSeconds, waveform });
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
      <Reanimated.View entering={FadeIn.duration(180)} style={styles.overlay}>
        <AudioPlayer uri={preview.uri} waveform={preview.waveform} />
        <TouchableOpacity style={styles.discardBtn} onPress={discardPreview} disabled={sending}>
          <Trash2 size={18} color={tokens.color.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sendBtnBig} onPress={sendVoiceNote} disabled={sending}>
          <Send size={20} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </Reanimated.View>
    );
  }

  // ── Sedang merekam (belum dikunci ATAU sudah dikunci) — overlay lebar penuh juga. ──
  if (recording) {
    return (
      <Reanimated.View entering={FadeIn.duration(150)} style={styles.overlay}>
        {!locked ? (
          <>
            <View style={styles.recDotWrap}>
              <PulsingDot />
              <Text style={styles.recTime}>{fmtTime(seconds)}</Text>
            </View>

            <View style={styles.centerCol}>
              <LiveWaveform bars={liveBars} />
              <Animated.View
                style={{ opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }}
              >
                <CancelHintShimmer />
              </Animated.View>
            </View>

            <View style={styles.lockWrap} pointerEvents="none">
              <Animated.View
                style={[
                  styles.lockHintCol,
                  {
                    opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
                    transform: [{ translateY: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
                  },
                ]}
              >
                <BouncingChevronUp />
                <Text style={styles.lockKunciText}>Kunci</Text>
              </Animated.View>
            </View>

            <Reanimated.View entering={ZoomIn.duration(150)}>
              <Animated.View
                style={[styles.micBtnBig, { transform: pan.getTranslateTransform() }]}
                {...panResponder.panHandlers}
              >
                <Mic size={20} color="#fff" strokeWidth={2} />
              </Animated.View>
            </Reanimated.View>
          </>
        ) : (
          <>
            <View style={styles.lockedCenterRow}>
              <PulsingDot size={8} />
              <Text style={styles.lockedDurationText}>{fmtTime(seconds)}</Text>
            </View>
            <Reanimated.View entering={ZoomIn.duration(180)}>
              <TouchableOpacity style={styles.discardBtn} onPress={cancelRecording}>
                <Trash2 size={18} color={tokens.color.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </Reanimated.View>
            <Reanimated.View entering={ZoomIn.duration(180)}>
              <TouchableOpacity style={styles.sendBtnBig} onPress={sendLocked}>
                <Send size={20} color="#fff" strokeWidth={2.4} />
              </TouchableOpacity>
            </Reanimated.View>
          </>
        )}
      </Reanimated.View>
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

// Chevron "▲" yang memantul pelan di atas label "Kunci" — ajakan visual
// terus-menerus untuk geser ke atas, independen dari progress drag (yang
// mengatur opacity/posisi wrapper-nya lewat RN Animated di luar).
function BouncingChevronUp() {
  const bounce = useSharedValue(0);
  useEffect(() => {
    bounce.value = withRepeat(withTiming(-4, { duration: 500 }), -1, true);
  }, [bounce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bounce.value }] }));
  return (
    <Reanimated.View style={style}>
      <ChevronUp size={14} color={tokens.color.accent} strokeWidth={2.4} />
    </Reanimated.View>
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
  recDot: { backgroundColor: tokens.color.danger },
  recTime: { fontSize: 13, color: tokens.color.textPrimary, fontWeight: "700", minWidth: 36 },
  centerCol: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  liveWaveformRow: { flexDirection: "row", alignItems: "center", gap: 2, height: 22 },
  liveWaveformBar: { width: 3, borderRadius: 1.5, backgroundColor: tokens.color.accent },
  cancelHintRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  cancelHintText: { fontSize: 12, color: tokens.color.textMuted },
  lockedCenterRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  lockedDurationText: { fontSize: 15, fontWeight: "700", color: tokens.color.textPrimary },
  lockWrap: {
    position: "absolute", right: 8, top: -36, alignItems: "center",
  },
  lockHintCol: { alignItems: "center" },
  lockKunciText: { fontSize: 10, fontWeight: "700", color: tokens.color.accent, marginTop: 1 },
  discardBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.subtle,
  },
  sendBtnBig: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: tokens.color.accent,
  },
});
