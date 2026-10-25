import React, { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks, Loader2, Users2 } from "lucide-react";
import { api } from "../../api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";

// Main Hub (Okt 2026, perubahan arah Owner) — "Tugas Saya" / "Pantauan
// Leader" / "Hasil Meeting" di Portal.jsx. SEMUA data dari
// GET /hub/summary/me dan GET /hub/summary/leaders (server-to-server di
// baliknya; lihat backend/src/services/hubSummary.js) — tidak ada angka
// karangan di sini. Setiap kartu MANDIRI (loading/kosong/error sendiri)
// supaya HUB yang mati/lambat tidak pernah menjatuhkan Portal secara
// keseluruhan — hanya kartu itu yang menunjukkan status tidak tersedia.

function formatDueDate(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(iso));
}

function formatHeldAt(iso) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const PRIORITY_VARIANT = { URGENT: "red", HIGH: "orange", MEDIUM: "accent", LOW: "neutral", NONE: "neutral" };
const PRIORITY_LABEL = { URGENT: "Mendesak", HIGH: "Tinggi", MEDIUM: "Sedang", LOW: "Rendah", NONE: null };

function PriorityBadge({ priority }) {
  const label = PRIORITY_LABEL[priority];
  if (!label) return null;
  return <Badge variant={PRIORITY_VARIANT[priority] || "neutral"}>{label}</Badge>;
}

/** Tautan ke tujuan SPESIFIK di HUB lewat alur SSO yang sudah ada (GET
 *  /sso/start?next=...) — BUKAN navigasi langsung ke /workspace/..., supaya
 *  sesi HUB terbentuk/diperpanjang dengan benar walau pengguna belum pernah
 *  (atau sudah lama tidak) membuka Task & Meeting sesi ini. Navigasi PENUH
 *  (window.location), bukan React Router — ini lintas origin secara logis
 *  (lihat openPortal() di Portal.jsx). */
function openHubDestination(hubPath, destination) {
  if (!hubPath) return;
  window.location.assign(`${hubPath}?next=${encodeURIComponent(destination)}`);
}

function TaskRow({ task, hubPath }) {
  return (
    <button
      type="button"
      onClick={() => openHubDestination(hubPath, `/projects/${task.projectId}/board?task=${task.id}`)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{task.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink3">{task.projectName}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {task.overdue && <Badge variant="red">Terlambat</Badge>}
        {task.dueDate && <span className={cn("text-[11px]", task.overdue ? "font-semibold text-red" : "text-ink3")}>{formatDueDate(task.dueDate)}</span>}
        <PriorityBadge priority={task.priority} />
      </div>
    </button>
  );
}

function MeetingRow({ meeting, hubPath }) {
  return (
    <button
      type="button"
      onClick={() => openHubDestination(hubPath, `/meetings/${meeting.id}`)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{meeting.title}</p>
        <p className="mt-0.5 text-[11px] text-ink3">{formatHeldAt(meeting.heldAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink3">
        <span>{meeting.decisionCount} keputusan</span>
        {meeting.myOpenActionItemCount > 0 && <Badge variant="orange">{meeting.myOpenActionItemCount} tindak lanjut</Badge>}
      </div>
    </button>
  );
}

/** Satu panggilan GET /hub/summary/me, dipakai bersama oleh "Tugas Saya" dan
 *  "Hasil Meeting" — dua kartu, satu sumber data, bukan dua fetch terpisah
 *  untuk hal yang sama. */
function useOwnSummary() {
  // loading | ok | unavailable | no-access | error
  const [state, setState] = useState("loading");
  const [data, setData] = useState(null);

  useEffect(() => {
    let batal = false;
    api
      .getHubSummaryMe()
      .then((res) => {
        if (batal) return;
        setData(res);
        setState("ok");
      })
      .catch((err) => {
        if (batal) return;
        setState(err.status === 503 ? "unavailable" : err.status === 403 ? "no-access" : "error");
      });
    return () => {
      batal = true;
    };
  }, []);

  return { state, data };
}

function CardShell({ title, action, children }) {
  return (
    <section className="flex min-h-[220px] flex-col rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold tracking-[-.01em] text-ink">{title}</h3>
        {action}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function LoadingRow({ label }) {
  return (
    <div className="flex items-center gap-2 py-6 text-ink3">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

export function TugasSayaCard({ hubPath, own }) {
  const { state, data } = own;
  if (state === "no-access") return null;

  return (
    <CardShell
      title="Tugas Saya"
      action={
        hubPath && state === "ok" && data?.connected ? (
          <button type="button" onClick={() => openHubDestination(hubPath, "/my-tasks")} className="text-[11px] font-semibold text-accent hover:underline">
            Lihat semua
          </button>
        ) : null
      }
    >
      {state === "loading" && <LoadingRow label="Memuat tugas…" />}
      {state === "unavailable" && <EmptyState compact icon={AlertTriangle} title="Task & Meeting tidak tersedia" description="Coba lagi sebentar lagi." />}
      {state === "error" && <EmptyState compact icon={AlertTriangle} title="Gagal memuat tugas" description="Terjadi kesalahan. Muat ulang halaman." />}
      {state === "ok" && !data.connected && (
        <EmptyState compact icon={ListChecks} title="Belum terhubung ke Task & Meeting" description="Buka Task & Meeting sekali untuk mulai mengelola tugas Anda di sini." />
      )}
      {state === "ok" && data.connected && data.summary.tasks.items.length === 0 && (
        <EmptyState compact icon={CheckCircle2} title="Tidak ada tugas aktif" description="Semua tugas Anda selesai." />
      )}
      {state === "ok" && data.connected && data.summary.tasks.items.length > 0 && (
        <>
          <div className="mb-1.5 flex items-center gap-3 px-2 text-[11px] text-ink3">
            <span>{data.summary.tasks.total} tugas aktif</span>
            {data.summary.tasks.overdueCount > 0 && <span className="font-semibold text-red">{data.summary.tasks.overdueCount} terlambat</span>}
          </div>
          <div className="flex flex-col gap-0.5">
            {data.summary.tasks.items.map((t) => (
              <TaskRow key={t.id} task={t} hubPath={hubPath} />
            ))}
          </div>
        </>
      )}
    </CardShell>
  );
}

export function HasilMeetingCard({ hubPath, own }) {
  const { state, data } = own;
  if (state === "no-access") return null;

  return (
    <CardShell
      title="Hasil Meeting"
      action={
        hubPath && state === "ok" && data?.connected ? (
          <button type="button" onClick={() => openHubDestination(hubPath, "/meetings")} className="text-[11px] font-semibold text-accent hover:underline">
            Lihat semua
          </button>
        ) : null
      }
    >
      {state === "loading" && <LoadingRow label="Memuat meeting…" />}
      {state === "unavailable" && <EmptyState compact icon={AlertTriangle} title="Task & Meeting tidak tersedia" description="Coba lagi sebentar lagi." />}
      {state === "error" && <EmptyState compact icon={AlertTriangle} title="Gagal memuat meeting" description="Terjadi kesalahan. Muat ulang halaman." />}
      {state === "ok" && !data.connected && (
        <EmptyState compact icon={CalendarClock} title="Belum terhubung ke Task & Meeting" description="Buka Task & Meeting sekali untuk melihat rapat Anda di sini." />
      )}
      {state === "ok" && data.connected && data.summary.meetings.items.length === 0 && (
        <EmptyState compact icon={CalendarClock} title="Belum ada meeting" description="Meeting yang Anda ikuti akan muncul di sini." />
      )}
      {state === "ok" && data.connected && data.summary.meetings.items.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {data.summary.meetings.items.map((m) => (
            <MeetingRow key={m.id} meeting={m} hubPath={hubPath} />
          ))}
        </div>
      )}
    </CardShell>
  );
}

/** "Pantauan Leader" — HANYA tampil untuk pemegang HUB_LEADER_MONITOR
 *  (Owner-only di tahap ini; backend menjawab 403 untuk yang lain, dan
 *  kartu ini meresponsnya dengan TIDAK RENDER APA PUN, bukan pesan error —
 *  sama perlakuan dengan kartu "Task & Meeting" di grid workspace di atas). */
export function PantauanLeaderCard({ hubPath }) {
  // loading | ok | unavailable | no-access | error
  const [state, setState] = useState("loading");
  const [leaders, setLeaders] = useState(null);

  useEffect(() => {
    let batal = false;
    api
      .getHubSummaryLeaders()
      .then((res) => {
        if (batal) return;
        setLeaders(res.leaders || []);
        setState("ok");
      })
      .catch((err) => {
        if (batal) return;
        setState(err.status === 503 ? "unavailable" : err.status === 403 ? "no-access" : "error");
      });
    return () => {
      batal = true;
    };
  }, []);

  if (state === "no-access") return null;

  return (
    <CardShell title="Pantauan Leader">
      {state === "loading" && <LoadingRow label="Memuat pantauan leader…" />}
      {state === "unavailable" && <EmptyState compact icon={AlertTriangle} title="Task & Meeting tidak tersedia" description="Coba lagi sebentar lagi." />}
      {state === "error" && <EmptyState compact icon={AlertTriangle} title="Gagal memuat Pantauan Leader" description="Terjadi kesalahan. Muat ulang halaman." />}
      {state === "ok" && leaders.length === 0 && (
        <EmptyState
          compact
          icon={Users2}
          title="Belum ada leader divisi yang ditetapkan"
          description="Admin/Owner dapat menetapkan leader lewat Pengguna & Divisi. Setelah ditetapkan, progres tugas & meeting mereka tampil di sini."
        />
      )}
      {state === "ok" && leaders.length > 0 && (
        <div className="flex flex-col divide-y divide-line">
          {leaders.map((l) => (
            <div key={l.userId} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{l.name || "(tanpa nama)"}</p>
                  <p className="truncate text-[10px] uppercase tracking-[.04em] text-ink3">{l.divisions.join(", ")}</p>
                </div>
                {!l.connected ? (
                  <Badge variant="neutral">Belum terhubung</Badge>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-ink3">{l.summary.tasks.total} tugas</span>
                    {l.summary.tasks.overdueCount > 0 && <Badge variant="red">{l.summary.tasks.overdueCount} terlambat</Badge>}
                  </div>
                )}
              </div>
              {l.connected && l.summary.tasks.items.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                  {l.summary.tasks.items.slice(0, 3).map((t) => (
                    <TaskRow key={t.id} task={t} hubPath={hubPath} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

export { useOwnSummary };
