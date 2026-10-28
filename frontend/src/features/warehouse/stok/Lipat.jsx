import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Bagian TERLIPAT dengan judul jelas (elemen <details> asli: bisa dibuka dengan keyboard dan sentuhan, tanpa state tambahan). Terlipat secara bawaan; isi tidak dirender oleh peramban sampai dibuka,
// tetapi tetap ada di DOM (data tidak dimuat ulang). ringkas = keterangan singkat di sebelah judul (mis. jumlah baris).
export default function Lipat({ judul, ringkas = null, testid, children, className, terbuka = false }) {
  return (
    <details open={terbuka || undefined} data-testid={testid} className={cn("group border-t border-line", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-[12.5px] font-semibold text-ink2 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-accent/40 sm:min-h-9 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 text-ink3 transition-transform group-open:rotate-90" aria-hidden />
        <span className="min-w-0 flex-1">{judul}</span>
        {ringkas && <span className="shrink-0 text-[11.5px] font-normal text-ink3">{ringkas}</span>}
      </summary>
      <div className="pb-3 pl-6">{children}</div>
    </details>
  );
}
