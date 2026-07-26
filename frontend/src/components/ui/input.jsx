import React from "react";
import { cn } from "@/lib/utils.js";

// Input teks standar sistem. Tinggi h-9 (selaras Button default), radius-lg,
// DS v2: TANPA border — input adalah permukaan TERISI (bg-inset), fokus
// ditandai ring accent. State error via prop `error` (bool) → ring merah.
export const Input = React.forwardRef(function Input(
  { className, error, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg  bg-surface px-3 text-sm text-ink placeholder:text-ink3",
        "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error
          ? "border-red focus-visible:ring-chart-rose/30"
          : "",
        className
      )}
      aria-invalid={error || undefined}
      {...props}
    />
  );
});
