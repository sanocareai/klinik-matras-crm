import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { friendlyError } from "@/features/production/experience.js";
import { jobFromV1, jobFromV2, myV1Units, orderJobs } from "./workerAppModel.js";

// Satu sumber pekerjaan untuk beranda/bahan/aktivitas. TIDAK ada antrean paralel:
//  - V2 = antrean server `GET /production-v2/worker/:lane` (urutan dari server);
//  - V1 = unit non-cohort yang ditugaskan ke operator yang SAMA (`GET /production/work-orders`, assignedOperator.id), diperkaya `GET /units/:id/timeline`.
// V1 hanya di Aplikasi Meja (tahap V1 tidak punya konsep Table/Corner — tidak ditebak). Kegagalan V1 TIDAK menjatuhkan antrean V2 (diberi status sendiri).
const POLL_V2_MS = 30_000;
const POLL_V1_MS = 90_000;
const V1_STATUSES = ["IN_PRODUCTION", "RECEIVED"];

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

export default function useWorkerJobs({ lane = "TABLE", paused = false } = {}) {
  const laneKey = lane === "CORNER" ? "corner" : "table";
  const [v2, setV2] = useState({ items: null, operator: null, readerMode: null });
  const [v1, setV1] = useState({ status: "idle", units: [], timelines: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const operatorRef = useRef(null);
  const timelinesRef = useRef({});
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const loadV1 = useCallback(async (operatorId) => {
    if (lane === "CORNER" || !operatorId) { setV1({ status: "idle", units: [], timelines: {} }); return; }
    setV1((s) => ({ ...s, status: s.units.length ? s.status : "loading" }));
    try {
      const lists = await Promise.all(V1_STATUSES.map((status) => api.getWorkOrders({ status })));
      const units = myV1Units(lists.flatMap((d) => d?.units || []), operatorId);
      const fresh = {};
      await inBatches(units, 4, async (u) => { try { fresh[u.id] = await api.getUnitTimeline(u.id); } catch { if (timelinesRef.current[u.id]) fresh[u.id] = timelinesRef.current[u.id]; } });
      timelinesRef.current = fresh;
      if (aliveRef.current) setV1({ status: "ready", units, timelines: fresh });
    } catch {
      if (aliveRef.current) setV1((s) => ({ ...s, status: "error" }));
    }
  }, [lane]);

  const loadQueue = useCallback(async ({ withV1 = true } = {}) => {
    try {
      const d = await api.getProductionV2WorkerQueue(laneKey);
      if (!aliveRef.current) return;
      operatorRef.current = d.operator?.id ?? null;
      setV2({ items: d.items || [], operator: d.operator || null, readerMode: d.readerMode });
      setError("");
      if (withV1) loadV1(d.operator?.id ?? null);
    } catch (e) { if (aliveRef.current) setError(friendlyError(e)); }
    finally { if (aliveRef.current) setLoading(false); }
  }, [laneKey, loadV1]);

  useEffect(() => { setLoading(true); loadQueue(); }, [loadQueue]);
  useEffect(() => {
    const v2Tick = () => { if (document.visibilityState === "visible" && !paused) loadQueue({ withV1: false }); };
    const v1Tick = () => { if (document.visibilityState === "visible" && !paused && operatorRef.current) loadV1(operatorRef.current); };
    const a = setInterval(v2Tick, POLL_V2_MS); const b = setInterval(v1Tick, POLL_V1_MS);
    document.addEventListener("visibilitychange", v2Tick);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener("visibilitychange", v2Tick); };
  }, [loadQueue, loadV1, paused]);

  const jobs = useMemo(() => {
    const a = (v2.items || []).map(jobFromV2);
    const b = v1.units.map((u) => jobFromV1(u, v1.timelines[u.id] || null));
    return orderJobs([...a, ...b]);
  }, [v2.items, v1.units, v1.timelines]);

  const reload = useCallback(() => { setLoading(true); return loadQueue(); }, [loadQueue]);
  // Unit V1 yang baru berubah: muat ulang timeline-nya saja (tanpa memuat ulang seluruh daftar).
  const refreshV1Unit = useCallback(async (unitId) => {
    try { const tl = await api.getUnitTimeline(unitId); timelinesRef.current = { ...timelinesRef.current, [unitId]: tl }; setV1((s) => ({ ...s, timelines: timelinesRef.current })); return tl; } catch { return null; }
  }, []);

  return { jobs, loading, error, readerMode: v2.readerMode, operator: v2.operator, v2Items: v2.items, v1Status: v1.status, reload, reloadQueueOnly: () => loadQueue({ withV1: false }), refreshV1Unit, retryV1: () => loadV1(operatorRef.current) };
}
