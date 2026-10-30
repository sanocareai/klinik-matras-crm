import React from "react";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { makeCustomRange } from "@/lib/dateRange.js";
import { saranRentang, teksPeriode } from "../periodeLaporan.js";

// Banner SATU periode untuk tab Marketing. Rentangnya milik filter global Laporan (kanan atas) — komponen ini hanya MENAMPILKAN (satu baris: basis tanggal lead masuk WIB, cutoff evaluasi, hari berjalan)
// dan menawarkan pintasan yang MENGUBAH filter global itu (bukan state lokal), supaya semua tab selalu memakai periode yang sama.
export default function BannerPeriode({ periode, hariIni, onUbahRentang, cutoff, ringkas = false, children }) {
  const saran = saranRentang(hariIni);
  const pilih = (s) => onUbahRentang?.(makeCustomRange(s.dari, s.sampai));
  const Pintasan = () => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {saran.map((s) => <button key={s.id} type="button" className="btn btn-sm bg-surface text-ink shadow-card" onClick={() => pilih(s)}>{s.label}</button>)}
    </span>
  );
  if (!periode.ok) {
    return (
      <Card className="flex flex-col gap-2 !p-4" role="alert">
        <p className="flex items-start gap-2 text-[13px] font-medium text-orange"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {periode.alasan}</p>
        <p className="t-secondary text-[12.5px]">Ubah filter tanggal di kanan atas, atau pilih salah satu:</p>
        <Pintasan />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid="banner-periode">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink2">
        <CalendarDays size={15} className="shrink-0 text-accent" aria-hidden />
        <span>Lead masuk (WIB): <b className="text-ink">{teksPeriode(periode.dari, periode.sampai)}</b> <span className="t-secondary">· {periode.hari} hari</span></span>
        {!ringkas && cutoff && <span className="t-secondary">· pembayaran &amp; status order dievaluasi sampai <b className="font-semibold text-ink2">{cutoff}</b></span>}
      </p>
      {periode.termasukHariBerjalan && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-card bg-orangebg px-3 py-2 text-[12.5px] font-medium text-orange">
          <AlertTriangle size={15} className="shrink-0" />
          <span>Memuat hari berjalan: lead dan pembayaran masih bertambah, biaya hari ini belum final — CPA/ROAS sengaja kosong.</span>
          <Pintasan />
        </div>
      )}
      {children}
    </div>
  );
}
