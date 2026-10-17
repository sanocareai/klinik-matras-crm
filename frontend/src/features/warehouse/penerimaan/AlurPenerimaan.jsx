import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils.js";

/**
 * Alur penerimaan dalam lima langkah: PO disetujui → Jadwal kedatangan → Barang tiba → Pemeriksaan → Masuk stok.
 * Tahap & indeks datang dari server (`tampilan.tahap`, `tampilan.tahapIndeks`) — layar hanya menampilkan. Dokumen yang berakhir (dibatalkan/ditolak) tidak menyorot langkah mana pun.
 * @param dariPO false → langkah pertama disebut "Penerimaan dibuat" (tanpa PO tidak ada PO yang disetujui).
 */
export default function AlurPenerimaan({ tampilan, dariPO = true, className }) {
  const tahap = tampilan?.tahap ?? [];
  const aktif = tampilan?.tahapIndeks;
  if (!tahap.length) return null;
  if (aktif === null || aktif === undefined) {
    return <p className={cn("m-0 rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2", className)} data-testid="alur-berhenti">Alur dihentikan: <strong>{tampilan.label}</strong>. Dokumen tetap tersimpan sebagai riwayat.</p>;
  }
  return (
    <nav aria-label="Alur penerimaan barang" className={className} data-testid="alur-penerimaan" data-tahap-aktif={aktif}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1.5 p-0">
        {tahap.map((t, i) => {
          const selesai = i < aktif; const kini = i === aktif;
          const label = i === 0 && !dariPO ? "Penerimaan dibuat" : t.label;
          return (
            <li key={t.kode} className="flex items-center gap-1" aria-current={kini ? "step" : undefined} data-testid={`tahap-${t.kode}`} data-status={selesai ? "selesai" : kini ? "kini" : "belum"}>
              <span className={cn("inline-flex items-center gap-1 rounded-chip px-2 py-1 text-[11.5px] font-semibold max-sm:text-[11px]", selesai ? "bg-greenbg text-green" : kini ? "bg-accentbg text-accent ring-1 ring-accent/40" : "bg-inset text-ink3")}>
                {selesai ? <Check size={11} aria-hidden /> : <span className="tabular-nums" aria-hidden>{i + 1}</span>}
                {label}
              </span>
              {i < tahap.length - 1 && <span className="text-ink3 max-sm:hidden" aria-hidden>→</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
