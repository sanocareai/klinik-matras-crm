import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { friendlyError } from "@/features/production/experience.js";
import { jobFromV1, jobFromV2, orderJobs } from "./workerAppModel.js";

// Satu sumber pekerjaan untuk beranda/bahan/aktivitas. TIDAK ada antrean paralel:
//  - V2 = antrean server `GET /production-v2/worker/:lane` (urutan dari server);
//  - V1 = `GET /production/v1-worker-queue?lane=` (read-model server: penugasan sah termasuk yang belum dimulai, menunggu prasyarat/penugasan; lini Meja/Corner kanonik),
//    diperkaya `GET /units/:id/timeline` (Layanan Sales, catatan, foto, progres jalur V1). Kegagalan V1 TIDAK menjatuhkan antrean V2 (status sendiri).
const POLL_V2_MS = 30_000;
const POLL_V1_MS = 30_000; // serah-terima antar PIC harus cepat terlihat

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

export default function useWorkerJobs({ lane = "TABLE", paused = false } = {}) {
  const laneKey = lane === "CORNER" ? "corner" : "table";
  const [v2, setV2] = useState({ items: null, operator: null, readerMode: null });
  const [v1, setV1] = useState({ status: "idle", items: [], timelines: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const timelinesRef = useRef({});
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const loadV1 = useCallback(async () => {
    setV1((s0) => ({ ...s0, status: s0.items.length ? s0.status : "loading" }));
    try {
      const d = await api.getV1WorkerQueue(laneKey);
      const items = d?.items || [];
      const fresh = {};
      await inBatches(items, 4, async (it) => { try { fresh[it.unit.id] = await api.getUnitTimeline(it.unit.id); } catch { if (timelinesRef.current[it.unit.id]) fresh[it.unit.id] = timelinesRef.current[it.unit.id]; } });
      timelinesRef.current = fresh;
      if (aliveRef.current) setV1({ status: "ready", items, timelines: fresh });
    } catch {
      if (aliveRef.current) setV1((s0) => ({ ...s0, status: "error" }));
    }
  }, [laneKey]);

  const loadQueue = useCallback(async ({ withV1 = true } = {}) => {
    try {
      const d = await api.getProductionV2WorkerQueue(laneKey);
      if (!aliveRef.current) return;
      setV2({ items: d.items || [], operator: d.operator || null, readerMode: d.readerMode });
      setError("");
    } catch (e) { if (aliveRef.current) setError(friendlyError(e)); }
    finally { if (aliveRef.current) setLoading(false); }
    if (withV1) loadV1();
  }, [laneKey, loadV1]);

  useEffect(() => { setLoading(true); loadQueue(); }, [loadQueue]);
  useEffect(() => {
    const v2Tick = () => { if (document.visibilityState === "visible" && !paused) loadQueue({ withV1: false }); };
    const v1Tick = () => { if (document.visibilityState === "visible" && !paused) loadV1(); };
    const a = setInterval(v2Tick, POLL_V2_MS); const b = setInterval(v1Tick, POLL_V1_MS);
    document.addEventListener("visibilitychange", v2Tick); document.addEventListener("visibilitychange", v1Tick);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener("visibilitychange", v2Tick); document.removeEventListener("visibilitychange", v1Tick); };
  }, [loadQueue, loadV1, paused]);

  const jobs = useMemo(() => {
    const a = (v2.items || []).map(jobFromV2);
    const b = v1.items.map((it) => jobFromV1(it, v1.timelines[it.unit.id] || null));
    return orderJobs([...a, ...b]);
  }, [v2.items, v1.items, v1.timelines]);

  const reload = useCallback(() => { setLoading(true); return loadQueue(); }, [loadQueue]);
  // Setelah sebuah aksi: muat ulang V2 DAN V1 (keadaan/serah-terima harus segar; kartu yang dialihkan hilang, kartu menunggu muncul).
  const reloadAll = useCallback(async () => { await Promise.all([loadQueue({ withV1: false }), loadV1()]); }, [loadQueue, loadV1]);
  // Unit V1 yang baru berubah: muat ulang timeline-nya saja (tanpa memuat ulang seluruh daftar).
  const refreshV1Unit = useCallback(async (unitId) => {
    try { const tl = await api.getUnitTimeline(unitId); timelinesRef.current = { ...timelinesRef.current, [unitId]: tl }; setV1((s0) => ({ ...s0, timelines: timelinesRef.current })); return tl; } catch { return null; }
  }, []);

  return {
    jobs, loading, error, readerMode: v2.readerMode, operator: v2.operator, v2Items: v2.items, v1Status: v1.status,
    reload, reloadAll, refreshV1Unit, retryV1: () => loadV1(), fetchV1Queue: () => api.getV1WorkerQueue(laneKey),
  };
}
