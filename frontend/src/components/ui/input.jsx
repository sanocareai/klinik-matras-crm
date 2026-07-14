import React from "react";
import { cn } from "@/lib/utils.js";

// Input teks standar sistem. Tinggi h-9 (selaras Button default), radius-lg,
// border slate-200, focus ring brand. State error via prop `error` (bool) →
// border merah. Lihat sano-components.md §B.4.
export const Input = React.forwardRef(function Input(
  { className, error, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400",
        "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-600/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error
          ? "border-chart-rose focus-visible:ring-chart-rose/30"
          : "border-slate-200 focus-visible:border-brand-500",
        className
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  );
});
