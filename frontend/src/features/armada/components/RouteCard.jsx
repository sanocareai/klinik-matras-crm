import React, { useState } from "react";
import { GripVertical, X, ArrowUpDown, Send, Ban, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils.js";
import StatusBadge from "./StatusBadge.jsx";
import { ROUTE_STATUS_REAL } from "../vehicleStatus.js";
import { customerOf, unitCountOf } from "../jobStatus.js";

// Satu kolom rute di Route Planner — drop target untuk job dari panel kiri
// ATAU dari kolom rute lain, plus drag-reorder stop di dalamnya.
//
// KAPASITAS dihitung dari SUM(unitCount job) vs vehicle.capacitySlots — kalau
// kendaraan belum dipilih, kapasitas tidak ditampilkan (bukan dianggap 0/∞).
// Peringatan kapasitas MUNCUL, TIDAK MEMBLOKIR drop: dispatcher yang tahu
// konteks nyata (satu kasur king vs single beda ruang sebenarnya, kapasitas
// slot ini masih perkiraan kasar) — sistem menandai, manusia memutuskan.
export default function RouteCard({
  route, drivers, vehicles, draggingJobId,
  onDrop, onReorder, onRemoveJob, onAssign, onPublish, onCancel, onOptimize,
}) {
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [busy, setBusy] = useState(false);

  const jobs = route.jobs || [];
  const totalUnits = jobs.reduce((sum, j) => sum + unitCountOf(j), 0);
  const kapasitas = route.vehicle?.capacitySlots;
  const overCapacity = kapasitas != null && totalUnits > kapasitas;
  const isDraft = route.status === "DRAFT";

  async function jalankan(fn) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  function handleDropOnCard(e) {
    e.preventDefault();
    setDragOverIdx(null);
    if (!isDraft) return;
    const jobId = e.dataTransfer.getData("text/job-id") || draggingJobId;
    if (jobId) jalankan(() => onDrop(route, jobId, jobs.length));
  }

  function handleDropAtIndex(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);
    if (!isDraft) return;
    const jobId = e.dataTransfer.getData("text/job-id") || draggingJobId;
    if (!jobId) return;
    const sudahDiRuteIni = jobs.some((j) => j.id === jobId);
    if (sudahDiRuteIni) jalankan(() => onReorder(route, jobId, idx));
    else jalankan(() => onDrop(route, jobId, idx));
  }

  return (
    <div className={cn(
      "flex w-[300px] shrink-0 flex-col rounded-card border bg-surface",
      route.status === "CANCELLED" ? "border-border opacity-60" : "border-border"
    )}>
      {/* Header */}
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-bold text-ink">{route.code}</span>
          <StatusBadge map={ROUTE_STATUS_REAL} value={route.status} className="ml-auto shrink-0" />
        </div>

        {isDraft ? (
          <>
            <select
              value={route.driverId || ""}
              onChange={(e) => jalankan(() => onAssign(route, { driverId: e.target.value || null }))}
              aria-label={`Driver untuk ${route.code}`}
              className="h-8 w-full rounded-btn border border-border bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-accent"
            >
              <option value="">Pilih driver…</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select
              value={route.vehicleId || ""}
              onChange={(e) => jalankan(() => onAssign(route, { vehicleId: e.target.value || null }))}
              aria-label={`Kendaraan untuk ${route.code}`}
              className="h-8 w-full rounded-btn border border-border bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-accent"
            >
              <option value="">Pilih kendaraan…</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber} · {v.capacitySlots} slot</option>)}
            </select>
          </>
        ) : (
          <div className="text-[11.5px] text-ink2">
            {route.driver?.name || "Tanpa driver"} · {route.vehicle?.plateNumber || "Tanpa kendaraan"}
          </div>
        )}

        <div className={cn("flex items-center justify-between text-[10.5px]", overCapacity ? "font-semibold text-red" : "text-ink3")}>
          <span>{jobs.length} stop{kapasitas != null && ` · ${totalUnits}/${kapasitas} slot`}</span>
          {route.plannedDistanceKm != null && <span>{route.plannedDistanceKm} km · {route.plannedDurationMin} mnt</span>}
        </div>
        {overCapacity && (
          <p className="text-[10px] font-semibold text-red">Melebihi kapasitas kendaraan yang dipilih.</p>
        )}
      </div>

      {/* Daftar stop — drop target */}
      <div
        onDragOver={(e) => { if (isDraft) { e.preventDefault(); setDragOverIdx(jobs.length); } }}
        onDrop={handleDropOnCard}
        className={cn("min-h-[80px] flex-1 space-y-1.5 p-2", dragOverIdx !== null && isDraft && "bg-accentbg/40")}
      >
        {jobs.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-ink3">
            {isDraft ? "Seret job ke sini" : "Tidak ada stop"}
          </p>
        ) : (
          jobs
            .slice()
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .map((j, idx) => (
              <div
                key={j.id}
                draggable={isDraft}
                onDragStart={(e) => e.dataTransfer.setData("text/job-id", j.id)}
                onDragOver={(e) => { if (isDraft) { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); } }}
                onDrop={(e) => handleDropAtIndex(e, idx)}
                className={cn(
                  "flex items-start gap-1.5 rounded-btn border border-border bg-inset px-2 py-1.5",
                  isDraft && "cursor-grab active:cursor-grabbing",
                  dragOverIdx === idx && "ring-2 ring-accent"
                )}
              >
                {isDraft && <GripVertical size={12} className="mt-0.5 shrink-0 text-ink3" aria-hidden />}
                <span className="mt-0.5 shrink-0 text-[10px] font-bold text-ink3">{idx + 1}.</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
                  <div className="truncate text-[10px] text-ink2">{j.addressText || "—"}</div>
                </div>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() => jalankan(() => onRemoveJob(route, j.id))}
                    aria-label={`Keluarkan job dari ${route.code}`}
                    className="mt-0.5 shrink-0 text-ink3 transition-colors hover:text-red"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))
        )}
      </div>

      {/* Aksi */}
      {isDraft && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line p-2">
          <button
            type="button"
            onClick={() => jalankan(() => onOptimize(route))}
            disabled={jobs.length < 2 || busy}
            title="Urutkan stop berdasarkan jam & alamat"
            className="flex h-7 items-center gap-1 rounded-chip px-2 text-[10.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint disabled:opacity-40"
          >
            <ArrowUpDown size={11} /> Urutkan
          </button>
          <button
            type="button"
            onClick={() => jalankan(() => onCancel(route))}
            disabled={busy}
            className="flex h-7 items-center gap-1 rounded-chip px-2 text-[10.5px] font-semibold text-ink3 transition-colors hover:bg-redbg hover:text-red"
          >
            <Ban size={11} /> Batal
          </button>
          <button
            type="button"
            onClick={() => jalankan(() => onPublish(route))}
            disabled={busy || jobs.length === 0 || !route.driverId}
            title={!route.driverId ? "Pilih driver dulu" : jobs.length === 0 ? "Tambahkan job dulu" : "Terbitkan ke driver"}
            className="ml-auto flex h-7 items-center gap-1 rounded-chip bg-accent px-2.5 text-[10.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Terbitkan
          </button>
        </div>
      )}
    </div>
  );
}
