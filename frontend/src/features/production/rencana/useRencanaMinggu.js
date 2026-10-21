import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api.js";
import { friendlyError } from "@/features/production/experience.js";

// Pemuat data Rencana Produksi: ringkasan minggu, rincian hari, dan antrean (cari/urut/halaman di server). Jawaban basi (permintaan lama yang selesai belakangan) diabaikan.
// `reloadAll` dipanggil sesudah setiap perubahan jadwal supaya tiga bagian layar selalu dari sumber yang sama.
export default function useRencanaMinggu({ start, hari, tab, q, sort }) {
  const [minggu, setMinggu] = useState(null); const [dayData, setDayData] = useState(null); const [antrean, setAntrean] = useState(null);
  const [loading, setLoading] = useState({ minggu: true, hari: true, antrean: true }); const [error, setError] = useState("");
  const [muatLagi, setMuatLagi] = useState(false); const [tick, setTick] = useState(0);
  const seq = useRef({ m: 0, h: 0, a: 0 });

  useEffect(() => {
    const id = ++seq.current.m; setLoading((l) => ({ ...l, minggu: true }));
    api.getRencanaMinggu(start).then((r) => { if (id === seq.current.m) { setMinggu(r); setError(""); } }).catch((e) => { if (id === seq.current.m) setError(friendlyError(e)); }).finally(() => { if (id === seq.current.m) setLoading((l) => ({ ...l, minggu: false })); });
  }, [start, tick]);
  useEffect(() => {
    const id = ++seq.current.h; setLoading((l) => ({ ...l, hari: true }));
    api.getRencanaHari(hari).then((r) => { if (id === seq.current.h) setDayData(r); }).catch((e) => { if (id === seq.current.h) setError(friendlyError(e)); }).finally(() => { if (id === seq.current.h) setLoading((l) => ({ ...l, hari: false })); });
  }, [hari, tick]);
  useEffect(() => {
    const id = ++seq.current.a; setLoading((l) => ({ ...l, antrean: true }));
    api.getRencanaAntrean({ tab, q, sort, page: 1 }).then((r) => { if (id === seq.current.a) setAntrean(r); }).catch((e) => { if (id === seq.current.a) setError(friendlyError(e)); }).finally(() => { if (id === seq.current.a) setLoading((l) => ({ ...l, antrean: false })); });
  }, [tab, q, sort, tick]);

  const reloadAll = useCallback(() => setTick((n) => n + 1), []);
  const muatHalamanBerikut = useCallback(async () => {
    if (!antrean?.hasMore || muatLagi) return; setMuatLagi(true);
    try { const r = await api.getRencanaAntrean({ tab, q, sort, page: antrean.page + 1 }); setAntrean((a) => (a ? { ...r, items: [...a.items, ...r.items] } : r)); } catch (e) { setError(friendlyError(e)); } finally { setMuatLagi(false); }
  }, [antrean, muatLagi, tab, q, sort]);

  return { minggu, dayData, antrean, loading, error, setError, reloadAll, muatHalamanBerikut, muatLagi };
}
