import React, { useState } from "react";
import { Check, ChevronDown, ArrowRight, Undo2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils.js";

/**
 * Pipeline status penerimaan (gaya pipeline CRM): Draf → Terjadwal → Barang tiba → Pemeriksaan → Siap masuk stok → Sudah masuk stok.
 * Tahap, posisi, dan SEMUA perpindahan yang boleh dipilih datang dari server (`tampilan.pipeline`); layar tidak menghitung sendiri. Memilih perpindahan TIDAK mengubah status langsung:
 * pilihan diteruskan ke jalur aksi yang sama dengan tombolnya (isian, alasan, dan syarat server tetap berlaku), jadi pemeriksaan tidak bisa dilewati dan stok tidak berubah hanya karena label.
 * @param onPilih  (kodeAksi) => void
 * @param bolehUbah false (akun hanya-lihat) → pilihan perpindahan tidak ditampilkan
 */
export default function PipelineStatus({ tampilan, onPilih, bolehUbah = true, sibuk = false, className }) {
  const [buka, setBuka] = useState(false);
  const p = tampilan?.pipeline; if (!p) return null;
  const pindah = bolehUbah ? p.pindah ?? [] : [];
  const berhenti = p.indeks === null;
  const IKON = { maju: ArrowRight, mundur: Undo2, tutup: XCircle };
  return (
    <div className={className} data-testid="pipeline-status" data-indeks={p.indeks ?? "berhenti"}>
      <ol className="m-0 flex list-none items-center gap-1 overflow-x-auto p-0 pb-1" aria-label="Tahap penerimaan">
        {p.tahap.map((t, i) => {
          const selesai = !berhenti && i < p.indeks; const kini = !berhenti && i === p.indeks;
          return (
            <li key={t.kode} className="flex shrink-0 items-center gap-1" aria-current={kini ? "step" : undefined} data-testid={`pipeline-${t.kode}`} data-status={selesai ? "selesai" : kini ? "kini" : "belum"}>
              <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-chip px-2.5 py-1 text-[12px] font-semibold", selesai ? "bg-greenbg text-green" : kini ? "bg-accent text-white" : "bg-inset text-ink3")}>
                {selesai ? <Check size={12} aria-hidden /> : <span className="tabular-nums" aria-hidden>{i + 1}</span>}{t.label}
              </span>
              {i < p.tahap.length - 1 && <span className="text-ink3" aria-hidden>›</span>}
            </li>
          );
        })}
      </ol>
      {berhenti && <p className="m-0 mt-1 text-[12px] text-ink2" data-testid="pipeline-berhenti">Alur dihentikan: <strong>{tampilan.label}</strong>. Dokumen tidak dihapus.</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {pindah.length > 0 ? (
          <>
            <button type="button" onClick={() => setBuka((b) => !b)} aria-expanded={buka} disabled={sibuk} data-testid="pipeline-ubah"
              className="inline-flex items-center gap-1 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-hovertint disabled:opacity-50 max-sm:min-h-11">
              Ubah status <ChevronDown size={13} className={cn("transition-transform", buka && "rotate-180")} aria-hidden />
            </button>
            <span className="text-[11.5px] text-ink3">Hanya perpindahan yang sah untuk tahap ini.</span>
          </>
        ) : (
          <span className="text-[11.5px] text-ink3" data-testid="pipeline-tanpa-pindah">{bolehUbah ? "Tidak ada perpindahan status untuk tahap ini." : "Akun Anda hanya dapat melihat dokumen ini."}</span>
        )}
      </div>
      {buka && pindah.length > 0 && (
        <ul className="m-0 mt-1.5 list-none space-y-1 rounded-btn border border-border bg-inset p-1.5" role="menu" aria-label="Perpindahan status yang sah" data-testid="pipeline-menu">
          {pindah.map((x) => {
            const Ikon = IKON[x.jenis] ?? ArrowRight;
            return (
              <li key={x.kode} role="none">
                <button type="button" role="menuitem" onClick={() => { setBuka(false); onPilih(x.kode); }} data-testid={`pindah-${x.kode}`}
                  className={cn("flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-[12.5px] font-medium hover:bg-hovertint max-sm:min-h-11", x.jenis === "tutup" ? "text-red" : "text-ink")}>
                  <Ikon size={14} aria-hidden /> {x.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
