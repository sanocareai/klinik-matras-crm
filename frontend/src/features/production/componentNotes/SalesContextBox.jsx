import React from "react";

// Konteks Sales (BACA-SAJA): keluhan, request, dan berat customer. Berat customer hanya rujukan — TIDAK mengisi berat penguji aktual.
// Dipakai formulir PIC QC, formulir Racikan rencana, dan blok Konteks Analisis (satu sumber: salesContext dari endpoint Catatan Komponen).
export function SalesContextBox({ ctx }) {
  if (!ctx) return null;
  return (
    <div className="space-y-1 rounded-btn border border-line bg-inset px-3 py-2.5 text-[13px] text-ink2" data-testid="sales-context">
      <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-ink3">Dari Sales{ctx.orderNumber ? ` · ${ctx.orderNumber}` : ""}</p>
      <p className="m-0" data-testid="sales-complaints"><b>Keluhan:</b> {ctx.complaintLabels?.length ? ctx.complaintLabels.join(", ") : "Belum dicatat Sales"}</p>
      <p className="m-0 break-words [overflow-wrap:anywhere]" data-testid="sales-request"><b>Request:</b> {ctx.request || "Belum dicatat Sales"}</p>
      <p className="m-0" data-testid="sales-weight"><b>Berat customer:</b> {ctx.customerWeightKg != null ? `${ctx.customerWeightKg} kg` : "Belum dicatat Sales"} <span className="text-ink3">(rujukan saja — berat penguji diisi sesuai penimbangan nyata)</span></p>
    </div>
  );
}
