import React, { useState } from "react";
import { AlertTriangle, Clock, ImageOff, PackageX, Scissors } from "lucide-react";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { formatMinutes } from "@/features/production/experience.js";
import { initialsOf } from "./workerAppModel.js";

// Foto-pertama: foto unit mengisi bagian atas kartu; foto kosong/gagal dimuat = placeholder navy dengan inisial customer (jujur, bukan gambar palsu).
export function JobPhoto({ job, className = "" }) {
  const [broken, setBroken] = useState(false);
  const show = job.photoUrl && !broken;
  return (
    <div className={`wa-photo ${show ? "" : "wa-photo-empty"} ${className}`} data-testid="job-photo" data-has-photo={show ? "1" : "0"}>
      {show ? (
        <img src={job.photoUrl} alt={`Foto unit ${job.unitCode}`} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <>
          <span className="text-[34px] font-extrabold leading-none" aria-hidden>{initialsOf(job.customerName)}</span>
          <span className="flex items-center gap-1 text-[12px] font-semibold opacity-80"><ImageOff size={13} aria-hidden /> Foto belum ada</span>
        </>
      )}
      <span className="wa-photo-scrim" aria-hidden />
    </div>
  );
}

export function PriorityChip({ priority }) {
  if (!priority || priority.value <= 0) return null;
  const cls = priority.value >= 2 ? "wa-chip-red" : "wa-chip-orange";
  return <span data-testid="priority-chip" className={`wa-chip ${cls}`}><AlertTriangle size={12} aria-hidden /> {priority.label}</span>;
}

export function SourceChip({ source }) {
  return <span data-testid="source-badge" data-source={source} className="wa-chip wa-chip-solid" title={source === "V2" ? "Alur Production V2" : "Alur Production V1 (order asli)"}>{source}</span>;
}

// Peringatan Ganti Kain: layanan krusial (kain harus persis permintaan customer) — dikenali dari layanan DIPESAN di Sales, bukan tebakan teks bebas.
export function GantiKainNote({ job, compact = false }) {
  if (!job.gantiKain) return null;
  return (
    <div data-testid="ganti-kain-note" role="note" className="rounded-btn border border-orange bg-orangebg px-3 py-2 text-orange">
      <p className={`m-0 flex items-start gap-1.5 font-bold ${compact ? "text-[13px]" : "text-[14px]"}`}><Scissors size={15} className="mt-px shrink-0" aria-hidden /> Ganti Kain — pastikan sesuai permintaan customer</p>
      {job.gantiKainNoteMissing && <p className="m-0 mt-1 text-[12.5px] font-semibold">Catatan kain belum tersedia — konfirmasi ke Sales</p>}
    </div>
  );
}

export function SalesServicesLine({ job }) {
  return (
    <p data-testid="layanan-sales" className="wa-wrap m-0 line-clamp-2 text-[13.5px] font-semibold text-ink">
      <span className="font-medium text-ink2">Layanan Sales: </span>{job.salesServices.length ? job.salesServices.join(" + ") : "belum dicatat Sales"}
    </p>
  );
}

export function SalesNote({ job, clamp = true }) {
  return (
    <p data-testid="sales-note" className={`wa-wrap m-0 text-[13px] text-ink2 ${clamp ? "line-clamp-2" : ""}`}>
      {job.note ? <>“{job.note}”</> : <span className="text-ink2">Tidak ada catatan Sales</span>}
      {job.salesName && <span data-testid="sales-name" className="font-semibold text-ink2"> — {job.salesName} (Sales)</span>}
    </p>
  );
}

export function ProgressLine({ job }) {
  if (!job.progress) return <p className="m-0 text-[12.5px] text-ink2" data-testid="progress-missing">Progres belum tersedia dari server</p>;
  const { done, total } = job.progress;
  return (
    <div data-testid="job-progress" data-source={job.progress.source}>
      <div className="mb-1 flex justify-between text-[12.5px] text-ink2"><span>{done} dari {total} tahap</span>{job.raw?.timer?.elapsedMinutes ? <span className="flex items-center gap-1"><Clock size={13} aria-hidden /> {formatMinutes(job.raw.timer.elapsedMinutes)}{job.late ? " · terlambat" : ""}</span> : null}</div>
      <ProgressBar value={total ? (done / total) * 100 : 0} variant={job.late ? "danger" : "accent"} />
    </div>
  );
}

const TONE = { accent: "bg-accentbg text-accent", red: "bg-redbg text-red", orange: "bg-orangebg text-orange", green: "bg-greenbg text-green", neutral: "bg-inset text-ink2" };
export const StageChip = ({ job }) => <span data-testid="stage-chip" className={`inline-flex max-w-full items-center truncate rounded-full px-2.5 py-1 text-[12px] font-bold ${TONE[job.stage.tone] || TONE.neutral}`}>{job.stage.label}</span>;

// Kartu antrean/aktif — satu kartu = satu pekerjaan. Seluruh kartu dapat disentuh (target >= 44px) dan membuka detail pekerjaan.
export default function JobCard({ job, onOpen, position = null, variant = "queue" }) {
  return (
    <button type="button" data-testid="worker-unit-card" data-unit-code={job.unitCode} data-source={job.source} data-variant={variant} onClick={() => onOpen(job)}
      className={`wa-card wa-card-press flex w-full flex-col text-left ${variant === "active" ? "wa-card-wide" : ""}`}>
      <div className="relative">
        <JobPhoto job={job} />
        <div className="absolute left-3 top-3 flex max-w-[70%] flex-wrap gap-1.5"><PriorityChip priority={job.priority} />{position != null && <span className="wa-chip wa-chip-solid">#{position}</span>}</div>
        <div className="absolute right-3 top-3"><SourceChip source={job.source} /></div>
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1.5">{job.stationLabel && <span className="wa-chip wa-chip-solid">{job.stationLabel}</span>}</div>
      </div>
      <div className="space-y-2.5 p-4">
        <div className="min-w-0">
          <p data-testid="job-customer" className="wa-wrap m-0 line-clamp-2 text-[18px] font-extrabold leading-snug text-ink">{job.customerName}</p>
          <p data-testid="job-ids" className="wa-wrap m-0 truncate text-[13px] text-ink2">{[job.orderNumber, job.unitCode].filter(Boolean).join(" · ")}</p>
        </div>
        <SalesServicesLine job={job} />
        {job.kasur && <p data-testid="job-kasur" className="wa-wrap m-0 truncate text-[13px] text-ink2">{job.kasur}</p>}
        <SalesNote job={job} />
        <GantiKainNote job={job} compact />
        <ProgressLine job={job} />
        <div className="flex flex-wrap items-center gap-1.5">
          <StageChip job={job} />
          {job.materialWaiting && <span data-testid="material-waiting" className="inline-flex items-center gap-1 rounded-full bg-redbg px-2.5 py-1 text-[12px] font-bold text-red"><PackageX size={13} aria-hidden /> Menunggu bahan</span>}
          {!job.materialWaiting && job.material && <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-semibold ${TONE[job.material.tone] || TONE.neutral}`}>{job.material.label}</span>}
          {job.late && <span className="inline-flex items-center gap-1 rounded-full bg-orangebg px-2.5 py-1 text-[12px] font-bold text-orange"><Clock size={13} aria-hidden /> Terlambat</span>}
        </div>
      </div>
    </button>
  );
}
