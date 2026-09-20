// Hook & pembungkus React untuk perpindahan tab yang responsif. Logika murni ada di lib/tabNav.js.
import React, { memo, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AccessibilityInfo, InteractionManager } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import TabSkeleton from "../components/TabSkeleton";
import { holdListData } from "./tabNav";

/** Pengaturan sistem "kurangi gerakan / hapus animasi" (Android: skala animasi 0) — ikut berubah saat diganti. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduced(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduced(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduced;
}

/**
 * Seperti useFocusEffect, tetapi callback BARU dijalankan setelah animasi/interaksi selesai (Animated bawaan React
 * Navigation mendaftarkan interaction handle, jadi ini otomatis menunggu geser tab selesai). Fetch + setState besar
 * dengan begitu tidak bertabrakan dengan frame animasi. Dibatalkan bila layar keburu kehilangan fokus.
 */
export function useFocusAfterInteractions(callback) {
  useFocusEffect(useCallback(() => {
    let cleanup;
    const task = InteractionManager.runAfterInteractions(() => { cleanup = callback(); });
    return () => { task.cancel?.(); if (typeof cleanup === "function") cleanup(); };
  }, [callback]));
}

// Layar tab tidak membaca props apa pun selain objek navigation (stabil) — semua datanya dari store/hook sendiri.
// Tanpa memo, SETIAP pindah tab React Navigation me-render ulang SEMUA layar tab yang ter-mount (Inbox 300 chat, Order,
// Pelanggan, ...) dua-tiga kali (state navigator + akhir animasi) — pekerjaan JS yang menahan animasi. Dengan komparator
// "selalu sama", layar hanya render karena state/store-nya sendiri.
const holdEqual = () => true;

/**
 * Pasang layar tab BERAT setelah animasi: saat pertama kali dipasang (kunjungan pertama di tengah transisi) yang
 * tampil dulu adalah TabSkeleton ringan, isi asli dipasang begitu animasi selesai (atau paling lambat `maxWaitMs`).
 * Setelah `ready` layar tidak pernah kembali ke skeleton — state & posisi scroll tetap terjaga.
 * `immediate` = layar pertama aplikasi (Home): tanpa skeleton.
 */
export function deferTabScreen(Screen, { immediate = false, maxWaitMs = 500 } = {}) {
  if (immediate) return memo(Screen, holdEqual);
  function Deferred(props) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      if (ready) return undefined;
      // Perpindahan tab kini INSTAN (tanpa animasi → tanpa interaction handle), jadi runAfterInteractions saja bisa langsung
      // menyala dan memasang layar berat di frame yang sama dengan sentuhan. Dua rAF memastikan skeleton/shell SUDAH tergambar
      // (tab langsung terlihat berganti) sebelum isi berat dipasang.
      let raf2;
      let task;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => { task = InteractionManager.runAfterInteractions(() => setReady(true)); });
      });
      const t = setTimeout(() => setReady(true), maxWaitMs);
      return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); task?.cancel?.(); clearTimeout(t); };
    }, [ready]);
    return ready ? <Screen {...props} /> : <TabSkeleton />;
  }
  Deferred.displayName = `Deferred(${Screen.displayName || Screen.name || "Tab"})`;
  return memo(Deferred, holdEqual);
}

/**
 * Data daftar yang aman untuk FlashList di layar tab: dibekukan saat layar tersembunyi (lihat holdListData), dilepas saat
 * fokus. Memakai event focus/blur (bukan useIsFocused) supaya layar tidak dirender ulang di tiap blur.
 */
export function useHiddenSafeList(navigation, data) {
  const focusedRef = useRef(navigation.isFocused());
  const heldRef = useRef(undefined);
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    // Rilis data penuh SETELAH pergantian tab tergambar (bukan sinkron di ketukan): layar langsung tampil dengan data
    // terakhir/contoh kecil, daftar penuh menyusul di frame berikutnya tanpa menahan sentuhan.
    let task;
    const onFocus = navigation.addListener("focus", () => {
      focusedRef.current = true;
      task?.cancel?.();
      task = InteractionManager.runAfterInteractions(() => { if (focusedRef.current) bump(); });
    });
    const onBlur = navigation.addListener("blur", () => { focusedRef.current = false; });
    return () => { onFocus(); onBlur(); task?.cancel?.(); };
  }, [navigation]);
  const out = holdListData({ focused: focusedRef.current, data, held: heldRef.current });
  heldRef.current = out;
  return out;
}
