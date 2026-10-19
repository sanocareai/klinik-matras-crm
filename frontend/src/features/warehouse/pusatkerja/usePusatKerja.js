import { useCallback, useEffect, useRef, useState } from "react";

/** Memuat sumber baca-saja (Beranda / Perlu Perhatian). `muat(true)` = segarkan diam-diam (tanpa mengosongkan layar) — dipakai setelah jendela dokumen memberi kabar ada perubahan. */
export function useSumberPusatKerja(ambil) {
  const [data, setData] = useState(null); const [galat, setGalat] = useState(""); const [memuat, setMemuat] = useState(true); const urut = useRef(0);
  const ambilRef = useRef(ambil); ambilRef.current = ambil;
  const muat = useCallback(async (tenang = false) => {
    const n = ++urut.current; if (!tenang) setMemuat(true); setGalat("");
    try { const d = await ambilRef.current(); if (n === urut.current) setData(d); } catch (e) { if (n === urut.current) setGalat(e.message || "Gagal memuat"); } finally { if (n === urut.current) setMemuat(false); }
  }, []);
  useEffect(() => { muat(); }, [muat]);
  return { data, galat, memuat, muat };
}
