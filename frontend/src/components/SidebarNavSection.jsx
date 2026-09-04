import React, { useState } from "react";
import { GripVertical } from "lucide-react";
import SidebarLink from "./SidebarLink.jsx";
import { cn } from "@/lib/utils.js";

// Satu section menu sidebar (D-060, 4 September 2026) — laporan owner: mau
// bisa "geser-geser" urutan menu sendiri (mis. Route Planner ke atas, Semua
// Order ke bawah). Dipisah jadi komponen sendiri (bukan inline di render
// loop Layout.jsx) supaya interaksi drag-drop-nya tidak menambah kerumitan
// ke file yang sudah 800+ baris dan sering disentuh perubahan lain.
//
// Drag & drop HTML5 native — pola YANG SAMA dengan Pipeline.jsx (Kanban
// lead) dan UnroutedJobsPanel.jsx (Route Planner), bukan library baru.
//
// Reorder HANYA di dalam SATU section yang sama (drag antar section sengaja
// tidak didukung dari sini — pengelompokan section OPERASIONAL/ARMADA/dst
// tetap tegas, cuma urutan item DI DALAMNYA yang bisa diubah pengguna).
//
// `customizing=false` (normal, hampir selalu) me-render SidebarLink apa
// adanya — tidak ada biaya/risiko tambahan untuk pemakaian sehari-hari.
export default function SidebarNavSection({
  items, customizing, onReorder, badgeCount, collapsed, onNavigate,
}) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  if (!customizing) {
    return items.map(({ to, label, Icon, badge }) => (
      <SidebarLink
        key={to}
        to={to}
        label={label}
        Icon={Icon}
        isAI={to === "/copilot"}
        showBadge={!!(badge && badgeCount > 0)}
        badgeCount={badgeCount}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    ));
  }

  function handleDrop(idx) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = items.slice();
    const [pindah] = next.splice(dragIdx, 1);
    next.splice(idx, 0, pindah);
    setDragIdx(null);
    setOverIdx(null);
    onReorder(next.map((it) => it.to));
  }

  // Mode edit SENGAJA tidak menampilkan `collapsed` (72px) — lihat guard di
  // Layout.jsx yang menyembunyikan tombol "Susun ulang" saat sidebar
  // menyempit. Tanpa label, tidak ada cara membedakan item mana yang
  // sedang digeser.
  return items.map(({ to, label, Icon }, idx) => (
    <div
      key={to}
      draggable
      onDragStart={() => setDragIdx(idx)}
      onDragOver={(e) => { e.preventDefault(); if (overIdx !== idx) setOverIdx(idx); }}
      onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
      onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
      className={cn(
        "flex cursor-grab items-center gap-2 rounded-btn border border-dashed border-border px-2.5 py-2 text-[13px] font-medium text-ink2 transition-colors active:cursor-grabbing",
        overIdx === idx && dragIdx !== idx && "border-accent bg-accentbg text-accent",
        dragIdx === idx && "opacity-40"
      )}
    >
      <GripVertical size={14} className="shrink-0 text-ink3" aria-hidden />
      {Icon && <Icon size={16} className="shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  ));
}
