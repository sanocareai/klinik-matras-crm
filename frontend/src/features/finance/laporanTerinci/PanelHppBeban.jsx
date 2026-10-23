import React, { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Uang, formatUang } from "@/features/finance/shared.jsx";
import { cn } from "@/lib/utils.js";
import { KartuPanel, KotakAngka, KotakCatatan } from "./ui.jsx";
import { penandaMutu, penandaDivisi, labelSumber, tanggalPanjang } from "./logic.js";
import { KotakPembalik, UangBiaya } from "@/features/finance/biayaNeto.jsx";
import { penandaDari } from "@/features/finance/biayaNetoLogic.js";

// HPP & PENANDA MUTU MARGIN, BEBAN PER DIVISI (+ konflik atribusi, belum teratribusi). Semua angka dari server; estimasi dan biaya tak terbukti TIDAK ikut laba.

export function PanelHpp({ data }) {
  const h = data.hpp; const m = penandaMutu(h); const k = h.konsumsiBahan; const penanda = penandaDari(data); const adaPembalik = (h.terbukukan.pembalikBebanBersih ?? 0) < 0;
  return (
    <KartuPanel testid="panel-hpp" judul="HPP & Mutu Margin" deskripsi="Dipisah tegas: yang terbukukan (ikut laba), yang belum dapat dibuktikan (nominal kosong), estimasi informatif (tidak ikut laba), dan persediaan (bukan HPP).">
      <div className={cn("flex flex-wrap items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]", m.final ? "bg-greenbg text-green" : m.kunci === "BELUM_LENGKAP" ? "bg-orangebg text-orange" : "bg-inset text-ink2")} data-testid="hpp-status">
        {m.final ? <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5" /> : <AlertTriangle size={16} aria-hidden="true" className="mt-0.5" />}
        <div className="min-w-0"><p className="m-0 font-bold">{m.label}</p>{h.alasan.length > 0 && <ul className="m-0 mt-1 list-disc space-y-0.5 pl-4 text-[12px]">{h.alasan.map((a) => <li key={a}>{a}</li>)}</ul>}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KotakAngka label="HPP terbukukan (ikut laba)" nilai={formatUang(h.terbukukan.total)} sub={adaPembalik ? `termasuk pembalik beban bersih ${formatUang(h.terbukukan.pembalikBebanBersih)}` : undefined} />
        <KotakAngka label="Unit terkirim / pemakaian bernilai" nilai={`${k.unitTerkirim} / ${k.unitDenganPemakaianBernilai}`} sub={`${k.unitTanpaCatatan} unit tanpa catatan pemakaian`} tone={k.unitTanpaCatatan > 0 ? "orange" : undefined} />
        <KotakAngka label="Biaya belum dapat dibuktikan" nilai="Tidak terbukti" sub="Nominal sengaja kosong, bukan Rp0" tone="orange" />
        <KotakAngka label="Penerimaan bahan (aset)" nilai={formatUang(h.persediaan.penerimaanBahanBernilai)} sub="Persediaan, bukan HPP" />
      </div>

      <Bagian judul="1 · Terbukukan — ikut laba" testid="hpp-terbukukan">
        <ul className="m-0 list-none divide-y divide-[color:var(--hairline)] p-0">
          {h.terbukukan.akun.map((a) => (
            <li key={a.kode} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-[13px]"><span className="min-w-0"><span className="font-mono text-ink3">{a.kode}</span> {a.label}<span className="block text-[11px] text-ink3">{a.nBaris} baris jurnal</span></span><span className="tabular-nums font-semibold"><UangBiaya value={a.nilai} penanda={penanda} /></span></li>
          ))}
          {h.terbukukan.akun.length === 0 && <li className="px-3 py-3 text-[13px] text-ink3">Tidak ada beban pokok pada periode ini.</li>}
        </ul>
        <p className="m-0 px-3 pb-2 text-[11.5px] text-ink3">{h.terbukukan.catatan}</p>
        <div className="px-3 pb-3"><KotakPembalik penanda={penanda} ada={adaPembalik} testid="kotak-pembalik-hpp" /></div>
      </Bagian>

      {h.pembalikLintasPeriode.jumlahBaris > 0 && (
        <KotakCatatan tone="orange" testid="hpp-pembalik-lintas">
          <strong>Pembalik jurnal periode sebelumnya: {formatUang(h.pembalikLintasPeriode.nilai, { kurung: false })}</strong> ({h.pembalikLintasPeriode.jumlahBaris} baris) — {h.pembalikLintasPeriode.pengaruh}
          <ul className="m-0 mt-1 list-disc pl-4 text-[11.5px]">{h.pembalikLintasPeriode.baris.map((b) => <li key={b.nomorJurnal}>{b.nomorJurnal} ({tanggalPanjang(b.tanggal)}) membalik {b.membalik?.nomor} ({tanggalPanjang(b.membalik?.tanggal)}) · {formatUang(b.nilai, { kurung: false })}</li>)}</ul>
        </KotakCatatan>
      )}

      <Bagian judul="2 · Belum dapat dibuktikan — tidak ikut laba, bukan Rp0" testid="hpp-tak-terbukti">
        <ul className="m-0 list-disc space-y-1 px-3 py-2 pl-7 text-[12.5px] text-ink2">
          <li>{h.tidakTerbukti.unitTanpaCatatanPemakaian} unit terkirim tanpa catatan pemakaian bahan.</li>
          <li>{h.tidakTerbukti.unitCatatanTanpaHarga} unit punya catatan pemakaian tanpa harga perolehan.</li>
          <li>{h.tidakTerbukti.catatanPemakaianTanpaHarga} catatan pemakaian periode ini tanpa harga.</li>
        </ul>
        <p className="m-0 px-3 pb-2 text-[11.5px] text-ink3">{h.tidakTerbukti.keterangan}</p>
      </Bagian>

      <Bagian judul="3 · Estimasi informatif — TIDAK masuk laba atau jurnal" testid="hpp-estimasi">
        <div className="px-3 py-2 text-[12.5px] text-ink2">
          <p className="m-0">Estimasi periode ini: <strong className="tabular-nums">{h.estimasiInformatif.periode == null ? "tidak ada catatan pemakaian untuk diestimasi" : formatUang(h.estimasiInformatif.periode)}</strong></p>
          {h.estimasiInformatif.historisPerBulan.length > 0 && (
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[12px]">
              {h.estimasiInformatif.historisPerBulan.map((b) => <li key={b.bulan} className="flex justify-between gap-3"><span>{b.bulan}: {b.unit} unit, {b.catatan} catatan</span><span className="tabular-nums">≈ {formatUang(b.estimasi)}{b.perUnit != null ? ` (${formatUang(b.perUnit)}/unit)` : ""}</span></li>)}
            </ul>
          )}
        </div>
        <p className="m-0 px-3 pb-2 text-[11.5px] text-ink3">{h.estimasiInformatif.keterangan}</p>
      </Bagian>
    </KartuPanel>
  );
}

function Bagian({ judul, children, testid }) {
  return <div className="rounded-xl bg-surface" data-testid={testid}><p className="m-0 border-b border-[color:var(--hairline)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink3">{judul}</p>{children}</div>;
}

export function PanelBeban({ data }) {
  const b = data.bebanDivisi; const penanda = penandaDari(data);
  const adaPembalikDivisi = b.divisi.some((d) => d.pembalikBebanBersih || d.akun.some((a) => a.pembalikBebanBersih));
  const [buka, setBuka] = useState(null);
  return (
    <KartuPanel testid="panel-beban" judul="Beban per Divisi" deskripsi="Akun → divisi → dokumen → jurnal, memakai aturan atribusi Laporan Divisi. Biaya tanpa bukti divisi tidak ditebak: masuk 'Belum teratribusi'."
      info="Pembayaran utang, uang muka, penerimaan persediaan, transfer kas, dan pembelian aset bukan beban dan tidak dihitung di sini.">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KotakAngka label="Total beban (pokok + operasional)" nilai={formatUang(b.totalDivisi)} sub={`${Number(b.totalDivisi) < 0 ? `${penanda.pembalikBebanBersih.label} — mengurangi biaya, menaikkan laba · ` : ""}${b.residual === 0 ? "= ledger (residual Rp0)" : `residual ${formatUang(b.residual)}`}`} tone={b.residual === 0 ? undefined : "red"} />
        <KotakAngka label="Belum teratribusi" nilai={formatUang(b.belumTeratribusi.nominal)} sub={`${b.belumTeratribusi.jumlahBaris} baris`} tone={b.belumTeratribusi.jumlahBaris ? "orange" : undefined} />
        <KotakAngka label="Bukti divisi bertentangan" nilai={`${b.konflik.jumlahBaris} baris`} sub={formatUang(b.konflik.nominal)} tone={b.konflik.jumlahBaris ? "orange" : undefined} />
        <KotakAngka label="Divisi terlibat" nilai={String(b.divisi.length)} />
      </div>
      <KotakPembalik penanda={penanda} ada={adaPembalikDivisi} testid="kotak-pembalik-divisi" />
      {b.divisi.length === 0 ? <p className="py-4 text-center text-[13px] text-ink3">Tidak ada beban pada periode ini.</p> : (
        <ul className="m-0 list-none divide-y divide-[color:var(--hairline)] rounded-xl bg-surface p-0" data-testid="daftar-divisi">
          {b.divisi.map((d) => {
            const pen = penandaDivisi(d.scope); const terbuka = buka === d.scope;
            return (
              <li key={d.scope}>
                <button type="button" onClick={() => setBuka(terbuka ? null : d.scope)} aria-expanded={terbuka} className="flex w-full min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-left text-[13px] hover:bg-inset">
                  {terbuka ? <ChevronDown size={14} aria-hidden="true" className="text-ink3" /> : <ChevronRight size={14} aria-hidden="true" className="text-ink3" />}
                  <span className="min-w-[7rem] flex-1"><span className="block font-medium">{d.label}</span><span className="text-[11.5px] text-ink3">{d.nDokumen} dokumen · {d.nBaris} baris{d.nKonflik ? ` · ${d.nKonflik} bukti bertentangan` : ""}</span></span>
                  {pen && <Badge variant={pen.varian}>{pen.label}</Badge>}
                  {d.nKonflik > 0 && <Badge variant="orange">{d.nKonflik} konflik</Badge>}
                  <span className="ml-auto max-w-full text-right tabular-nums font-semibold"><UangBiaya value={d.total} penanda={penanda} />{d.bebanPokok !== 0 && <span className="block text-[10.5px] font-normal text-ink3">pokok {formatUang(d.bebanPokok)}</span>}</span>
                </button>
                {terbuka && (
                  <ul className="m-0 list-none space-y-0.5 bg-inset/40 px-3 py-2 pl-9 text-[12.5px]" data-testid={`akun-divisi-${d.scope}`}>
                    {d.akun.map((a) => <li key={a.kode} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5"><span className="min-w-0"><span className="font-mono text-ink3">{a.kode}</span> {a.nama} <span className="text-ink3">· {a.nDokumen} dok</span></span><span className="tabular-nums"><UangBiaya value={a.nilai} penanda={penanda} /></span></li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {b.konflik.jumlahBaris > 0 && (
        <div data-testid="konflik-atribusi">
          <KotakCatatan tone="orange"><strong>{b.konflik.jumlahBaris} baris dengan bukti divisi bertentangan ({formatUang(b.konflik.nominal)})</strong> — {b.konflik.penjelasan}</KotakCatatan>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {b.konflik.baris.map((k) => (
              <li key={k.id} className="rounded-xl bg-surface px-3 py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono font-semibold">{k.nomorJurnal} <span className="font-sans font-normal text-ink3">{tanggalPanjang(k.tanggal)} · {labelSumber(k.sumber)}</span></span><span className="tabular-nums font-semibold"><Uang value={k.nilai} /></span></div>
                <p className="m-0 mt-0.5 text-ink2">{k.akunKode} {k.akunNama}{k.dokumen ? ` · dokumen ${k.dokumen}` : ""}</p>
                <p className="m-0 mt-0.5 text-[11.5px] text-ink3">Terpilih <strong className="text-ink2">{k.divisiTerpilihLabel}</strong> · kandidat bertentangan: {k.kandidatLabel.join(", ")} · {k.aturan}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {b.belumTeratribusi.jumlahBaris > 0 && (
        <div data-testid="belum-teratribusi">
          <KotakCatatan tone="orange"><strong>Belum teratribusi {formatUang(b.belumTeratribusi.nominal)}</strong> — sumber: {b.belumTeratribusi.sumber.map(labelSumber).join(", ")}. Tidak dimasukkan ke divisi mana pun.</KotakCatatan>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {b.belumTeratribusi.baris.map((r) => <li key={r.id} className="rounded-xl bg-surface px-3 py-2 text-[12.5px]"><div className="flex justify-between gap-2"><span className="font-mono font-semibold">{r.nomorJurnal} <span className="font-sans font-normal text-ink3">{tanggalPanjang(r.tanggal)} · {labelSumber(r.sumber)}</span></span><span className="tabular-nums font-semibold"><Uang value={r.nilai} /></span></div><p className="m-0 mt-0.5 text-ink3">{r.akunKode} {r.akunNama} · {r.deskripsi}</p></li>)}
          </ul>
        </div>
      )}
    </KartuPanel>
  );
}
