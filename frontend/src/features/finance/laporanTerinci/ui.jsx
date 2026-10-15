import React from "react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import { JudulKartu } from "@/features/finance/shared.jsx";

// Blok kecil bersama panel Laporan Keuangan terinci (tanpa logika angka).

export function KotakAngka({ label, nilai, sub, tone }) {
  return (
    <div className="min-w-0 rounded-xl bg-inset px-3 py-2.5">
      <p className="m-0 text-[11px] text-ink3">{label}</p>
      <p className={cn("m-0 mt-0.5 text-[16px] font-bold tabular-nums", tone === "red" && "text-red", tone === "orange" && "text-orange", tone === "green" && "text-green")}>{nilai}</p>
      {sub && <p className="m-0 mt-0.5 text-[11px] text-ink3">{sub}</p>}
    </div>
  );
}

export function KartuPanel({ judul, deskripsi, info, children, className, testid }) {
  return (
    <Card className={className} data-testid={testid}>
      <JudulKartu title={judul} description={deskripsi} info={info} />
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export function KotakCatatan({ children, tone = "info", testid }) {
  return (
    <div role={tone === "orange" ? "status" : undefined} data-testid={testid}
      className={cn("rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed", tone === "orange" ? "bg-orangebg text-orange" : tone === "red" ? "bg-redbg text-red" : tone === "green" ? "bg-greenbg text-green" : "bg-inset text-ink2")}>
      {children}
    </div>
  );
}
