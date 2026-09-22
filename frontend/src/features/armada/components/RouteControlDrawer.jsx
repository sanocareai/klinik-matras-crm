import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "react-router-dom";
import { X, User, Users, Truck, AlertTriangle, History, ExternalLink } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import Avatar from "@/components/Avatar.jsx";
import { formatTanggal, formatTanggalJam, formatRelatif } from "@/utils/formatDate.js";
import { JOB_STATUS_REAL, customerOf, orderNumberOf } from "../jobStatus.js";
import { ROUTE_STATUS_REAL, effectiveRouteStatus } from "../vehicleStatus.js";
import { ISSUE_STATUS, issueStatusOf } from "../issueStatus.js";
import { deriveRouteProgress, deriveRouteExceptions, deriveRouteCity } from "../controlTowerRules.js";
import { cn } from "@/lib/utils.js";

// Detail rute — drawer slide-over (pola SAMA dengan RevisionDetailDrawer.jsx/
// dialog Radix lain di app ini, "fixed right-0 h-full w-full sm:w-[…]
// slide-in-from-right" — CSS transition ringan bawaan Tailwind, BUKAN
// library animasi/blur berat, sesuai permintaan "hindari animasi dan blur
// berat"). Read-only murni (Control Tower BUKAN alat edit — tindakan
// sungguhan tetap lewat Route Planner, tombol "Buka di Route Planner" di
// bawah cuma navigasi).
export default function RouteControlDrawer({ route, onClose }) {
  const navigate = useNavigate();
  if (!route) return null;

  const progress = deriveRouteProgress(route);
  const exceptions = deriveRouteExceptions(route);
  const jobs = route.jobs || [];
  const kota = deriveRouteCity(route);

  return (
    <Dialog.Root open={!!route} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label={`Detail Rute ${route.code}`}
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="truncate text-[14.5px] font-bold text-ink">{route.code}</h2>
                <StatusBadge map={ROUTE_STATUS_REAL} value={effectiveRouteStatus(route)} />
              </div>
              <p className="mt-0.5 text-[11.5px] text-ink3">
                {route.date && formatTanggal(route.date)}{kota ? ` · ${kota}` : ""}
              </p>
            </div>
            <Dialog.Close aria-label="Tutup" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Exceptions aktif — PALING ATAS, ini yang paling penting untuk
                dispatcher lihat dulu sebelum detail lain (pola sama dengan
                Needs Attention di ArmadaDashboard.jsx). */}
            {exceptions.length > 0 && (
              <div className="border-b border-line bg-redbg/20 px-4 py-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-red">
                  <AlertTriangle size={13} /> {exceptions.length} Perlu Perhatian
                </h3>
                <ul className="flex flex-col gap-2">
                  {exceptions.map((e) => (
                    <li key={e.type} className="rounded-btn bg-surface px-2.5 py-2">
                      <p className={cn("text-[12px] font-semibold", e.severity === "critical" ? "text-red" : "text-orange")}>
                        {e.label}
                      </p>
                      {e.detail && <p className="mt-0.5 text-[11px] text-ink3">{e.detail}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Crew & Kendaraan */}
            <div className="border-b border-line px-4 py-3">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Crew &amp; Kendaraan</h3>
              <div className="flex flex-col gap-2.5">
                {route.driver ? (
                  <PersonRow icon={User} label="Driver" person={route.driver} route={route} />
                ) : (
                  <p className="flex items-center gap-2 text-[12.5px] font-semibold text-orange"><User size={14} /> Belum ada driver</p>
                )}
                {route.helper && <PersonRow icon={Users} label="Helper" person={route.helper} route={route} />}
                <p className="flex items-center gap-2 text-[12.5px] text-ink">
                  <Truck size={14} className="text-ink3" />
                  {route.vehicle ? `${route.vehicle.plateNumber}${route.vehicle.type ? ` · ${route.vehicle.type}` : ""}` : (
                    <span className="font-semibold text-orange">Belum ada kendaraan</span>
                  )}
                </p>
              </div>
            </div>

            {/* Progress */}
            <div className="border-b border-line px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink3">Progress</h3>
                <span className="text-[12px] font-bold text-ink">{progress.done}/{progress.total} stop selesai</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "0%" }}
                />
              </div>
              {progress.activeJob && (
                <p className="mt-1.5 text-[11.5px] text-ink2">
                  Sedang di stop: <span className="font-semibold text-ink">{customerOf(progress.activeJob) || "—"}</span>
                </p>
              )}
              {progress.lastUpdatedAt && (
                <p className="mt-1 text-[10.5px] text-ink3">Diperbarui {formatRelatif(progress.lastUpdatedAt)}</p>
              )}
            </div>

            {/* Ordered stops */}
            <div className="border-b border-line px-4 py-3">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Urutan Stop ({jobs.length})</h3>
              {jobs.length === 0 ? (
                <p className="text-[12px] text-ink3">Belum ada stop di rute ini.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {jobs.map((j, i) => (
                    <li key={j.id} className="flex items-start gap-2.5 rounded-btn bg-inset/60 px-2.5 py-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accentbg text-[10px] font-bold text-accent">
                        {j.sequence || i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</span>
                          <StatusBadge map={JOB_STATUS_REAL} value={j.status} />
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-ink3">
                          {orderNumberOf(j) || "—"}{j.addressText ? ` · ${j.addressText}` : ""}
                        </p>
                        {j.status === "COMPLETED" && (
                          <div className="mt-2 rounded-btn border border-line bg-surface p-2">
                            <p className="text-[11px] font-semibold text-ink">
                              {j.type === "PICKUP" ? "Pemberi barang" : "Penerima"}: {j.proofRecipientName || "Belum dicatat"}
                            </p>
                            <p className="mt-0.5 text-[10.5px] text-ink3">
                              {j.completedBy?.name ? `Dilakukan ${j.completedBy.name}` : "Pelaksana belum tercatat"}
                              {j.completedAt ? ` · ${formatTanggalJam(j.completedAt)}` : ""}
                            </p>
                            {j.proofNote && <p className="mt-1 text-[11px] text-ink2">{j.proofNote}</p>}
                            {j.proofLat != null && j.proofLng != null && (
                              <p className="mt-1 text-[10.5px] text-ink3">
                                GPS {Number(j.proofLat).toFixed(5)}, {Number(j.proofLng).toFixed(5)}
                                {j.proofAccuracy != null ? ` · akurasi ±${Math.round(j.proofAccuracy)} m` : ""}
                              </p>
                            )}
                            {j.proofPhotoUrls?.length > 0 && (
                              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                                {j.proofPhotoUrls.map((src) => (
                                  <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                                    <img src={src} alt="Bukti serah terima" loading="lazy" className="h-16 w-16 rounded-btn object-cover" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Masalah — job gagal, status OPEN/RESCHEDULED (satu definisi
                dengan tab Kendala & Reschedule, lihat issueStatusOf). */}
            {(() => {
              const bermasalah = jobs.filter((j) => issueStatusOf(j));
              if (bermasalah.length === 0) return null;
              return (
                <div className="border-b border-line px-4 py-3">
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Masalah</h3>
                  <ul className="flex flex-col gap-2">
                    {bermasalah.map((j) => {
                      const st = issueStatusOf(j);
                      return (
                        <li key={j.id} className="rounded-btn bg-redbg/20 px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-semibold text-ink">{customerOf(j) || "—"}</span>
                            <StatusBadge map={ISSUE_STATUS} value={st} />
                          </div>
                          <p className="mt-0.5 text-[11px] text-ink3">{j.failureReason || j.rescheduleReason || "Tidak ada alasan tercatat"}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}

            {/* Timeline menggabungkan titik waktu rute/job yang tersimpan dan
                JobIssueLog append-only untuk gagal/reschedule. Edit rute masih
                hanya menyimpan edit terakhir; keterbatasan itu dinyatakan di
                bagian Jejak Audit, bukan dipresentasikan sebagai ledger penuh. */}
            <div className="border-b border-line px-4 py-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                <History size={12} /> Linimasa
              </h3>
              <RouteTimeline route={route} />
            </div>

            {/* Audit trail — Route.lastEditReason (kolom biasa, bukan ledger
                append-only, lihat catatan panjang di schema.prisma — TETAP
                ditampilkan apa adanya, bukan riwayat penuh tiap edit). */}
            <div className="px-4 py-3">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Jejak Audit</h3>
              <div className="flex flex-col gap-2 text-[11.5px]">
                <AuditRow label="Rute dibuat" actor={route.createdBy?.name} at={route.createdAt} />
                {route.publishedAt && <AuditRow label="Rute diterbitkan" at={route.publishedAt} />}
                {route.lastEditedAt && <AuditRow label="Edit terakhir" actor={route.lastEditedBy?.name} at={route.lastEditedAt} note={route.lastEditReason} warning />}
              </div>
            </div>
          </div>

          {/* Footer — tindakan cepat, navigasi ke Route Planner (BUKAN edit
              di sini, Control Tower read-only murni). */}
          <div className="border-t border-line px-4 py-3">
            <button
              type="button"
              onClick={() => navigate("/armada/routes")}
              className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent px-3 py-2.5 text-[12.5px] font-semibold text-white hover:opacity-90"
            >
              <ExternalLink size={13} /> Buka di Route Planner
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PersonRow({ icon: Icon, label, person, route }) {
  // Peringatan sinkron (22 September 2026) — SATU DEFINISI dengan
  // RouteCard.jsx: lastAppSyncAt HANYA membuktikan server terakhir berhasil
  // membalas GET /my-jobs, BUKAN bukti diterima/dilihat — copy JUJUR.
  const belumSinkron = route.status === "PUBLISHED" &&
    (!person.lastAppSyncAt || (route.publishedAt && new Date(person.lastAppSyncAt) < new Date(route.publishedAt)));
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={person.name} size="sm" gradient />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold text-ink">{person.name}</span>
          <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink3">{label}</span>
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", person.isOnline ? "bg-green" : "bg-ink3")} title={person.isOnline ? "Online" : "Offline"} />
        </div>
        <p className="mt-0.5 text-[10.5px] text-ink3">
          {person.lastAppSyncAt
            ? `Terakhir ambil data ${formatRelatif(person.lastAppSyncAt)}`
            : "Belum pernah tercatat mengambil data"}
        </p>
      </div>
      {belumSinkron && <Badge variant="orange">Belum sinkron</Badge>}
    </div>
  );
}

function RouteTimeline({ route }) {
  const events = [];
  if (route.createdAt) events.push({ at: route.createdAt, label: "Rute dibuat" });
  if (route.publishedAt) events.push({ at: route.publishedAt, label: "Diterbitkan ke driver" });
  if (route.lastEditedAt) events.push({ at: route.lastEditedAt, label: `Diedit${route.lastEditedBy?.name ? ` oleh ${route.lastEditedBy.name}` : ""}` });
  if (route.startedAt && !(route.executionEvents || []).some((event) => event.action === "ROUTE_STARTED")) {
    events.push({ at: route.startedAt, label: "Rute dimulai" });
  }
  if (route.completedAt) events.push({ at: route.completedAt, label: "Rute selesai", done: true });
  for (const event of route.executionEvents || []) {
    if (event.action === "ROUTE_STARTED") {
      events.push({ at: event.createdAt, label: `Rute dimulai${event.actor?.name ? ` oleh ${event.actor.name}` : ""}` });
    }
  }
  for (const j of route.jobs || []) {
    const nama = customerOf(j) || "Stop";
    const execution = j.executionEvents || [];
    if (execution.length > 0) {
      for (const event of execution) {
        const actor = event.actor?.name ? ` oleh ${event.actor.name}` : "";
        const label = {
          JOB_STARTED: `Menuju ${nama}${actor}`,
          JOB_ARRIVED: `Tiba di ${nama}${actor}`,
          JOB_COMPLETED: `Selesai — ${nama}${actor}`,
          JOB_FAILED: `Gagal — ${nama}${actor}`,
        }[event.action];
        if (label) events.push({ at: event.createdAt, label, done: event.action === "JOB_COMPLETED", problem: event.action === "JOB_FAILED" });
      }
    } else {
      if (j.arrivedAt) events.push({ at: j.arrivedAt, label: `Tiba di ${nama}` });
      if (j.completedAt) events.push({ at: j.completedAt, label: `Selesai — ${nama}`, done: true });
    }
    for (const log of j.issueLogs || []) {
      events.push({
        at: log.createdAt,
        label: log.type === "FAILED" ? `Gagal — ${nama}` : `Dijadwalkan ulang — ${nama}`,
        problem: log.type === "FAILED",
      });
    }
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));

  if (events.length === 0) return <p className="text-[12px] text-ink3">Belum ada aktivitas tercatat.</p>;
  return (
    <ol className="flex flex-col gap-2.5 border-l-2 border-line pl-3">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className={cn(
            "absolute -left-[17px] top-1 h-2 w-2 rounded-full",
            e.problem ? "bg-red" : e.done ? "bg-green" : "bg-accent"
          )} />
          <p className="text-[12px] text-ink">{e.label}</p>
          <p className="text-[10.5px] text-ink3">{formatTanggalJam(e.at)}</p>
        </li>
      ))}
    </ol>
  );
}

function AuditRow({ label, actor, at, note, warning = false }) {
  return (
    <div className={cn("rounded-btn px-2.5 py-2", warning ? "bg-orangebg text-orange" : "bg-inset/60 text-ink2")}>
      <p className="font-semibold">{label}{actor ? ` oleh ${actor}` : ""}</p>
      <p className="mt-0.5 text-[10.5px] opacity-80">{formatTanggalJam(at)}</p>
      {note && <p className="mt-1">{note}</p>}
    </div>
  );
}
