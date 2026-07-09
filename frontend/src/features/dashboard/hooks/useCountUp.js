import { useEffect, useState } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";

// Animasikan angka dari 0 (atau nilai sebelumnya) ke target saat berubah.
// Hormati prefers-reduced-motion — langsung lompat ke nilai akhir tanpa animasi.
export function useCountUp(target, { duration = 1 } = {}) {
  const motionValue = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const safeTarget = Number.isFinite(target) ? target : 0;

    if (reduceMotion) {
      motionValue.set(safeTarget);
      setDisplay(safeTarget);
      return;
    }

    const controls = animate(motionValue, safeTarget, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduceMotion]);

  return Math.round(display);
}
