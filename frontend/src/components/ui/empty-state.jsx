import React from "react";
import { cn } from "@/lib/utils.js";

// Empty state — JUJUR & mengajarkan langkah berikutnya, bukan kartu kosong.
// Prinsip UX Sano: setiap state kosong menuntun aksi (lihat sano-ux-guidelines.md
// §1.4). `icon` = komponen ikon lucide (opsional), `action` = node tombol.
export function EmptyState({ icon: Icon, title, description, action, className, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon size={20} />
        </div>
      )}
      {title && <h3 className="text-sm font-semibold text-slate-700">{title}</h3>}
      {description && (
        <p className="max-w-xs text-[13px] leading-relaxed text-slate-400">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
