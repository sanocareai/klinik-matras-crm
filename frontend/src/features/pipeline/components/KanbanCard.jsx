import React from "react";
import { MoreVertical, AlertTriangle } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";

// Titik warna per stage — mengikuti STAGE_VARIANT di utils/format.js
// (sano-color-system.md §4). Sengaja class statis, bukan dibangun runtime,
// supaya ke-scan Tailwind.
export const STAGE_DOT = {
  NEW:       "bg-orange",
  QUALIFIED: "bg-accent",
  QUOTED:    "bg-accent",
  BOOKED:    "bg-accent",
  SCHEDULED: "bg-accent",
  COMPLETED: "bg-accent",
  PAID:      "bg-green",
  REVIEWED:  "bg-green",
};

// Ambang "stale" — deal yang tidak disentuh selama ini dianggap mandek.
// 14 hari dipilih supaya tidak berisik: siklus jual kasur di sini berhari-hari
// (lihat laporan Kecepatan Pipeline), jadi 7 hari akan menandai deal normal.
// PAID/REVIEWED DIKECUALIKAN: itu stage AKHIR — "lama tidak disentuh" di sana
// artinya sudah selesai, bukan mandek.
const STALE_DAYS = 14;
export function isStale(card, stage) {
  if (stage === "PAID" || stage === "REVIEWED") return false;
  return (card?.daysSince || 0) >= STALE_DAYS;
}

// Kartu deal di kolom Pipeline. Spec: sano-components.md §B.3 "Kanban Card"
// — nama · nilai (tabular-nums) · titik stage · avatar sales · meta, kompak.
//
// Drag & drop TETAP HTML5 native (bukan library) — persis seperti sebelumnya.
// Yang berubah hanya tampilan + state `dragging`.
export default function KanbanCard({
  card, stage, stages, dragging, menuOpen,
  onDragStart, onDragEnd, onToggleMenu, onMoveToStage,
}) {
  const stale = isStale(card, stage);
  const nama  = card.name || card.phone || "—";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      // onDragEnd WAJIB: kalau card dilepas DI LUAR kolom mana pun, onDrop
      // tidak pernah jalan — tanpa ini state "lift" tidak pernah dibersihkan
      // dan kartu tampak terangkat/transparan selamanya sampai reload.
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-xl  bg-surface p-2.5 shadow-card",
        // Lift saat digeser: shadow-popover + scale ~1.02 dalam 150ms, dan slot asal
        // diredam (opacity) — sano-animation-guidelines.md §3.6.
        "transition-[box-shadow,transform,opacity] duration-150 ease-out",
        "hover:shadow-popover active:cursor-grabbing",
        dragging
          ? "scale-[1.02] opacity-40 shadow-popover"
          : "cursor-grab",
        stale && !dragging && ""
      )}
    >
      <div className="flex items-start gap-2">
        <Avatar name={nama} src={card.profilePictureUrl} size="sm" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink">{nama}</p>
          {card.phone && (
            <p className="mt-0.5 truncate text-[11px] tabular-nums text-ink3">{card.phone}</p>
          )}
        </div>

        {/* Tombol pindah stage — WAJIB ADA: drag & drop tidak bekerja di touch,
            jadi ini satu-satunya cara memindah deal dari HP. */}
        <div className="relative shrink-0">
          <button
            className="rounded-md p-1 text-ink3 transition-colors duration-150 hover:bg-hovertint hover:text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            title="Pindah stage"
            aria-label={`Pindah ${nama} ke stage lain`}
            aria-expanded={menuOpen}
            onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
          >
            <MoreVertical size={14} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={onToggleMenu} />
              <div className="absolute right-0 top-7 z-30 w-44 overflow-hidden rounded-xl bg-surface py-1 shadow-popover">
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink3">
                  Pindah ke
                </p>
                {stages.filter((s) => s !== stage).map((s) => (
                  <button
                    key={s}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink2 transition-colors duration-150 hover:bg-hovertint"
                    onClick={() => onMoveToStage(s)}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", STAGE_DOT[s] || "bg-ink3")} />
                    {STAGE_LABELS[s] || s}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold tabular-nums text-ink">
          {formatRupiah(card.totalValue)}
        </span>
        <span className={cn("text-[11px] tabular-nums", stale ? "font-semibold text-orange" : "text-ink3")}>
          {card.daysSince}h lalu
        </span>
      </div>

      {/* Peringatan stale — informasinya JUGA tersampaikan lewat teks, bukan
          hanya warna (aturan aksesibilitas sano-animation-guidelines.md §1.5). */}
      {stale && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-orange">
          <AlertTriangle size={11} className="shrink-0" />
          Mandek {card.daysSince} hari — perlu ditindak
        </p>
      )}

      {card.assignedSales && (
        <p className="mt-1.5 truncate border-t border-line pt-1.5 text-[11px] text-ink3">
          {card.assignedSales.name}
        </p>
      )}
    </div>
  );
}
