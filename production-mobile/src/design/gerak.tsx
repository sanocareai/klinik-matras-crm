import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

// GERAK gaya iOS — SEMUA animasi di sini hanya mengubah transform/opacity dengan useNativeDriver: true,
// jadi berjalan di thread UI (tetap 60fps walau JS sedang sibuk memuat data) dan ringan di HP kelas menengah.
// "Kurangi gerakan" di HP dihormati: animasi dilewati, isi langsung tampil.

/** Pegas ala UIKit: cepat, tanpa memantul berlebihan. */
export const PEGAS = { damping: 20, stiffness: 240, mass: 1, useNativeDriver: true } as const;
export const PEGAS_LEMBUT = { damping: 24, stiffness: 170, mass: 1, useNativeDriver: true } as const;

let kurangiCache = false;
/** true bila pengguna menyalakan "Kurangi gerakan / Hapus animasi" di pengaturan HP. */
export function useKurangiGerak() {
  const [v, setV] = useState(kurangiCache);
  useEffect(() => {
    let batal = false;
    AccessibilityInfo.isReduceMotionEnabled().then((x) => { kurangiCache = x; if (!batal) setV(x); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (x) => { kurangiCache = x; setV(x); });
    return () => { batal = true; sub.remove(); };
  }, []);
  return v;
}

/** Muncul bertahap (stagger): naik 14px + memudar masuk, sekali saat layar pertama dibuka. */
export function Muncul({ urutan = 0, children, style }: { urutan?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const kurangi = useKurangiGerak();
  const [t] = useState(() => new Animated.Value(kurangiCache ? 1 : 0));
  useEffect(() => {
    if (kurangi) { t.setValue(1); return; }
    const a = Animated.timing(t, { toValue: 1, duration: 360, delay: Math.min(urutan, 7) * 45, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [t, urutan, kurangi]);
  return (
    <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Kilau berjalan untuk kerangka memuat (shimmer) — satu Animated.loop per blok, berhenti saat dilepas. */
export function Kilau({ style }: { style?: StyleProp<ViewStyle> }) {
  const kurangi = useKurangiGerak();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (kurangi) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [t, kurangi]);
  return <Animated.View style={[{ borderRadius: 12, backgroundColor: "rgba(11,27,63,0.08)" }, style, { opacity: kurangi ? 0.7 : t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]} />;
}

/** Titik "Live" yang berdenyut pelan. */
export function Denyut({ warna, ukuran = 8 }: { warna: string; ukuran?: number }) {
  const kurangi = useKurangiGerak();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (kurangi) return;
    const a = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [t, kurangi]);
  return (
    <Animated.View style={{ width: ukuran, height: ukuran, alignItems: "center", justifyContent: "center" }}>
      {kurangi ? null : (
        <Animated.View style={{ position: "absolute", width: ukuran, height: ukuran, borderRadius: ukuran, backgroundColor: warna, opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }] }} />
      )}
      <Animated.View style={{ width: ukuran, height: ukuran, borderRadius: ukuran, backgroundColor: warna }} />
    </Animated.View>
  );
}

/** Ikon status berhasil yang "meletup" (skala pegas) — dipakai setelah mencatat. */
export function Letup({ children, kunci }: { children: React.ReactNode; kunci: string | number }) {
  const kurangi = useKurangiGerak();
  const [t] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (kurangi) return;
    t.setValue(0.4);
    Animated.spring(t, { toValue: 1, damping: 9, stiffness: 260, mass: 0.8, useNativeDriver: true }).start();
  }, [t, kunci, kurangi]);
  return <Animated.View style={{ transform: [{ scale: t }] }}>{children}</Animated.View>;
}
