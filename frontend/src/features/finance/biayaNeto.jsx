import React from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Uang, formatUang } from "@/features/finance/shared.jsx";
import { PENANDA_CADANGAN, adalahPembalik } from "@/features/finance/biayaNetoLogic.js";

// Komponen penyajian biaya neto: nominal pembalik beban bersih SELALU dalam kurung (kebiasaan laporan keuangan) dan SELALU disertai label — tidak pernah angka positif tanpa keterangan.

export function LabelPembalik({ teks = PENANDA_CADANGAN.pembalikBebanBersih.label, penjelasan = PENANDA_CADANGAN.pembalikBebanBersih.penjelasan, className }) {
  return <Badge variant="green" title={penjelasan} className={className} data-testid="label-pembalik">{teks}</Badge>;
}

/** Nominal biaya neto + label pembalik bila negatif. `penanda` = penanda dari server (atau cadangan). */
export function UangBiaya({ value, penanda = PENANDA_CADANGAN, sen = false, className }) {
  const pembalik = adalahPembalik(value);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {pembalik && <LabelPembalik teks={penanda.pembalikBebanBersih.label} penjelasan={penanda.pembalikBebanBersih.penjelasan} />}
      {/* Pembalik MENAIKKAN laba → hijau (bukan merah seperti saldo negatif biasa); tetap dalam kurung lewat formatUang. */}
      {pembalik ? <span className="tabular-nums font-semibold text-green">{formatUang(value, { sen })}</span> : <Uang value={value} sen={sen} className={className} />}
    </span>
  );
}

/** Kotak penjelasan di bawah tabel/kartu bila ada pembalik beban bersih pada periode. */
export function KotakPembalik({ penanda = PENANDA_CADANGAN, ada, testid = "kotak-pembalik", teksTambahan = null }) {
  if (!ada) return null;
  return (
    <div role="note" data-testid={testid} className="flex gap-2.5 rounded-xl bg-greenbg px-3 py-2.5 text-[12.5px] leading-relaxed text-ink2">
      <Info size={15} className="mt-0.5 shrink-0 text-green" aria-hidden="true" />
      <div className="min-w-0">
        <p className="m-0 font-semibold text-ink">{penanda.pembalikBebanBersih.label}: mengurangi biaya dan menaikkan laba</p>
        <p className="m-0 mt-0.5">{penanda.pembalikBebanBersih.penjelasan}</p>
        <p className="m-0 mt-0.5 text-ink3">{penanda.rumusLaba}</p>
        {teksTambahan && <p className="m-0 mt-0.5">{teksTambahan}</p>}
      </div>
    </div>
  );
}
