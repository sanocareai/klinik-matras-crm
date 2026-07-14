import React from "react";
import { cn } from "@/lib/utils.js";

// Field — bungkus label + kontrol input + helper/error. Menstandarkan jarak
// label→input (gap 1.5) dan tampilan pesan error. Anak (`children`) biasanya
// <Input>, <select>, dsb. Lihat sano-components.md §B.4.
export function Field({ label, htmlFor, error, hint, required, className, children }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-500">
          {label}
          {required && <span className="ml-0.5 text-chart-rose">*</span>}
        </label>
      )}
      {children}
      {/* Error menang atas hint — hanya salah satu yang tampil. */}
      {error ? (
        <p className="text-[11px] text-chart-rose">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
