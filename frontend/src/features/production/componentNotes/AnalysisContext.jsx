import React from "react";
import { SalesContextBox } from "./SalesContextBox.jsx";
import { MaterialAttrs } from "./MaterialPicker.jsx";
import { NOT_RECORDED, conditionLabel, materialText, systemLabel } from "./componentNotesModel.js";

// Konteks Analisis (Fase 3 LAYANAN) — SATU blok baca-saja untuk PIC Meja dan PIC QC sebelum menentukan racikan: keluhan/request Sales, berat customer, komponen lama (atas -> bawah),
// QC awal, uji fondasi. Semua dari SATU endpoint Catatan Komponen (tanpa input ulang, tanpa salinan); yang belum dicatat tampil "Belum dicatat", tidak dikarang.
export function AnalysisContext({ data }) {
  if (!data) return null;
  const s = data.sections || {}; const lb = s.LAYERS_BEFORE; const fb = s.FOUNDATION_BEFORE; const m = data.measurements || {};
  const layers = lb?.data?.layers || [];
  return (
    <details open className="rounded-btn border border-line bg-surface" data-testid="analysis-context">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13.5px] font-bold text-ink">Konteks analisis (baca saja)</summary>
      <div className="space-y-2.5 px-3 pb-3">
        <SalesContextBox ctx={data.salesContext} />
        <div className="rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2" data-testid="analysis-old-components">
          <p className="m-0 mb-1 text-[12px] font-bold uppercase tracking-wide text-ink3">Komponen lama (atas ke bawah)</p>
          {!lb ? <p className="m-0 text-ink3" data-testid="analysis-layers-missing">Lapisan awal: {NOT_RECORDED}</p>
            : lb.data?.layersUnknown ? <p className="m-0">Lapisan awal: tidak diketahui</p>
              : (
                <ol className="m-0 list-none space-y-1 p-0" data-testid="analysis-layers">
                  {layers.map((l, i) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]"><b>{i + 1}.</b> {materialText(l.material)}{l.thicknessCm ? ` · ${l.thicknessCm} cm` : " · tebal belum dicatat"}{l.condition ? ` · ${conditionLabel(l.condition)}` : ""}
                      <MaterialAttrs value={l.material} compact /></li>
                  ))}
                </ol>
              )}
          {lb?.summary && <p className="m-0 mt-1 font-semibold text-ink" data-testid="analysis-layers-total">{lb.summary.label}</p>}
          <p className="m-0 mt-1.5" data-testid="analysis-foundation">{fb ? `Fondasi: ${[systemLabel(fb.data.system), materialText(fb.data.material)].filter(Boolean).join(" · ")} · ${conditionLabel(fb.data.condition) || "kondisi belum dicatat"}` : `Fondasi: ${NOT_RECORDED}`}</p>
        </div>
        <div className="rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2" data-testid="analysis-qc">
          <p className="m-0 mb-1 text-[12px] font-bold uppercase tracking-wide text-ink3">Pengujian awal (PIC QC)</p>
          <p className="m-0" data-testid="analysis-whole">{m.whole ? `QC awal: ${m.whole.complaintMatchLabel} · penurunan kasur utuh ${m.whole.wholeDropCm} cm · beban ${m.whole.testerWeightKg} kg` : `QC awal: ${NOT_RECORDED}`}</p>
          <p className="m-0" data-testid="analysis-foundation-test">{m.foundation ? `Uji fondasi: ${m.foundation.unloadedHeightCm} → ${m.foundation.loadedHeightCm} cm · penurunan fondasi ${m.foundation.dropCm} cm (dihitung sistem)` : `Uji fondasi: ${NOT_RECORDED}`}</p>
        </div>
      </div>
    </details>
  );
}
