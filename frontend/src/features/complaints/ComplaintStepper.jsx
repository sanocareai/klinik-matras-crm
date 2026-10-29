import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { TAHAP } from "./complaintFlow.js";

// Stepper 4 tahap Komplain. `tahap` = 1..4 (kasus terbuka); `tutup` = "SELESAI" | "DIBATALKAN" (kasus tutup). Warna hanya dari token tema (terang/gelap otomatis).
// Penanda tidak hanya warna: angka/centang + teks tahap aktif, sehingga terbaca tanpa membedakan warna.
export default function ComplaintStepper({ tahap = null, tutup = null, tertahan = false, className }) {
  return (
    <ol className={cn("flex items-start gap-1", className)} aria-label="Tahap penanganan komplain" data-testid="stepper-komplain">
      {TAHAP.map((t, i) => {
        const selesai = tutup === "SELESAI" || (tahap != null && t.no < tahap);
        const aktif = tahap === t.no;
        const batal = tutup === "DIBATALKAN";
        return (
          <li key={t.no} className="flex min-w-0 flex-1 flex-col items-center gap-1" aria-current={aktif ? "step" : undefined} data-testid={`tahap-${t.no}`} data-state={aktif ? "aktif" : selesai ? "selesai" : "belum"}>
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : selesai || aktif ? "bg-green" : "bg-line")} />
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                  selesai && "bg-green text-white",
                  aktif && !tertahan && "bg-accent text-white ring-4 ring-accent/20",
                  aktif && tertahan && "bg-orange text-white ring-4 ring-orange/20",
                  !selesai && !aktif && "bg-inset text-ink3",
                  batal && "bg-inset text-ink3",
                )}
              >
                {selesai ? <Check size={14} aria-hidden="true" /> : t.no}
              </span>
              <span className={cn("h-0.5 flex-1", i === TAHAP.length - 1 ? "bg-transparent" : selesai ? "bg-green" : "bg-line")} />
            </div>
            <span className={cn("max-w-full px-0.5 text-center text-[11px] leading-tight", aktif ? "font-semibold text-ink" : "text-ink3")}>
              <span className="sm:hidden">{t.pendek}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Versi mini untuk kartu daftar: empat batang + keterangan "Tahap 2 dari 4 · Tentukan Solusi".
export function StepperMini({ tahap, tertahan = false }) {
  return (
    <div className="flex items-center gap-2" data-testid="stepper-mini">
      <span className="flex gap-0.5" aria-hidden="true">
        {TAHAP.map((t) => (
          <span key={t.no} className={cn("h-1.5 w-5 rounded-full", t.no < tahap ? "bg-green" : t.no === tahap ? (tertahan ? "bg-orange" : "bg-accent") : "bg-line")} />
        ))}
      </span>
      <span className="text-[11.5px] text-ink2">Tahap {tahap} dari {TAHAP.length} · <span className="font-medium text-ink">{TAHAP[tahap - 1].label}</span></span>
    </div>
  );
}
