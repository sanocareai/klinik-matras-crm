import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, CheckCircle2, ClipboardList, LogOut, PackageX, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import ThemeToggle from "@/components/ThemeToggle.jsx";
import { DemoBarSlot } from "@/features/production/demo/DemoControls.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { emptyFilters, reportQuery } from "@/features/production/reporting.js";
import { lastActiveTabPath } from "@/lib/openTabs.js";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import JobCard, { JobPhoto } from "./JobCard.jsx";
import { allowedModes, initialsOf, materialRows, picSummary, safeText, splitJobs } from "./workerAppModel.js";

// ---------------------------------------------------------------- Kerja ("Pekerjaan Saya")
export function KerjaTab({ jobs, lane, loading, error, readerMode, operator, v1Status, onRetryV1, onOpen, onReload, user }) {
  const { active, queue } = useMemo(() => splitJobs(jobs), [jobs]);
  const pic = picSummary(jobs, { lane, user, all: operator?.all });
  const laneTitle = lane === "CORNER" ? "Meja Corner" : "Meja Bongkar";
  return (
    <div data-testid="tab-kerja">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold text-ink3">{laneTitle}</p>
          <h1 className="wa-h1" data-testid="home-title">Pekerjaan Saya</h1>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1.5" data-testid="pic-summary">
          <span className="wa-wrap inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-accentbg px-3 py-1.5 text-[12.5px] font-bold text-accent"><span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] text-white">{initialsOf(pic.name)}</span><span className="truncate">{operator?.all ? "Akses penuh" : pic.name}</span></span>
          {pic.stations.map((s) => <span key={s} className="rounded-full bg-inset px-3 py-1.5 text-[12.5px] font-semibold text-ink2">{s}</span>)}
          {pic.centers.map((s) => <span key={s} className="rounded-full bg-inset px-3 py-1.5 text-[12.5px] font-semibold text-ink2">{s}</span>)}
        </div>
      </div>

      {jobs.length > 0 && (
        <p className="m-0 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-ink2" data-testid="jobs-summary">
          <span>{jobs.length} pekerjaan</span>
          {jobs.some((j) => j.materialWaiting) && <span className="text-red">{jobs.filter((j) => j.materialWaiting).length} menunggu bahan</span>}
          {jobs.some((j) => j.late) && <span className="text-orange">{jobs.filter((j) => j.late).length} terlambat</span>}
          {jobs.some((j) => j.source === "V1") && <span>{jobs.filter((j) => j.source === "V1").length} jalur V1</span>}
        </p>
      )}
      {error && <div role="alert" data-testid="kerja-error" className="mb-3 flex items-center justify-between gap-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red"><span className="min-w-0">{safeText(error)}</span><button type="button" onClick={onReload} className="shrink-0 rounded-btn px-3 py-2 font-bold underline">Coba lagi</button></div>}
      {v1Status === "error" && <div role="status" data-testid="v1-error" className="mb-3 flex items-center justify-between gap-3 rounded-btn bg-orangebg px-3 py-3 text-[13px] text-orange"><span>Pekerjaan jalur V1 belum bisa dimuat. Antrean V2 tetap tampil.</span><button type="button" onClick={onRetryV1} className="shrink-0 font-bold underline">Muat ulang V1</button></div>}

      {loading && !jobs.length ? (
        <div className="wa-grid" data-testid="kerja-loading">{[1, 2, 3].map((n) => <div key={n} className="wa-card h-72 animate-pulse bg-inset" />)}</div>
      ) : readerMode === "OFF" && !jobs.length ? (
        <div className="wa-card p-6 text-center" data-testid="kerja-off"><ClipboardList className="mx-auto mb-2 text-ink3" size={32} aria-hidden /><p className="m-0 font-bold text-ink">Produksi V2 belum aktif</p><p className="m-0 mt-1 text-[13.5px] text-ink2">Gunakan alur Work Order lama sampai Production Lead mengaktifkan V2.</p></div>
      ) : !jobs.length ? (
        <div className="wa-card p-8 text-center" data-testid="kerja-empty">
          <CheckCircle2 className="mx-auto mb-2 text-green" size={36} aria-hidden />
          <p className="m-0 text-[16px] font-bold text-ink">{operator && !operator.all ? "Tidak ada pekerjaan untuk Anda" : "Anda belum terdaftar sebagai operator"}</p>
          <p className="m-0 mt-1 text-[13.5px] text-ink2">{operator && !operator.all ? "Pekerjaan muncul di sini setelah Planner menugaskannya ke Anda." : "Minta Production Lead menambahkan Anda sebagai operator agar antrean muncul."}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {active && (
            <section aria-label="Sedang dikerjakan" data-testid="section-active">
              <h2 className="mb-2 mt-0 text-[13px] font-extrabold uppercase tracking-wide text-ink3">Sedang dikerjakan</h2>
              <div className="wa-grid"><JobCard job={active} onOpen={onOpen} variant="active" /></div>
            </section>
          )}
          <section aria-label="Antrean" data-testid="section-queue">
            <h2 className="mb-2 mt-0 flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-ink3">Antrean <span className="rounded-full bg-inset px-2 py-0.5 text-[12px] tabular-nums normal-case tracking-normal text-ink2">{queue.length}</span></h2>
            {queue.length ? <div className="wa-grid">{queue.map((j, i) => <JobCard key={j.key} job={j} onOpen={onOpen} position={i + 1} />)}</div> : <p className="m-0 text-[13.5px] text-ink2">Tidak ada antrean lain.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Bahan
export function BahanTab({ jobs, loading, onOpen, onReport, canReport }) {
  const rows = useMemo(() => materialRows(jobs), [jobs]);
  return (
    <div data-testid="tab-bahan">
      <h1 className="wa-h1 mb-1">Bahan</h1>
      <p className="m-0 mb-4 text-[13.5px] text-ink2">Status bahan semua pekerjaan Anda. Yang menunggu bahan tampil paling atas.</p>
      {loading && !rows.length ? <div className="space-y-3">{[1, 2].map((n) => <div key={n} className="wa-card h-24 animate-pulse bg-inset" />)}</div> : !rows.length ? (
        <div className="wa-card p-8 text-center" data-testid="bahan-empty"><PackageX className="mx-auto mb-2 text-ink3" size={32} aria-hidden /><p className="m-0 font-bold text-ink">Belum ada pekerjaan</p><p className="m-0 mt-1 text-[13.5px] text-ink2">Status bahan muncul setelah ada pekerjaan yang ditugaskan.</p></div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2" data-testid="bahan-list">
          {rows.map((r) => (
            <li key={r.key} className="wa-card p-3" data-testid="bahan-row" data-kind={r.kind} data-unit-code={r.job.unitCode}>
              <div className="flex gap-3">
              <div className="w-24 shrink-0 self-start overflow-hidden rounded-btn"><JobPhoto job={r.job} /></div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="wa-wrap m-0 line-clamp-2 text-[15px] font-extrabold text-ink">{r.job.customerName}</p>
                <p className="m-0 truncate text-[12.5px] text-ink3">{r.job.unitCode} · {r.job.source}</p>
                {r.kind === "SHORTAGE" && <div className="rounded-btn bg-redbg px-2.5 py-2 text-[12.5px] text-red"><p className="m-0 font-bold">Bahan kurang — Gudang diberi tahu</p><ul className="m-0 mt-1 list-disc pl-4">{r.items.map((i) => <li key={i.materialId}>{i.name}{i.qty ? ` — ${i.qty}` : ""}</li>)}</ul></div>}
                {r.kind === "WAITING" && <p className="m-0 rounded-btn bg-redbg px-2.5 py-2 text-[12.5px] font-bold text-red">Menunggu bahan</p>}
                {r.kind === "STATUS" && r.badge && <p className="m-0 text-[13px] font-semibold text-ink2">{r.badge.label}</p>}
                {r.kind === "NONE" && <p className="m-0 text-[12.5px] text-ink3">Rencana bahan belum ada (muncul setelah diagnosis).</p>}
                {r.kind === "V1" && <p className="m-0 text-[12.5px] text-ink3">Jalur V1: pemakaian bahan dicatat di detail pekerjaan.</p>}
              </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => onOpen(r.job)} className="flex min-h-[48px] items-center justify-center rounded-btn bg-accentbg px-3 text-center text-[14px] font-bold text-accent">Buka pekerjaan</button>
                {r.job.source === "V2" && canReport && r.kind !== "SHORTAGE" ? <button type="button" data-testid="bahan-report" onClick={() => onReport(r.job)} className="flex min-h-[48px] items-center justify-center rounded-btn bg-redbg px-3 text-center text-[14px] font-bold text-red">Menunggu Bahan Baku</button> : <span />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Aktivitas
const Tile = ({ label, value, tone = "neutral", testid }) => (
  <div className="wa-card p-4" data-testid={testid}><p className="m-0 text-[12.5px] font-semibold text-ink3">{label}</p><p className={`m-0 mt-1 text-[28px] font-extrabold tabular-nums leading-none ${tone === "red" ? "text-red" : tone === "green" ? "text-green" : "text-ink"}`}>{value ?? "—"}</p></div>
);
export function AktivitasTab({ jobs, onOpen }) {
  const [doc, setDoc] = useState(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const qs = useMemo(() => reportQuery(toApiParams(makeRange("last_7_days")), emptyFilters()), []);
  useEffect(() => {
    let alive = true; setLoading(true);
    api.getProductionReport("my-summary", qs).then((d) => { if (alive) { setDoc(d); setError(""); } }).catch((e) => { if (alive) setError(friendlyError(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [qs]);
  const byUnit = useMemo(() => new Map(jobs.map((j) => [j.unitCode, j])), [jobs]);
  const p = doc?.pekerjaan;
  return (
    <div data-testid="tab-aktivitas">
      <h1 className="wa-h1 mb-1">Aktivitas</h1>
      <p className="m-0 mb-4 text-[13.5px] text-ink2">Ringkasan pekerjaan Anda 7 hari terakhir (data server).</p>
      {error && <p role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red" data-testid="aktivitas-error">{safeText(error)}</p>}
      {loading && !doc ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((n) => <div key={n} className="wa-card h-24 animate-pulse bg-inset" />)}</div> : doc ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Ditugaskan" value={p?.ditugaskan} testid="tile-ditugaskan" /><Tile label="Berjalan" value={p?.berjalan} testid="tile-berjalan" />
            <Tile label="Selesai" value={p?.selesai} tone="green" testid="tile-selesai" /><Tile label="Terlambat" value={p?.terlambat} tone={p?.terlambat ? "red" : "neutral"} testid="tile-terlambat" />
          </div>
          {(doc.dokumentasi?.pengirimanDokumentasi > 0 || doc.qc?.inspeksiDilakukan > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {doc.dokumentasi?.pengirimanDokumentasi > 0 && <Tile label="Dokumentasi dikirim" value={doc.dokumentasi.pengirimanDokumentasi} />}
              {doc.qc?.inspeksiDilakukan > 0 && <Tile label="Inspeksi QC" value={doc.qc.inspeksiDilakukan} />}
            </div>
          )}
          <h2 className="mb-2 mt-5 text-[13px] font-extrabold uppercase tracking-wide text-ink3">Unit periode ini</h2>
          {doc.unit?.length ? (
            <ul className="m-0 grid list-none gap-2 p-0 md:grid-cols-2" data-testid="aktivitas-units">
              {doc.unit.map((u) => { const j = byUnit.get(u.unitCode); return (
                <li key={u.runId} className="wa-card flex items-center justify-between gap-3 px-4 py-3"><span className="min-w-0"><span className="block truncate text-[15px] font-bold text-ink">{u.unitCode}</span><span className="text-[12.5px] text-ink3">{u.status}</span></span>{j ? <button type="button" onClick={() => onOpen(j)} className="min-h-[44px] shrink-0 rounded-btn bg-accentbg px-4 text-[13.5px] font-bold text-accent">Buka</button> : <span className="text-[12.5px] text-ink3">tidak aktif</span>}</li>
              ); })}
            </ul>
          ) : <div className="wa-card p-6 text-center" data-testid="aktivitas-empty"><p className="m-0 font-bold text-ink">Belum ada aktivitas</p><p className="m-0 mt-1 text-[13.5px] text-ink2">Pekerjaan yang ditugaskan dan diselesaikan akan tampil di sini.</p></div>}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Akun
const ROLE_LABEL = { PRODUCTION_WORKER: "Operator Produksi", PRODUCTION_LEAD: "Production Lead", QC_LEAD: "QC", WAREHOUSE: "Gudang", PRODUCTION_DOCUMENTER: "Dokumenter", ADMIN: "Admin", OWNER: "Owner" };
export function AkunTab({ user, roles, lane, pathname, onLogout, navigate }) {
  const modes = allowedModes(roles);
  const desktopOk = roles.some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(r));
  return (
    <div data-testid="tab-akun" className="mx-auto max-w-[560px]">
      <h1 className="wa-h1 mb-4">Akun</h1>
      <div className="wa-card flex items-center gap-4 p-4" data-testid="akun-profile">
        <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#0B2454] text-[20px] font-extrabold text-white">{initialsOf(user?.name)}</span>
        <div className="min-w-0"><p className="wa-wrap m-0 text-[18px] font-extrabold text-ink">{user?.name || "Pengguna"}</p><div className="mt-1 flex flex-wrap gap-1.5">{roles.map((r) => <span key={r} className="rounded-full bg-accentbg px-2.5 py-0.5 text-[12px] font-bold text-accent">{ROLE_LABEL[r] || r}</span>)}</div></div>
      </div>
      <h2 className="mb-2 mt-5 flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-wide text-ink3"><ArrowRightLeft size={14} aria-hidden /> Mode aplikasi</h2>
      <div className="wa-card divide-y divide-line" data-testid="mode-switcher">
        {modes.map((m) => {
          const current = m.lane ? m.lane === lane : false;
          return <button key={m.key} type="button" data-testid={`mode-${m.key}`} aria-current={current ? "true" : undefined} disabled={current} onClick={() => navigate(m.to)} className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 text-left disabled:cursor-default"><span className="text-[15px] font-semibold text-ink">{m.label}</span>{current ? <span className="rounded-full bg-accentbg px-2.5 py-0.5 text-[12px] font-bold text-accent">Aktif</span> : <span className="text-[13px] font-semibold text-accent">Buka</span>}</button>;
        })}
        {!modes.length && <p className="m-0 px-4 py-4 text-[13.5px] text-ink2">Peran Anda tidak punya mode aplikasi lantai.</p>}
      </div>
      <h2 className="mb-2 mt-5 text-[13px] font-extrabold uppercase tracking-wide text-ink3">Pengaturan</h2>
      <div className="wa-card divide-y divide-line">
        <div className="flex min-h-[56px] items-center justify-between px-4"><span className="text-[15px] font-semibold text-ink">Tampilan terang / gelap</span><ThemeToggle /></div>
        <button type="button" onClick={() => window.location.reload()} className="flex min-h-[56px] w-full items-center justify-between px-4 text-left"><span className="text-[15px] font-semibold text-ink">Muat ulang aplikasi</span><RefreshCw size={17} className="text-ink3" aria-hidden /></button>
        {desktopOk && <Link to={lastActiveTabPath(pathname) || "/portal"} className="flex min-h-[56px] items-center justify-between px-4 text-ink no-underline"><span className="text-[15px] font-semibold">Buka SANSS (desktop)</span><span className="text-[13px] font-semibold text-accent">Buka</span></Link>}
        {onLogout && <button type="button" data-testid="logout" onClick={onLogout} className="flex min-h-[56px] w-full items-center justify-between px-4 text-left text-red"><span className="text-[15px] font-bold">Keluar</span><LogOut size={18} aria-hidden /></button>}
      </div>
      {/* Mode Latihan (hanya peran yang berhak): dipindahkan dari atas header aplikasi ke sini; perilaku demo tidak berubah. */}
      <div className="mt-5 [&>div]:px-0" data-testid="akun-latihan"><DemoBarSlot /></div>
    </div>
  );
}
