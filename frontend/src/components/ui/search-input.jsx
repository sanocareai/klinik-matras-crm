import React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Search input lokal (list/tabel) — ikon magnifier di depan, tombol clear saat
// ada isi. Debounce diserahkan ke pemanggil (controlled value/onChange).
// Untuk pencarian global ⌘K lihat command palette terpisah (Wave 1).
export const SearchInput = React.forwardRef(function SearchInput(
  { className, value, onChange, onClear, placeholder = "Cari…", ...props },
  ref
) {
  const hasValue = value != null && value !== "";
  return (
    <div className={cn("relative", className)}>
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-sm text-slate-900",
          "placeholder:text-slate-400 outline-none transition-colors",
          "focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-600/40"
        )}
        {...props}
      />
      {hasValue && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Bersihkan pencarian"
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
});
