// Histori Waktu Route & Stop (7 Okt 2026) — dipakai web admin (modal di
// RouteCard) DAN Driver Web (DriverJobs.jsx, rute milik sendiri) — SATU
// komponen, bukan dua (gerbang akses sudah dibedakan server: JOB_WRITE lihat
// rute mana pun, JOB_OWN_WRITE cuma rute sendiri, lihat GET /routes/:id/timeline).
import React, { useEffect, useState } from "react";
import { Clock, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import {
  formatTimelineEvent, formatKoreksi, formatDurasiSingkatID, ACTION_LABEL, TIDAK_TERSEDIA,
} from "../routeTimelineFormat.js";

const JOB_STEP_ORDER = ["JOB_STARTED", "JOB_ARRIVED", "JOB_COMPLETED", "JOB_FAILED", "JOB_RESCHEDULED"];

function Baris({ action, event }) {
  const f = formatTimelineEvent(event);
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${f ? "bg-accent" : "bg-ink3/40"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-semibold text-ink">{ACTION_LABEL[action] || action}</span>
          <span className={`text-xs ${f ? "text-ink2" : "text-ink3 italic"}`}>{f ? f.waktu : TIDAK_TERSEDIA}</span>
        </div>
        {f && (f.actorName || f.sourceLabel) && (
          <p className="text-[10.5px] text-ink3">{[f.actorName, f.sourceLabel].filter(Boolean).join(" · ")}</p>
        )}
        {f && f.catatan.length > 0 && (
          <div className="mt-0.5 flex items-start gap-1">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-orange" />
            <p className="text-[10.5px] text-orange">{f.catatan.join("; ")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function JobTimeline({ job }) {
  const byAction = new Map(job.events.map((e) => [e.action, e]));
  const steps = JOB_STEP_ORDER.filter((a) => a !== "JOB_FAILED" || byAction.has("JOB_FAILED")).filter(
    (a) => a !== "JOB_COMPLETED" || !byAction.has("JOB_FAILED") // Selesai ATAU Gagal, tidak dua-duanya (job hanya salah satu)
  ).filter((a) => a !== "JOB_RESCHEDULED" || byAction.has("JOB_RESCHEDULED"));

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink">
          Stop {job.sequence ?? "—"} · {job.customerName || "—"}
          {job.orderNumber ? <span className="font-normal text-ink3"> ({job.orderNumber})</span> : null}
        </p>
      </div>
      <div className="mt-1.5 divide-y divide-border/60">
        {steps.map((action) => (
          <Baris key={action} action={action} event={byAction.get(action) || null} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ink3">
        <span>Waktu tempuh: {job.travelMs != null ? formatDurasiSingkatID(job.travelMs) : TIDAK_TERSEDIA}</span>
        <span>Waktu layanan: {job.serviceMs != null ? formatDurasiSingkatID(job.serviceMs) : TIDAK_TERSEDIA}</span>
      </div>
      {job.corrections.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {job.corrections.map((c, i) => {
            const k = formatKoreksi(c);
            return (
              <p key={i} className="text-[10.5px] text-ink3">
                <span className="font-semibold text-ink2">Dikoreksi {k.actorName}</span> ({k.waktu}): waktu selesai {k.dari} → {k.ke} — {k.alasan}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function RouteTimeline({ routeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try { setData(await api.getRouteTimeline(routeId)); }
    catch (e) { setErr(e.message || "Gagal memuat histori waktu"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [routeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="flex items-center gap-2 py-4 text-xs text-ink2"><Loader2 className="h-4 w-4 animate-spin" /> Memuat histori waktu…</div>;
  }
  if (err) return <p className="py-2 text-xs text-red">{err}</p>;
  if (!data) return null;

  const berangkat = data.routeEvents.find((e) => e.action === "ROUTE_STARTED") || null;
  const selesaiRute = data.routeEvents.find((e) => e.action === "ROUTE_COMPLETED") || null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink2">
          <Clock className="h-3.5 w-3.5" /> Histori Waktu
        </p>
        <button type="button" onClick={load} className="text-ink3 hover:text-accent"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      <div className="rounded-lg border border-border p-3">
        <Baris action="ROUTE_STARTED" event={berangkat} />
        <Baris action="ROUTE_COMPLETED" event={selesaiRute} />
      </div>
      {data.jobs.length === 0 ? (
        <p className="text-xs text-ink3">Belum ada stop di rute ini.</p>
      ) : (
        <div className="space-y-2">
          {data.jobs.map((job) => <JobTimeline key={job.jobId} job={job} />)}
        </div>
      )}
    </div>
  );
}
