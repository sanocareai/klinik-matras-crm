import { useCallback, useEffect, useRef, useState } from "react";

// Pemuatan data layar yang seragam: status memuat/siap/gagal, tarik-untuk-segarkan, dan muat ulang saat layar
// kembali fokus. Permintaan lama yang selesai belakangan diabaikan (tidak menimpa hasil terbaru).
export function useMuat(fn, deps, navigation) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("memuat");
  const [error, setError] = useState("");
  const [segar, setSegar] = useState(false);
  const urut = useRef(0);

  const muat = useCallback(async ({ diam = false } = {}) => {
    const id = ++urut.current;
    if (!diam) setStatus((s) => (s === "siap" ? s : "memuat"));
    setError("");
    try {
      const hasil = await fn();
      if (id !== urut.current) return;
      setData(hasil);
      setStatus("siap");
    } catch (e) {
      if (id !== urut.current) return;
      setError(e?.message || "Gagal memuat");
      setStatus((s) => (s === "siap" ? s : "gagal"));
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { muat(); }, [muat]);
  useEffect(() => (navigation ? navigation.addListener("focus", () => muat({ diam: true })) : undefined), [navigation, muat]);

  const segarkan = useCallback(async () => { setSegar(true); await muat({ diam: true }); setSegar(false); }, [muat]);
  return { data, status, error, muat, segar, segarkan };
}
