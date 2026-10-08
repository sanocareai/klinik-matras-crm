import React from "react";
import { MapPin, UserRound } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { docCompleteness, docStatusChip } from "@/features/production/documentation.js";
import { JobPhoto } from "@/features/production/workerApp/JobCard.jsx";
import { MissingChips } from "./DocUi.jsx";
import "./doc-app.css";

// Kartu antrean unit (foto-pertama, komponen foto Meja/Corner dipakai ulang): foto, customer, resi/unit, layanan, tahap, PIC, dan kelengkapan dokumentasi
// dari angka server. Tidak ada harga/pembayaran.
const CHIP = { green: "wa-chip wa-chip-solid !bg-green", red: "wa-chip wa-chip-red", neutral: "wa-chip wa-chip-solid", accent: "wa-chip wa-chip-solid !bg-accent" };

export default function DocUnitCard({ item, onOpen }) {
  const chip = docStatusChip(item);
  const comp = docCompleteness(item.docs);
  const p = item.progress || { done: 0, total: 0 };
  return (
    <button type="button" onClick={() => onOpen(item.runId)} data-testid="doc-unit-card" data-unit-code={item.unit.unitCode} data-run-id={item.runId} data-status={chip.key}
      className="wa-card wa-card-press block w-full min-w-0 text-left">
      <div className="relative">
        <JobPhoto job={{ photoUrl: item.unit.photoUrl, customerName: item.customerName, unitCode: item.unit.unitCode }} />
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-wrap gap-1.5">
          <span className={CHIP[chip.tone]} data-testid="doc-status-chip">{chip.label}</span>
        </div>
        <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-wrap gap-1.5">
          <span className="wa-chip wa-chip-solid"><MapPin size={12} aria-hidden /> {item.station || "Belum dijadwalkan"}</span>
        </div>
      </div>
      <div className="space-y-2.5 p-4">
        <div className="min-w-0">
          <p className="wa-wrap m-0 text-[18px] font-extrabold leading-tight text-ink">{item.customerName || "Customer"}</p>
          <p className="wa-wrap m-0 mt-0.5 text-[13px] text-ink3">Resi {item.orderNumber || "—"} · {item.unit.unitCode}</p>
        </div>
        <div className="space-y-0.5 text-[12.5px] text-ink3">
          <p className="wa-wrap m-0">Layanan Sales: <span className="font-semibold text-ink2">{item.services.sales.length ? item.services.sales.join(", ") : "—"}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="rounded-full bg-accentbg px-2.5 py-0.5 font-bold text-accent">{item.step ? `Tahap ${item.step.stepNo}: ${item.step.label}` : item.bucketLabel}</span>
          {item.pic.table && <span className="inline-flex items-center gap-1 text-ink3"><UserRound size={12} aria-hidden /> PIC {item.pic.table}{item.pic.corner ? ` · ${item.pic.corner}` : ""}</span>}
        </div>
        <div className="flex items-center gap-2"><ProgressBar value={p.total ? Math.round((p.done / p.total) * 100) : 0} /><span className="shrink-0 text-[11.5px] tabular-nums text-ink3">{p.done}/{p.total} tahap</span></div>
        <div className="space-y-1.5 rounded-btn bg-inset p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[13px] font-extrabold text-ink" data-testid="doc-summary">Dokumentasi {item.docs.satisfied}/{item.docs.required} foto · {item.docs.photos} terkirim</p>
            <span className="text-[12px] font-bold tabular-nums text-accent" data-testid="doc-pct">{comp.pct}%</span>
          </div>
          <ProgressBar value={comp.pct} />
          {item.docs.flags.belumDimulai && !item.docs.missing.length ? <p className="m-0 text-[12px] text-ink3">Belum dimulai — dokumentasi dibuka bertahap.</p> : <MissingChips missing={item.docs.missing} limit={3} />}
        </div>
      </div>
    </button>
  );
}
