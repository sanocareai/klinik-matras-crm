import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { isDemoActive } from "@/features/production/demo/demoGate.js";
import { backlogOf } from "@/features/production/unitCardModel.js";
import { friendlyError } from "@/features/production/experience.js";

// Backlog "Belum Dijadwalkan" Rencana Produksi (simplifikasi slice 1): filter + paginasi di SERVER (GET /production-v2/backlog) — tidak berhenti di 500 unit.
// Default = order nyata berstatus Diproses; "Pengambilan" filter eksplisit; Siap Kirim/Terkirim tidak pernah masuk. Halaman dimuat bertahap ("Muat lagi");
// setelah aksi jadwal, halaman yang sudah terbuka dimuat ulang dari server (tidak optimistic). Mode Latihan: dari Command Center sintetis (tanpa jaringan).
export const BACKLOG_PAGE_SIZE = 25;
export const BACKLOG_STATUS_TABS = Object.freeze([{ key: "DIPROSES", label: "Diproses" }, { key: "PENGAMBILAN", label: "Pengambilan" }]);

export default function useBacklog({ demoColumns = null } = {}) {
  const [status, setStatus] = useState("DIPROSES");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [state, setState] = useState({ items: [], total: 0, counts: {}, hasMore: false, page: 0, readerMode: null, loading: true, error: "", truncated: false });
  const reqRef = useRef(0);
  const demo = isDemoActive();

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  // Muat halaman 1..pages (urut) lalu gabungkan; id permintaan membuang jawaban basi bila filter berubah di tengah jalan.
  const fetchPages = useCallback(async (pages) => {
    const id = ++reqRef.current;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      let acc = []; let last = null;
      for (let p = 1; p <= pages; p += 1) {
        last = await api.getProductionV2Backlog({ status, q: qDebounced, page: p, pageSize: BACKLOG_PAGE_SIZE });
        if (id !== reqRef.current) return;
        acc = acc.concat(last.items || []);
        if (!last.hasMore) break;
      }
      setState({ items: acc, total: last?.total ?? acc.length, counts: last?.counts || {}, hasMore: !!last?.hasMore, page: Math.max(1, Math.ceil(acc.length / BACKLOG_PAGE_SIZE)), readerMode: last?.readerMode ?? null, loading: false, error: "", truncated: !!last?.truncated });
    } catch (e) { if (id === reqRef.current) setState((s) => ({ ...s, loading: false, error: friendlyError(e) })); }
  }, [status, qDebounced]);

  const pagesLoadedRef = useRef(1);
  useEffect(() => { pagesLoadedRef.current = Math.max(1, state.page); }, [state.page]);
  useEffect(() => { if (!demo) fetchPages(1); }, [demo, fetchPages]); // filter/pencarian berubah -> kembali ke halaman 1
  const reload = useCallback(() => (demo ? Promise.resolve() : fetchPages(pagesLoadedRef.current)), [demo, fetchPages]);
  const loadMore = useCallback(async () => {
    if (demo || state.loading || !state.hasMore) return;
    const id = ++reqRef.current; const next = state.page + 1;
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api.getProductionV2Backlog({ status, q: qDebounced, page: next, pageSize: BACKLOG_PAGE_SIZE });
      if (id !== reqRef.current) return;
      setState((s) => ({ ...s, items: s.items.concat(r.items || []), total: r.total, counts: r.counts || s.counts, hasMore: !!r.hasMore, page: next, loading: false, truncated: !!r.truncated }));
    } catch (e) { if (id === reqRef.current) setState((s) => ({ ...s, loading: false, error: friendlyError(e) })); }
  }, [demo, state.loading, state.hasMore, state.page, status, qDebounced]);

  const demoItems = useMemo(() => (demo ? backlogOf(demoColumns).map((view) => ({ unitId: view.unit.id, schedulable: true, view, card: null })) : []), [demo, demoColumns]);
  const items = demo ? demoItems : state.items;
  const schedulableViews = useMemo(() => items.filter((i) => i.schedulable && i.view).map((i) => i.view), [items]);
  return {
    status, setStatus, q, setQ, items, schedulableViews, reload, loadMore,
    total: demo ? demoItems.length : state.total, counts: demo ? { DIPROSES: demoItems.length, PENGAMBILAN: 0 } : state.counts, hasMore: demo ? false : state.hasMore,
    loading: demo ? false : state.loading, error: demo ? "" : state.error, truncated: state.truncated, demo, readerMode: state.readerMode,
  };
}
