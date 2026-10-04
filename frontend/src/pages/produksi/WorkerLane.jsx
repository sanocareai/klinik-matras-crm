import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { friendlyError } from "@/features/production/experience.js";
import JobDetail from "@/features/production/workerApp/JobDetail.jsx";
import WorkerAppShell from "@/features/production/workerApp/WorkerAppShell.jsx";
import { AkunTab, AktivitasTab, BahanTab, KerjaTab } from "@/features/production/workerApp/Tabs.jsx";
import { ShortageSheet } from "@/features/production/workerApp/workerSheets.jsx";
import useWorkerJobs from "@/features/production/workerApp/useWorkerJobs.js";
import { modeOfLane, tabOf } from "@/features/production/workerApp/workerAppModel.js";
import { rolesOf } from "@/lib/roles.js";

// P12C — Aplikasi Meja / Corner (mode aplikasi, mobile-first). Bottom navigation: Kerja · Bahan · Aktivitas · Akun. Tanpa sidebar desktop.
// Server = otoritas urutan, izin, dan aksi berikutnya. Semua aksi memakai endpoint/command yang sudah ada (V2: /production-v2 steps, diagnosis, shortage;
// V1: /units stages & materials). Antrean tunggal (useWorkerJobs): V2 dari server + unit V1 yang ditugaskan ke operator yang sama — bukan antrean paralel.
// URL: ?t=<tab>&job=<v2:runId|v1:unitId> (tautan dalam, tombol kembali, dan muat ulang tetap konsisten).
function storedUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

export default function WorkerLane({ lane = "TABLE", user: userProp = null, onLogout = null }) {
  const user = userProp || storedUser();
  const roles = rolesOf(user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = tabOf(params.get("t"));
  const jobKey = params.get("job");
  const [reportCard, setReportCard] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [flashErr, setFlashErr] = useState("");

  const { jobs, loading, error, readerMode, operator, v1Status, reload, reloadAll, refreshV1Unit, retryV1, fetchV1Queue } = useWorkerJobs({ lane, paused: !!jobKey || !!reportCard });
  const selected = useMemo(() => (jobKey ? jobs.find((j) => j.key === jobKey) || null : null), [jobs, jobKey]);
  const mode = modeOfLane(lane);

  const setTab = useCallback((t) => setParams((p) => { const n = new URLSearchParams(p); n.set("t", t); n.delete("job"); return n; }, { replace: true }), [setParams]);
  const openJob = useCallback((job) => setParams((p) => { const n = new URLSearchParams(p); n.set("job", job.key); return n; }), [setParams]);
  const closeJob = useCallback(() => setParams((p) => { const n = new URLSearchParams(p); n.delete("job"); return n; }, { replace: true }), [setParams]);

  // Laporan "Menunggu Bahan Baku" dari tab Bahan: muat kartu server dulu (butuh BOM + revisi terbaru), lalu lembar yang SAMA dengan di detail.
  async function reportShortage(job) {
    setReportBusy(true); setFlashErr("");
    try { setReportCard(await api.getProductionV2Card(job.id)); } catch (e) { setFlashErr(friendlyError(e)); } finally { setReportBusy(false); }
  }
  const canReport = lane === "TABLE";
  const badges = useMemo(() => ({ bahan: jobs.filter((j) => j.materialWaiting).length }), [jobs]);

  const detailOpen = !!jobKey;
  // Membuka/menutup detail atau pindah tab selalu mulai dari atas (posisi gulir daftar tidak terbawa).
  useEffect(() => { window.scrollTo(0, 0); }, [jobKey, tab]);
  const title = detailOpen ? (selected?.customerName || "Pekerjaan") : (mode?.label || "Aplikasi Meja");
  const subtitle = detailOpen ? (selected ? [selected.orderNumber, selected.unitCode].filter(Boolean).join(" · ") : null) : (user?.name || null);

  return (
    <WorkerAppShell title={title} subtitle={subtitle} tab={tab} onTab={setTab} badges={badges} hideNav={detailOpen} actionPad={detailOpen}
      onBack={detailOpen ? closeJob : null} onRefresh={reload} refreshing={loading || reportBusy}>
      {flash && <div role="status" className="mb-3 rounded-btn bg-greenbg px-3 py-3 text-[13.5px] font-semibold text-green">{flash}</div>}
      {flashErr && <div role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{flashErr}</div>}

      {detailOpen ? (
        selected ? <JobDetail key={selected.key} job={selected} lane={lane} roles={roles} onBack={closeJob} onChanged={reloadAll} refreshV1Unit={refreshV1Unit} fetchV1Queue={fetchV1Queue} />
          : loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={26} aria-hidden /></div>
            : (
              <div className="wa-card mx-auto max-w-[560px] p-8 text-center" data-testid="job-gone">
                <p className="m-0 text-[16px] font-bold text-ink">Pekerjaan tidak lagi di antrean Anda</p>
                <p className="m-0 mt-1 text-[13.5px] text-ink3">Mungkin sudah selesai, dipindahkan ke tim lain, atau ditugaskan ulang.</p>
                <button type="button" onClick={closeJob} className="mt-4 min-h-[48px] rounded-btn bg-accent px-6 text-[15px] font-bold text-white">Kembali ke Pekerjaan Saya</button>
              </div>
            )
      ) : tab === "kerja" ? (
        <KerjaTab jobs={jobs} lane={lane} loading={loading} error={error} readerMode={readerMode} operator={operator} v1Status={v1Status} onRetryV1={retryV1} onOpen={openJob} onReload={reload} user={user} />
      ) : tab === "bahan" ? (
        <BahanTab jobs={jobs} loading={loading} onOpen={openJob} onReport={reportShortage} canReport={canReport} />
      ) : tab === "aktivitas" ? (
        <AktivitasTab jobs={jobs} onOpen={openJob} />
      ) : (
        <AkunTab user={user} roles={roles} lane={lane} pathname={pathname} onLogout={onLogout} navigate={navigate} />
      )}

      {reportCard && <ShortageSheet card={reportCard} onClose={() => setReportCard(null)} onDone={async () => { setReportCard(null); setFlash("Gudang sudah diberi tahu."); setTimeout(() => setFlash(""), 4000); await reload(); }} />}
    </WorkerAppShell>
  );
}
