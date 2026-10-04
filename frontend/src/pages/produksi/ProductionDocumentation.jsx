import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api.js";
import { CaptureSheet, useDraftManager } from "@/features/production/DocumentationDraftUi.jsx";
import DocDetail from "@/features/production/docApp/DocDetail.jsx";
import { DocAkun, DrafTab, KameraTab, UnitTab } from "@/features/production/docApp/DocTabs.jsx";
import { DOC_NAV_TABS, docFriendlyError, docGroupOf, docTabOf } from "@/features/production/documentation.js";
import WorkerAppShell from "@/features/production/workerApp/WorkerAppShell.jsx";
import { rolesOf } from "@/lib/roles.js";

// Aplikasi Dokumentasi (P10B, desain modern P12D) — mode aplikasi mobile-first/PWA, kerangka & komponen yang SAMA dengan Aplikasi Meja/Corner.
// Bottom navigation: Unit · Kamera · Draf · Akun. Antrean unit cohort + matriks dokumentasi kanonis (12 kategori, dari backend) + kamera/galeri,
// keterangan, urutan, unggah per berkas dengan progres/coba lagi, dan koreksi bersejarah — SEMUA lewat draf IndexedDB/endpoint/permission/cohort yang sudah ada.
// Dokumentasi TIDAK menyelesaikan tahap: tahap yang mewajibkan foto tetap ditutup dari Aplikasi Meja/Corner. Server = otoritas izin;
// tombol tulis hanya tampil bila `canWrite` dari server. Tidak ada harga/pembayaran/finance di layar ini.
// URL: ?t=<unit|kamera|draf|akun>&run=<runId>&g=<BEFORE|PROCESS|AFTER> (tautan dalam, tombol kembali, dan muat ulang tetap konsisten).
const POLL_MS = 60_000;
function storedUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

export default function ProductionDocumentation({ user: userProp = null, onLogout = null }) {
  const user = userProp || storedUser();
  const roles = rolesOf(user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = docTabOf(params.get("t"));
  const runId = params.get("run");
  const group = docGroupOf(params.get("g"));

  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resume, setResume] = useState(null);
  const [standalone, setStandalone] = useState(null); // draf yang dilanjutkan dari panel Draf (tanpa memuat detail unit dari server)
  const [camera, setCamera] = useState(null); // { detail, category } dari tab Kamera
  const [purgeNote, setPurgeNote] = useState(true);
  const [flash, setFlash] = useState("");
  const reqRef = useRef(0);
  const drafts = useDraftManager();

  const setParam = useCallback((patch, { replace = true } = {}) => setParams((p) => { const n = new URLSearchParams(p); for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); } return n; }, { replace }), [setParams]);
  const setTab = useCallback((t) => setParam({ t, run: null, g: null }), [setParam]);
  const openRun = useCallback((id) => setParam({ run: id }, { replace: false }), [setParam]);
  const closeRun = useCallback(() => { setResume(null); setParam({ run: null, g: null }); }, [setParam]);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async () => {
    const id = ++reqRef.current;
    try {
      const d = await api.getProductionV2DocQueue({ filter, q: qDebounced });
      if (id === reqRef.current) { setData(d); setError(""); }
    } catch (e) { if (id === reqRef.current) setError(docFriendlyError(e)); } finally { if (id === reqRef.current) setLoading(false); }
  }, [filter, qDebounced]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible" && !runId) load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [load, runId]);
  // Pengiriman latar belakang selesai -> segarkan antrean + pemberitahuan terkirim.
  useEffect(() => { if (drafts.lastSent) load(); }, [drafts.lastSent, load]);
  useEffect(() => { window.scrollTo(0, 0); }, [runId, tab]);

  const items = data?.items || [];
  const detailOpen = !!runId;
  const current = detailOpen ? items.find((i) => i.runId === runId) : null;
  const title = detailOpen ? (current?.customerName || "Dokumentasi unit") : "Aplikasi Dokumentasi";
  const subtitle = detailOpen ? (current ? [`Resi ${current.orderNumber || "—"}`, current.unit.unitCode].join(" · ") : null) : (data ? `${items.length} unit${filter !== "ALL" ? " (disaring)" : ""}` : "Memuat…");
  const badges = useMemo(() => ({ draf: drafts.records.length }), [drafts.records.length]);

  return (
    <WorkerAppShell tabs={DOC_NAV_TABS} title={title} subtitle={subtitle} tab={tab} onTab={setTab} badges={badges} hideNav={detailOpen} actionPad={detailOpen}
      onBack={detailOpen ? closeRun : null} onRefresh={() => { setLoading(true); load(); }} refreshing={loading}>
      {flash && <div role="status" className="mb-3 rounded-btn bg-greenbg px-3 py-3 text-[13.5px] font-semibold text-green" data-testid="flash">{flash}</div>}
      {drafts.lastSent && <div role="status" className="mb-3 rounded-btn bg-greenbg px-3 py-3 text-[13.5px] font-semibold text-green" data-testid="sent-note" key={drafts.lastSent.at}>{drafts.lastSent.count} foto {drafts.lastSent.corrected ? "koreksi " : ""}terkirim{drafts.lastSent.label ? ` ke ${drafts.lastSent.label}` : ""}{drafts.lastSent.unitCode ? ` (${drafts.lastSent.unitCode})` : ""}.</div>}
      {error && <div role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red" data-testid="queue-error">{error}</div>}

      {detailOpen ? (
        <DocDetail runId={runId} group={group} onGroup={(g) => setParam({ g })} drafts={drafts} resume={resume} onResumeConsumed={() => setResume(null)} onChanged={load} />
      ) : tab === "unit" ? (
        <UnitTab data={data} items={items} loading={loading} filter={filter} onFilter={setFilter} q={q} onQ={setQ} qDebounced={qDebounced} onOpen={openRun} />
      ) : tab === "kamera" ? (
        <KameraTab items={items} readerMode={data?.readerMode} canWrite={!!data?.canWrite && !!drafts.manager} onCapture={(detail, category) => setCamera({ detail, category })} />
      ) : tab === "draf" ? (
        <DrafTab drafts={drafts} onResume={(r) => setStandalone(r)} purgeNote={purgeNote} onDismissPurge={() => setPurgeNote(false)} />
      ) : (
        <DocAkun user={user} roles={roles} pathname={pathname} onLogout={onLogout} navigate={navigate} drafts={drafts} />
      )}

      {standalone && drafts.manager && (
        <CaptureSheet manager={drafts.manager} online={drafts.online} resumeId={standalone.id}
          detail={{ runId: standalone.runId, unit: { unitCode: standalone.unitCode || "Unit" }, customerName: standalone.customerName }}
          category={{ key: standalone.category, label: standalone.categoryLabel || "Dokumentasi", min: null, items: [] }}
          correction={standalone.correction ? { evidenceId: standalone.correction.evidenceId } : undefined}
          onClose={() => { setStandalone(null); drafts.refresh(); }}
          onDone={async () => { setStandalone(null); drafts.refresh(); load(); }} />
      )}
      {camera && drafts.manager && (
        <CaptureSheet manager={drafts.manager} online={drafts.online} detail={camera.detail} category={camera.category}
          onClose={() => { setCamera(null); drafts.refresh(); }}
          onDone={async (msg) => { setCamera(null); setFlash(msg); setTimeout(() => setFlash(""), 5000); drafts.refresh(); load(); }} />
      )}
    </WorkerAppShell>
  );
}
