import React from "react";

// Rangkaian dokumentasi akhir (Fase 5): sebelum bongkar → isi kasur lama → racikan → hasil rakitan → uji QC → kain/Corner → hasil jadi. Dihitung server dari matriks + Catatan Komponen
// (tanpa menyalin berkas). Sumber (Meja/QC/Corner/Driver/Dokumenter) dikenali per tahap; yang tidak berlaku diberi alasan, bukan foto buatan.
const TONE = { LENGKAP: "bg-greenbg text-green", KURANG: "bg-redbg text-red", MENUNGGU: "bg-inset text-ink3", NA: "bg-inset text-ink3" };
const LABEL = { LENGKAP: "Lengkap", KURANG: "Kurang", MENUNGGU: "Menunggu", NA: "Tidak berlaku" };
export function DocSequence({ sequence }) {
  if (!sequence?.length) return null;
  return (
    <ol className="m-0 list-none space-y-1.5 p-0" data-testid="doc-sequence" aria-label="Rangkaian dokumentasi akhir">
      {sequence.map((st, i) => (
        <li key={st.key} data-testid="doc-sequence-step" data-key={st.key} data-status={st.status} className="flex items-start gap-3 rounded-btn bg-inset px-3 py-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-[12px] font-bold text-ink2">{i + 1}</span>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="m-0 flex flex-wrap items-center gap-2 font-semibold text-ink">{st.label}<span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${TONE[st.status]}`}>{LABEL[st.status]}</span></p>
            <p className="m-0 text-ink3">
              {st.status === "NA" ? (st.naReason || "Tidak berlaku") : `${st.count} foto/video${Object.keys(st.sources).length ? ` · ${Object.entries(st.sources).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}${st.notesRecorded.length ? ` · catatan komponen: ${st.notesRecorded.length}` : ""}${st.missing ? ` · kurang ${st.missing}` : ""}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
export default DocSequence;
