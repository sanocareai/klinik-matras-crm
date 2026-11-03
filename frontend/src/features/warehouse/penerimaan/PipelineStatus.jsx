import React, { useState } from "react";
import { ChevronDown, ArrowRight, Undo2, XCircle } from "lucide-react";
import { IkCentang } from "@/components/gudangIcons.jsx";
import { cn } from "@/lib/utils.js";

/**
 * Pipeline status penerimaan: Draf → Terjadwal → Barang tiba → Pemeriksaan → Siap masuk stok → Sudah masuk stok (enam tahap dari server, tidak dikurangi).
 * Tata letak mengikuti LEBAR KONTAINER (container query `gud-alur`): lebar → stepper penuh selalu terlihat; sempit → hanya tahap saat ini ("Tahap 2 dari 6 · Terjadwal") dengan akses "Lihat alur".
 * Tahap, posisi, dan SEMUA perpindahan yang boleh dipilih datang dari server (`tampilan.pipeline`); layar tidak menghitung sendiri. Memilih perpindahan TIDAK mengubah status langsung: pilihan diteruskan ke jalur aksi yang sama
 * dengan tombolnya (isian, alasan, dan syarat server tetap berlaku). Tindakan konkret untuk tahap ini ada di bilah aksi dasar panel; "Ubah status" hanya jalur sekunder.
 * @param onPilih  (kodeAksi) => void
 * @param bolehUbah false (akun hanya-lihat) → pilihan perpindahan tidak ditampilkan
 */
export default function PipelineStatus({ tampilan, onPilih, bolehUbah = true, sibuk = false, className }) {
  const [buka, setBuka] = useState(false); const [lihat, setLihat] = useState(false);
  const p = tampilan?.pipeline; if (!p) return null;
  const pindah = bolehUbah ? p.pindah ?? [] : [];
  const berhenti = p.indeks === null;
  const IKON = { maju: ArrowRight, mundur: Undo2, tutup: XCircle };
  const kini = berhenti ? null : p.tahap[p.indeks];
  return (
    <div className={cn("gud-alur-wadah", className)} data-testid="pipeline-status" data-indeks={p.indeks ?? "berhenti"}>
      <div className="gud-alur-ringkas">
        <span className="gud-alur-kini" data-testid="tahap-sekarang">{berhenti ? <>Alur dihentikan: <strong>{tampilan.label}</strong></> : <>Tahap {p.indeks + 1} dari {p.tahap.length} · <strong>{kini.label}</strong></>}</span>
        <button type="button" className="gud-tautan" onClick={() => setLihat((v) => !v)} aria-expanded={lihat} data-testid="lihat-alur">{lihat ? "Sembunyikan alur" : "Lihat alur"}</button>
      </div>
      <div className="gud-alur-penuh" data-buka={lihat ? "ya" : "tidak"} data-testid="alur-penuh">
        <ol className="gud-stepper" aria-label="Tahap penerimaan">
          {p.tahap.map((t, i) => {
            const selesai = !berhenti && i < p.indeks; const sekarang = !berhenti && i === p.indeks;
            return (
              <li key={t.kode} aria-current={sekarang ? "step" : undefined} data-testid={`pipeline-${t.kode}`} data-status={selesai ? "selesai" : sekarang ? "kini" : "belum"}>
                <span className="gud-langkah" aria-hidden>{selesai ? <IkCentang size={14} /> : sekarang ? <span className="gud-langkah-titik" /> : null}</span>
                <span className="gud-langkah-label">{t.label}</span>
              </li>
            );
          })}
        </ol>
        {berhenti && <p className="m-0 mt-1 text-[12px] text-ink2" data-testid="pipeline-berhenti">Alur dihentikan: <strong>{tampilan.label}</strong>. Dokumen tidak dihapus.</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {pindah.length > 0 ? (
            <>
              <button type="button" onClick={() => setBuka((b) => !b)} aria-expanded={buka} disabled={sibuk} data-testid="pipeline-ubah" title="Hanya perpindahan yang sah untuk tahap ini; tindakan utamanya ada di bawah."
                className="inline-flex items-center gap-1 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-semibold text-ink hover:bg-hovertint disabled:opacity-50 max-sm:min-h-11">
                Ubah status <ChevronDown size={13} className={cn("transition-transform", buka && "rotate-180")} aria-hidden />
              </button>
              <span className="gud-alur-hint text-[11.5px] text-ink3">Hanya perpindahan yang sah untuk tahap ini; tindakan utamanya ada di bawah.</span>
            </>
          ) : (
            <span className="text-[11.5px] text-ink3" data-testid="pipeline-tanpa-pindah">{bolehUbah ? "Tidak ada perpindahan status untuk tahap ini." : "Akun Anda hanya dapat melihat dokumen ini."}</span>
          )}
        </div>
        {bolehUbah && (p.tertahan ?? []).map((x) => <p key={x.ke} className="m-0 mt-1 text-[11.5px] text-ink3" data-testid="pipeline-tertahan">{x.sebab}</p>)}
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
    </div>
  );
}
