import React from "react";
import { Skeleton } from "@/components/ui/skeleton.jsx";

// Skeleton premium yang MENIRU layout 360 (header + rail kiri + rail kanan) —
// tanpa layout shift saat data datang. Shimmer via komponen Skeleton.
export default function Customer360Skeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-200 bg-white p-4">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40 rounded-md" />
          <Skeleton className="h-3.5 w-52 rounded-md" />
          <div className="flex gap-2 pt-0.5">
            <Skeleton className="h-6 w-28 rounded-lg" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-40 rounded-xl" />
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 lg:flex-row lg:items-start">
        {/* Rail kiri */}
        <div className="flex w-full flex-col gap-3 lg:w-[300px] lg:shrink-0">
          <Skeleton className="h-[86px] rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        {/* Rail kanan */}
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-4 h-9 w-full max-w-sm rounded-lg" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <Skeleton className="h-[52px] flex-1 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
