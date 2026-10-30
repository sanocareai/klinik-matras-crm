import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { kualitasData } from "../../marketingLogic.js";
import { peringatanUrut, teksPengecualianTotal, NOTA_AMBANG } from "../../akuisisiLogic.js";
import { peringatanUrut as peringatanMeta } from "../../iklanCampaignLogic.js";

const IKON = { ok: [CheckCircle2, "text-green"], perhatian: [AlertTriangle, "text-orange"], info: [Info, "text-accent"] };

// Kualitas data: coverage, ledger parsial, spend hilang, UNKNOWN, UNMAPPED, rekonsiliasi lintas bagian. Semua berasal dari objek server; tidak ada ambang buatan.
export function ringkasKualitas(butir) {
  const n = butir.filter((b) => b.status === "perhatian").length;
  return n > 0 ? `${n} butir perlu perhatian` : butir.length ? "Tidak ada butir yang perlu perhatian" : "Belum dimuat";
}
export default function KualitasDataPanel({ lap, iklan, traffic, periode, iklanGalat }) {
  const butir = kualitasData({ lap, iklan, traffic, periode });
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line/60 p-0" data-testid="kualitas-data">
      {butir.map((b) => {
        const [Ikon, warna] = IKON[b.status] || IKON.info;
        return (
          <li key={b.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0" data-status={b.status} data-butir={b.id}>
            <Ikon size={16} className={cn("mt-0.5 shrink-0", warna)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]"><b className="text-ink">{b.judul}</b><span className="tabular-nums text-ink2">{b.nilai}</span></p>
              <p className="t-secondary text-[12px] leading-snug">{b.teks}</p>
              {b.aksi && <Link to={b.aksi.ke} className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">{b.aksi.teks} <ArrowRight size={12} /></Link>}
            </div>
          </li>
        );
      })}
      {(peringatanUrut(lap).length > 0 || peringatanMeta(iklan).length > 0) && (
        <li className="py-2.5">
          <details data-testid="catatan-server"><summary className="cursor-pointer text-[12.5px] font-medium text-ink2">Catatan dari server ({peringatanUrut(lap).length + peringatanMeta(iklan).length})</summary>
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0 text-[12px] text-ink2">
              {peringatanUrut(lap).map((w, i) => <li key={`s${w.kode}${i}`} className="break-words"><b>{w.kode.replace(/_/g, " ").toLowerCase()}</b> — {w.pesan}</li>)}
              {peringatanMeta(iklan).map((w, i) => <li key={`m${w.kode}${i}`} className="break-words"><b>Meta · {w.kode.replace(/_/g, " ").toLowerCase()}</b> — {w.pesan}</li>)}
            </ul>
          </details>
        </li>
      )}
      {lap && <li className="t-secondary py-2.5 text-[12px]">{teksPengecualianTotal(lap)} {NOTA_AMBANG}</li>}
      {iklanGalat && <li className="py-2.5 text-[12.5px] text-orange">Laporan Meta tidak dimuat ({iklanGalat}): butir UNKNOWN, UNMAPPED, dan spend Meta belum tersedia.</li>}
      {butir.length === 0 && !iklanGalat && <li className="py-2 text-[12.5px] text-ink3">Belum ada data untuk dinilai.</li>}
    </ul>
  );
}
