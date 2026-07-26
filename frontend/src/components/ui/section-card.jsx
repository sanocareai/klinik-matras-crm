import React from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "./card.jsx";
import { cn } from "@/lib/utils.js";

// ─── SECTION CARD (DS v2.1) ──────────────────────────────────────────────────
// Kartu panel bertajuk — pola yang dipakai HAMPIR SEMUA kartu di referensi:
//   [ Judul ................... aksi/dropdown ]
//   [ isi                                     ]
//   [ ─── hairline ─────────────────────────── ]
//   [ footer / link "View All ›"               ]
//
// Keteraturan inilah yang membuat dashboard terasa "structured": setiap kartu
// punya anatomi yang sama, jadi mata tahu ke mana harus melihat di kartu mana
// pun. Sebelumnya tiap widget menyusun header-nya sendiri-sendiri.
export default function SectionCard({
  title, action, footer, children, className, bodyClassName, ...props
}) {
  return (
    <Card className={cn("flex flex-col p-0", className)} {...props}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
          {title && <h3 className="t-card-title">{title}</h3>}
          {action}
        </div>
      )}

      <div className={cn("flex-1 px-5", !title && "pt-5", !footer && "pb-5", bodyClassName)}>
        {children}
      </div>

      {footer && (
        // Hairline pemisah footer TIDAK di-inset — di sini garisnya memang
        // memisahkan dua zona kartu (isi vs aksi), jadi melebar penuh benar.
        <div className="mt-4 border-t border-line px-5 py-3.5">{footer}</div>
      )}
    </Card>
  );
}

// Pil dropdown kecil di kanan judul ("This Week ⌄") — dipakai sebagai `action`.
// Sengaja BUKAN <Button>: ini kontrol filter tenang, bukan aksi utama, jadi
// tidak boleh bersaing perhatian dengan tombol primary.
export function FilterPill({ children, className, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-chip bg-inset px-2.5 py-1.5",
        "text-[12px] font-medium text-ink2 transition-colors hover:bg-hovertint",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// Link footer "Lihat semua ›" — accent, dengan chevron di kanan.
export function ViewAllLink({ children = "Lihat semua", className, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between text-[13px] font-semibold text-accent",
        "transition-opacity hover:opacity-70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight size={16} />
    </button>
  );
}
