import React, { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, Scale, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";
import TombolExportExcel from "@/features/finance/ExportExcel.jsx";
import { DaftarRekonModal } from "@/features/laporan/components/RekonSalesFinance.jsx";

// KARTU "Kenapa angka Finance dan Sales berbeda?" (halaman Pembayaran & Verifikasi).
// SEMUA angka, penyebab, status, penjelasan, dan daftar order datang dari SATU payload server (GET /sales-finance/rekon → kartuSelisih + detail) — payload yang sama dengan panel
// Rekonsiliasi di Laporan Sales dan Export Excel (modul rekon-sales-finance). Komponen ini TIDAK menghitung apa pun; penjelasan tampil langsung (tanpa hover).

const rpBertanda = (n) => (n < 0 ? `−${formatRupiah(Math.abs(n))}` : formatRupiah(n));
const STATUS = {
  COCOK: { variant: "green", Ikon: CheckCircle2 },
  TERJELASKAN: { variant: "accent", Ikon: Scale },
  TIDAK_COCOK: { variant: "red", Ikon: AlertTriangle },
};

function Angka({ label, nilai, sub, aksen }) {
  return (
    <div className="min-w-0 rounded-btn bg-inset/60 px-3 py-2.5">
      <p className="text-[12px] font-medium text-ink3">{label}</p>
      <p className={cn("mt-1 text-[18px] font-bold leading-tight tabular-nums text-ink", aksen)}>{nilai}</p>
      {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-ink3">{sub}</p>}
    </div>
  );
}

function BarisPenyebab({ p, onBuka, bisaBuka }) {
  const klik = bisaBuka && p.bisaDibuka;
  return (
    <button
      type="button" disabled={!klik} onClick={() => onBuka(p.kunci)} data-testid={`penyebab-${p.kunci}`}
      className={cn("flex w-full items-start gap-2 border-b border-line/60 px-3 py-2.5 text-left last:border-0 max-sm:min-h-11", klik ? "cursor-pointer hover:bg-hovertint" : "cursor-default")}
    >
      <span className="mt-0.5 w-4 shrink-0 text-center text-[13px] font-bold text-ink3">{p.arah === "MENAMBAH" ? "+" : "−"}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-snug text-ink">{p.label}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink2">{p.penjelasan}</span>
        <span className="mt-0.5 block text-[11.5px] text-ink3">{p.nOrder} order{p.tindakan ? ` · Tindakan: ${p.tindakan.label}` : ""}</span>
      </span>
      <span className="shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink2">{formatRupiah(Math.abs(p.efek))}</span>
      <span className="w-4 shrink-0 pt-0.5 text-ink3">{klik ? <ChevronRight size={14} aria-hidden /> : null}</span>
    </button>
  );
}

/**
 * @param from,to            periode yang sama dengan halaman (YYYY-MM-DD)
 * @param onTinjauMenunggu   pindah ke daftar Payment menunggu verifikasi
 * @param onTinjauKlaim      pindah ke daftar Klaim Lunas tanpa Payment
 */
export default function KartuSelisihSalesFinance({ from, to, onTinjauMenunggu, onTinjauKlaim, className }) {
  const [s, setS] = useState({ loading: true, data: null, error: null });
  const [buka, setBuka] = useState(null);
  const muat = useCallback(() => {
    let batal = false;
    setS((x) => ({ ...x, loading: true, error: null }));
    api.getRekonSalesFinance({ from, to })
      .then((data) => { if (!batal) setS({ loading: false, data, error: null }); })
      .catch((e) => { if (!batal) setS({ loading: false, data: null, error: e.message || "Gagal memuat" }); });
    return () => { batal = true; };
  }, [from, to]);
  useEffect(() => muat(), [muat]);

  const d = s.data; const k = d?.kartuSelisih;
  const bisaBuka = !!d?.detailTersedia;
  const st = k ? STATUS[k.status.kode] : null;
  const tinjau = (kunci) => k?.tindakLanjut.find((t) => t.kunci === kunci);
  const ambilBody = () => ({ periode: { from, to }, filter: {}, filterLabel: `Status kartu: ${k?.status.label ?? "—"}` });

  return (
    <Card className={cn("fin-glass", className)} data-testid="kartu-selisih-sales-finance">
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink"><Scale size={16} className="shrink-0 text-accent" />Kenapa angka Finance dan Sales berbeda?</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">
              Finance menghitung <b>uang yang sudah diverifikasi</b> (tanggal pembayaran diterima); Sales menghitung <b>nilai order yang menjadi Lunas</b> (tanggal lunas). Dua angka itu berbeda karena
              kejadiannya berbeda — selisihnya dijelaskan di bawah, sampai Rp0.
            </p>
          </div>
          {st && <Badge variant={st.variant}><st.Ikon size={12} className="mr-1" />{k.status.label}</Badge>}
        </div>

        {s.loading && !d ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-ink2"><Loader2 size={14} className="animate-spin" /> Menghitung rekonsiliasi…</div>
        ) : s.error ? (
          <p className="text-[13px] text-ink2">Kartu belum bisa dimuat: {s.error} <Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button></p>
        ) : k ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Angka label="Payment tercatat" nilai={formatRupiah(k.tercatat.jumlah)} sub={`${k.tercatat.nPayment} Payment · termasuk ${formatRupiah(k.tercatat.menunggu.jumlah)} (${k.tercatat.menunggu.nPayment}) menunggu verifikasi`} />
              <Angka label="Sudah diverifikasi Finance" nilai={formatRupiah(k.terverifikasi.jumlah)} sub={`${k.terverifikasi.nPayment} Payment terverifikasi`} />
              <Angka label="Klaim Lunas Sales" nilai={formatRupiah(k.klaimLunas.jumlah)} sub={`${k.klaimLunas.nOrder} order Lunas · nilai jasa tanpa ongkir`} />
              <Angka label="Selisih" nilai={rpBertanda(k.selisih.jumlah)} sub="Klaim Lunas − Sudah diverifikasi" />
            </div>

            <div>
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">
                {k.penyebab.length ? `${k.penyebab.length} penyebab selisih · sentuh untuk melihat daftar order` : "Tidak ada selisih"}
              </p>
              {k.penyebab.length > 0 && (
                <div className="rounded-card bg-surface shadow-card">
                  {k.penyebab.map((p) => <BarisPenyebab key={p.kunci} p={p} bisaBuka={bisaBuka} onBuka={setBuka} />)}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-inset/60 px-3 py-2.5 text-[12.5px]">
                    <span className="text-ink2">Jumlah seluruh penyebab = <b className="tabular-nums text-ink">{rpBertanda(k.penyebab.reduce((a, p) => a + p.efek, 0))}</b> (sama dengan selisih)</span>
                    <span className={cn("font-semibold tabular-nums", k.residual.nol ? "text-ink2" : "text-red")}>Residual tahap 1: {rpBertanda(k.residual.tahap1)}</span>
                  </div>
                </div>
              )}
            </div>

            {(k.tim.penyebab.length > 0 || k.tim.selisihDariTotal !== 0) && (
              <div className="rounded-btn bg-inset/50 px-3 py-2.5">
                <p className="text-[13px] font-semibold text-ink">Nilai Tim Sales {formatRupiah(k.tim.jumlah)} <span className="font-normal text-ink3">({rpBertanda(k.tim.selisihDariTotal)} dari Total Perusahaan)</span></p>
                {k.tim.penyebab.map((p) => (
                  <button key={p.kunci} type="button" disabled={!bisaBuka} onClick={() => setBuka(p.kunci)} className={cn("mt-1 flex w-full items-start justify-between gap-2 text-left text-[12.5px] text-ink2 max-sm:min-h-11", bisaBuka && "hover:text-ink")}>
                    <span><b className="font-semibold">{p.arah === "MENAMBAH" ? "+" : "−"} {p.label}</b> · {p.nOrder} order — {p.penjelasan}</span>
                    <span className="shrink-0 tabular-nums">{formatRupiah(Math.abs(p.efek))}</span>
                  </button>
                ))}
                <p className={cn("mt-1 text-[11.5px]", k.residual.tahap2 === 0 ? "text-ink3" : "text-red")}>Residual tahap 2: {rpBertanda(k.residual.tahap2)}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {tinjau("PAYMENT_MENUNGGU") && <Button size="sm" variant="secondary" onClick={onTinjauMenunggu}>Tinjau Payment Menunggu ({tinjau("PAYMENT_MENUNGGU").nOrder})</Button>}
              {tinjau("KLAIM_TANPA_PAYMENT") && <Button size="sm" variant="secondary" onClick={onTinjauKlaim}>Tinjau Klaim Tanpa Payment ({tinjau("KLAIM_TANPA_PAYMENT").nOrder})</Button>}
              {tinjau("TANPA_SALES") && bisaBuka && <Button size="sm" variant="neutral" onClick={() => setBuka("TANPA_SALES")}>Tetapkan Sales ({tinjau("TANPA_SALES").nOrder})</Button>}
              {tinjau("ONGKIR") && bisaBuka && <Button size="sm" variant="neutral" onClick={() => setBuka("ONGKIR")}>Lihat Ongkir ({tinjau("ONGKIR").nOrder})</Button>}
              <TombolExportExcel modul="rekon-sales-finance" label="Export Rekonsiliasi" ambilBody={ambilBody} />
            </div>
            <p className="text-[11.5px] leading-snug text-ink3">
              Status: <b>Cocok</b> = tidak ada selisih · <b>Berbeda tetapi terjelaskan</b> = ada selisih dan residual Rp0 · <b>Tidak cocok</b> = residual ≠ Rp0 atau ada selisih yang belum bisa diklasifikasikan.
              Payment dibatalkan tidak dihitung.
            </p>
          </>
        ) : null}
      </CardContent>
      <DaftarRekonModal kunci={buka} data={d} onClose={() => setBuka(null)} onDitetapkan={muat} />
    </Card>
  );
}
