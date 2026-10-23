import React, { useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils.js";
import MaterialPlanEditor from "@/features/production/MaterialPlanEditor.jsx";
import PemakaianAktualBagian from "@/features/production/bahan/PemakaianAktualBagian.jsx";
import "@/features/production/bahan/bahan.css";
import { JUDUL_RENCANA } from "@/features/production/bahan/bahanModel.js";

// TAB BAHAN — satu kolom, URUTAN: (1) Pemakaian aktual (tindakan utama, tanpa wajib Rencana) · (2) Rencana bahan (opsional, TERTUTUP secara bawaan).
// Tiga sumber pemakaian (Bahan dari Gudang · Bahan belum ada di katalog · Komponen lama dari kasur ini) = kartu SELALU tampil di PemakaianAktualBagian (komponen yang sama dipakai drawer Order Produksi).

export default function BahanTab({ unitId, data, izin, aktif, onDone, onReload }) {
  const boleh = !!izin.pemakaianAktual && aktif;
  const [rencanaBuka, setRencanaBuka] = useState(false); const [rencanaEdit, setRencanaEdit] = useState(false);
  const rencana = data.rencanaBahan?.plan ?? null;

  return (
    <div className="space-y-6" data-testid="bagian-bahan">
      {/* ── 1 · PEMAKAIAN AKTUAL (utama): komponen bersama dengan drawer Order Produksi; tiga sumber selalu terlihat */}
      <PemakaianAktualBagian unitId={unitId} data={data} izin={izin} aktif={aktif} onDone={onDone} rencanaEdit={rencanaEdit} onMulai={() => setRencanaBuka(false)} />

      {/* ── 2 · RENCANA BAHAN (opsional, tertutup bawaan; di bawah pemakaian aktual) */}
      <aside className="min-w-0" data-testid="sec-rencana">
        <div className="rounded-card border border-line">
          <button type="button" aria-expanded={rencanaBuka} aria-controls="rencana-isi" data-testid="rencana-toggle" onClick={() => { if (rencanaBuka) setRencanaEdit(false); setRencanaBuka((v) => !v); }} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <ClipboardList size={17} className="shrink-0 text-ink3" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-ink">{JUDUL_RENCANA}</span>
              <span className="block text-[12px] text-ink2">{rencana ? `${rencana.lines.length} bahan · revisi ${rencana.revision}` : "Belum ada rencana. Tidak wajib untuk mencatat pemakaian."}</span></span>
            <ChevronDown size={16} className={cn("shrink-0 text-ink3 transition-transform", rencanaBuka && "rotate-180")} aria-hidden />
          </button>
          {rencanaBuka && (
            <div id="rencana-isi" className="border-t border-line px-4 py-4">
              <MaterialPlanEditor unitId={unitId} rencana={data.rencanaBahan} bolehUbah={!!izin.rencanaBahan} unitAktif={aktif} onSaved={() => onDone()} onReload={onReload} judul="Rencana bahan" badgeTeks="belum mengurangi stok" onEditChange={setRencanaEdit} />
              {rencana && boleh && <p className="m-0 mt-3 text-[12px] text-ink3">Saat mencatat pemakaian, pilih “Gunakan sebagai isian awal” untuk memakai sisa rencana ini sebagai titik mulai.</p>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
