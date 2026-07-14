import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION = typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Animasi angka naik dari 0 -> value saat mount/berubah, murni
// requestAnimationFrame (tanpa lib tambahan). Dipakai KPI card Laporan.
// Kalau user aktifkan prefers-reduced-motion, langsung tampil nilai akhir
// tanpa animasi (hormati preferensi aksesibilitas, bukan cuma dekorasi).
export function useCountUp(value, { duration = 700 } = {}) {
  const [display, setDisplay] = useState(REDUCED_MOTION ? (value || 0) : 0);
  const frameRef = useRef(null);
  const fromRef = useRef(0);

  useEffect(() => {
    const target = Number(value) || 0;
    if (REDUCED_MOTION) { setDisplay(target); return; }

    const from = fromRef.current;
    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — cepat di awal, melambat mendekati nilai akhir
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setDisplay(current);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return display;
}
