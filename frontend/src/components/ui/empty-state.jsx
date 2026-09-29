import React from "react";
import { cn } from "@/lib/utils.js";

// Empty state — JUJUR & mengajarkan langkah berikutnya, bukan kartu kosong.
// Prinsip UX Sano: setiap state kosong menuntun aksi (lihat sano-ux-guidelines.md
// §1.4). `icon` = komponen ikon lucide (opsional), `action` = node tombol.
//
// `compact` (P8.1, UI & Navigation Consolidation, opsional, default `false`)
// — halaman DAFTAR padat (papan meja kosong, antrean kosong) tidak butuh
// jarak vertikal sebesar halaman kosong berdiri sendiri (`py-12` lama).
// OPT-IN supaya seluruh pemanggil lain di app ini (50+ halaman) tetap identik.
export function EmptyState({ icon: Icon, title, description, action, className, compact = false, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1 px-4 py-6" : "gap-2 px-6 py-12",
        className
      )}
      {...props}
    >
      {Icon && (
        <div className={cn("flex items-center justify-center rounded-full bg-inset text-ink3", compact ? "mb-0.5 h-8 w-8" : "mb-1 h-11 w-11")}>
          <Icon size={compact ? 16 : 20} />
        </div>
      )}
      {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
      {description && (
        <p className="max-w-xs text-[13px] leading-relaxed text-ink3">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
