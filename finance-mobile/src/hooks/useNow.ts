import { useEffect, useState } from "react";

/** Waktu sekarang yang menyegarkan diri tiap `ms` (untuk "diperbarui 2 menit lalu"). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
