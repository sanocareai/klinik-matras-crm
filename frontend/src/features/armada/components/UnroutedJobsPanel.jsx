import React from "react";
import { Package } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import Avatar from "@/components/Avatar.jsx";
import { customerOf, unitCountOf } from "../jobStatus.js";

// Panel kiri Route Planner: job pada tanggal terpilih yang BELUM masuk rute
// mana pun (routeId=null). Diseret ke salah satu RouteCard di kanan.
//
// Drag & drop HTML5 native — pola yang SAMA dengan Pipeline.jsx (Kanban lead),
// bukan library baru. `draggable` + onDragStart menaruh job.id di dataTransfer;
// RouteCard yang membacanya di onDrop.
export default function UnroutedJobsPanel({ jobs, loading, draggingId, onDragStart, onDragEnd }) {
  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <h3 className="text-[12.5px] font-bold text-ink">Belum Masuk Rute</h3>
        <p className="text-[10.5px] text-ink3">{jobs?.length ?? 0} job — seret ke rute di kanan</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Semua job sudah masuk rute"
            description="Atau belum ada job terjadwal pada tanggal ini."
          />
        ) : (
          <ul className="space-y-1.5">
            {jobs.map((j) => (
              <li
                key={j.id}
                draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(j); }}
                onDragEnd={onDragEnd}
                className={`flex cursor-grab items-start gap-2 rounded-btn border border-border bg-surface px-2.5 py-2 transition-opacity active:cursor-grabbing ${
                  draggingId === j.id ? "opacity-40" : ""
                }`}
              >
                {/* Avatar gradien (D-055, 4 September 2026) — konsisten dengan
                    pola avatar-forward di seluruh Delivery Hub; job di panel
                    ini sebelumnya cuma teks polos, satu-satunya tempat di
                    Route Planner yang belum punya identitas visual. */}
                <Avatar name={customerOf(j) || "?"} size="sm" gradient className="mt-0.5 h-6 w-6 shrink-0 text-[9px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-ink">{customerOf(j) || "Tanpa nama"}</div>
                  <div className="mt-0.5 truncate text-[10.5px] text-ink2">{j.addressText || "Alamat belum diisi"}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink3">
                    <span>{j.timeWindow || "Tanpa jam"}</span>
                    <span aria-hidden>·</span>
                    <span>{unitCountOf(j)} unit</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
