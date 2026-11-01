import React, { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { PeriodePicker } from "@/features/finance/shared.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";
import MutasiBank from "@/features/finance/MutasiBank.jsx";
import PencocokanBank from "@/features/finance/PencocokanBank.jsx";
import PanelRekon from "@/features/finance/PanelRekon.jsx";
import { TAB_DETAIL, hariIniWib } from "@/features/finance/rekonBankLogic.js";
import MutasiBukuKb from "@/features/finance/kasbank/MutasiBukuKb.jsx";
import { nomorSamar } from "@/features/finance/kasbank/kasBankTampilan.js";

// DETAIL REKENING — Mutasi Buku (didesain ulang) + akses ke Mutasi Rekening (bank), Pencocokan, dan Rekonsiliasi (komponen lama, belum didesain ulang di tahap ini).
// Aturan tab sama dengan sebelumnya: rekening kas tunai tidak punya rekening koran/pencocokan (rekonsiliasinya memakai hitung fisik).

export default function DetailRekening({ rek: r, periode, onPeriode, sakelarAktif, onKembali, onRincian, onBerubah }) {
  const [tab, setTab] = useState("buku");
  const [sampai, setSampai] = useState(hariIniWib());
  const rek = { id: r.id, name: r.name, kind: r.kind, jenis: r.kind };
  const adaBank = rek.kind !== "KAS";
  const tabAktif = !adaBank && (tab === "bank" || tab === "cocok") ? "rekon" : tab;
  const sekunder = rek.kind === "KAS" ? "Kas tunai · rekonsiliasi memakai hitung fisik (opname)" : `${(r.bankName || (rek.kind === "EWALLET" ? "E-wallet" : "Bank")).trim()}${r.accountNumber ? ` · ${nomorSamar(r.accountNumber)}` : ""}`;

  return (
    <div className="fin-ks-detail" data-testid="rekening-detail">
      <button type="button" className="fin-ks-kembali" onClick={onKembali}><ChevronLeft size={18} aria-hidden="true" /><span>Semua rekening</span></button>
      <div className="fin-ks-detail-kepala">
        <div className="fin-ks-detail-id">
          <LogoBank r={r} />
          <div className="fin-ks-nama-wrap">
            <h2 className="fin-ks-detail-nama" title={r.name}>{r.name}{!r.active && <span className="fin-ks-nonaktif"> · nonaktif</span>}</h2>
            <p className="fin-ks-sekunder" title={sekunder}>{sekunder}</p>
          </div>
        </div>
        <div className="fin-ks-detail-aksi">
          {tabAktif === "buku" || tabAktif === "bank" ? <PeriodePicker from={periode.from} to={periode.to} onChange={onPeriode} /> : null}
          <button type="button" className="fin-tombol fin-ks-btn-rincian" onClick={onRincian}><span>Rincian rekening</span></button>
        </div>
      </div>

      <div className="fin-ks-seg" role="tablist" aria-label="Bagian rekening">
        {TAB_DETAIL.filter((t) => adaBank || t.key === "buku" || t.key === "rekon").map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tabAktif === t.key} className="fin-ks-seg-item" onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tabAktif !== "buku" && (
        <div className="fin-ks-lama">
          {(tabAktif === "cocok" || tabAktif === "rekon") && (
            <Field label="Sampai tanggal" className="max-w-[200px]"><Input type="date" value={sampai} max={hariIniWib()} onChange={(e) => e.target.value && setSampai(e.target.value)} /></Field>
          )}
          <p className="fin-ks-catatan">{TAB_DETAIL.find((t) => t.key === tabAktif)?.penjelasan}</p>
        </div>
      )}

      {tabAktif === "buku" && <MutasiBukuKb rek={{ ...rek, bankName: r.bankName, accountNumber: r.accountNumber }} periode={periode} />}
      {tabAktif === "bank" && <div className="fin-ks-lama-isi"><MutasiBank rek={rek} periode={periode} sakelar={sakelarAktif} onBerubah={onBerubah} /></div>}
      {tabAktif === "cocok" && <div className="fin-ks-lama-isi"><PencocokanBank rek={rek} sampai={sampai} sakelar={sakelarAktif} onBerubah={onBerubah} /></div>}
      {tabAktif === "rekon" && <div className="fin-ks-lama-isi"><PanelRekon rek={rek} sampai={sampai} sakelar={sakelarAktif} onBerubah={onBerubah} /></div>}
    </div>
  );
}
