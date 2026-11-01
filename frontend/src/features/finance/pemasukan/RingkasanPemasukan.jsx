import React, { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Info } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { tanggalPendek } from "@/features/finance/shared.jsx";
import { KpiKartu } from "@/features/finance/RingkasanPanels.jsx";
import TombolExportExcel from "@/features/finance/ExportExcel.jsx";
import { IkGrafik, IkStruk } from "@/components/sanssIcons.jsx";
import { IkKasBank } from "@/components/financeIcons.jsx";
import { IkJam, IkKoin, IkDanaMasuk, IkDikecualikan } from "./IkonPemasukan.jsx";
import { PENJELASAN_BEDA, susunTindakLanjut, teksRp } from "./pemasukanLogic.js";

// RINGKASAN PEMASUKAN — gaya Ringkasan Finance (styles/sanss-finance.css + sanss-finance-pemasukan.css). Semua angka/teks dari GET /pemasukan/ringkasan;
// halaman ini hanya menata. Cakupan tanggal tiap angka ditulis di keterangannya (sumbernya berbeda-beda).

function Pembuka({ buka, onToggle, id, children, className = "" }) {
  return (
    <button type="button" className={`fin-pm-pembuka ${className}`} aria-expanded={buka} aria-controls={id} onClick={onToggle}>
      {children}{buka ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
}

/** Peringatan data sementara → strip singkat + "Lihat rincian" (isi lengkap tidak dibuang). Kondisi tampil sama dengan banner lama (selalu, selama rekonsiliasi 2026 berjalan). */
export function StripSementara({ teks }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <section className="fin-strip fin-strip-perhatian" role="status" data-testid="strip-sementara">
      <div className="fin-strip-baris">
        <AlertTriangle size={18} className="fin-strip-ikon" aria-hidden="true" />
        <div className="fin-strip-teks"><p className="fin-strip-judul">Angka masih sementara</p></div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pm-pembuka-strip">{buka ? "Tutup rincian" : "Lihat rincian"}</Pembuka>
      </div>
      {buka && <div id={id} className="fin-strip-rincian"><p><strong>Angka belum final.</strong> {teks}</p></div>}
    </section>
  );
}

export function Panel({ judul, sub, aksi, children, testid, className = "" }) {
  return (
    <section className={`fin-panel ${className}`} data-testid={testid}>
      <div className="fin-panel-kepala fin-panel-kepala-aksi">
        <div className="fin-panel-kepala-isi">
          <h2 className="fin-panel-judul">{judul}</h2>
          {sub && <p className="fin-panel-sub">{sub}</p>}
        </div>
        {aksi}
      </div>
      {children}
    </section>
  );
}

/** Baris yang membuka kategori lain (satu tombol, chevron kanan). */
function BarisKategori({ ikon: Ikon, judul, ket, nilai, onKlik, testid, anak }) {
  return (
    <li className="fin-pm-kat" data-testid={testid}>
      <button type="button" className="fin-pm-kat-tombol" onClick={onKlik}>
        <span className="fin-pm-ikon" aria-hidden="true"><Ikon size={20} /></span>
        <span className="fin-pm-kat-teks"><span className="fin-pm-kat-judul">{judul}</span><span className="fin-pm-kat-ket">{ket}</span></span>
        <span className="fin-pm-kat-nilai">{nilai}</span>
        <ChevronRight size={16} aria-hidden="true" className="fin-pm-kat-panah" />
      </button>
      {anak}
    </li>
  );
}

function BarisTindak({ b, ke }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  const bersih = b.status === "bersih";
  const adaRincian = b.id === "celah";
  const cakupan = b.cakupan ?? (b.cakupanDari ? `${tanggalPendek(b.cakupanDari)} – ${tanggalPendek(b.cakupanSampai)}` : null);
  return (
    <li className="fin-pm-tl" data-testid={`tindak-${b.id}`} data-status={b.status}>
      <div className="fin-pm-tl-baris">
        <span className={`fin-tl-ikon ${bersih ? "fin-tl-ikon-bersih" : "fin-tl-ikon-perlu"}`} aria-hidden="true">{bersih ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
        <div className="fin-pm-tl-teks">
          <p className="fin-pm-tl-judul">{b.judul}</p>
          <p className="fin-pm-tl-ket">{b.penjelasan}</p>
          <p className="fin-pm-tl-meta">
            {cakupan && <span className="fin-cakupan">{cakupan}</span>}
            {bersih ? <span className="fin-ok">Tidak ada</span> : <span>{b.jumlah.toLocaleString("id-ID")} {b.satuan} · {teksRp(b.nilai)}</span>}
          </p>
        </div>
        {b.tujuan && <button type="button" className="fin-pm-tl-aksi" onClick={() => ke(b.tujuan)} aria-label={`Buka ${b.judul}`}>Buka <ChevronRight size={14} aria-hidden="true" /></button>}
        {adaRincian && <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pm-tl-aksi">{buka ? "Tutup" : "Lihat rincian"}</Pembuka>}
      </div>
      {adaRincian && buka && (
        <div id={id} className="fin-catatan-kaki fin-pm-tl-rincian">
          <p>Tanggal acuan sistem: <strong>{b.tanggalAcuan ? tanggalPendek(b.tanggalAcuan) : "—"}</strong>.{b.dasar ? ` ${b.dasar}` : ""}</p>
          <p>Order sistem {tanggalPendek(b.cakupanDari)} – {tanggalPendek(b.cakupanSampai)}: <strong>{b.jumlah.toLocaleString("id-ID")} order senilai {teksRp(b.nilai)}</strong> belum memiliki pengakuan pendapatan di buku besar. {b.rincian}</p>
        </div>
      )}
    </li>
  );
}

export default function RingkasanPemasukan({ r, periode, ke, navigate }) {
  const [dikecualikan, setDikecualikan] = useState(false);
  const [tentang, setTentang] = useState(false);
  const idEx = useId();
  const idTentang = useId();
  const tl = susunTindakLanjut(r);
  const v = r.perluVerifikasiFinance;
  const pm = r.pembayaranMasuk;
  const ps = r.pendapatanSistem;
  const ph = r.pendapatanHistoris;
  const dk = r.dikecualikan;

  return (
    <div className="fin-pm-ringkasan" data-testid="ringkasan-pemasukan">
      <div className="fin-pm-ekspor">
        {/* Tab Ringkasan tidak punya daftar sendiri: export memuat seluruh pemasukan periode ini (semua kategori) + sheet Rekap Klasifikasi. */}
        <TombolExportExcel modul="pemasukan" ambilBody={() => ({ periode: { from: periode.from, to: periode.to }, filter: {}, filterLabel: "Ringkasan — semua kategori pemasukan" })} />
      </div>

      <section aria-label="Angka utama" className="fin-kpi-grid">
        <KpiKartu
          nada="biru" Ikon={IkGrafik} label="Pendapatan diakui" metrik="pendapatan_diakui"
          nilai={teksRp(ps.nilai)} ket={`Dari sistem · mengikuti tanggal pengakuan · ${ps.jumlah.toLocaleString("id-ID")} pengakuan`}
          info={`Penjualan yang sudah diakui di buku besar pada periode ini, dikurangi retur/potongan (retur ${teksRp(ps.retur)}). Hanya dari sistem; gabungan dengan data sebelum penggunaan sistem ada di ‘Rincian pendapatan’.`}
          onClick={() => ke("pendapatan")}
        />
        <KpiKartu
          nada="muda" Ikon={IkKasBank} label="Uang masuk terverifikasi" metrik="uang_masuk_terverifikasi"
          nilai={teksRp(pm.terverifikasi.nilai)} ket={`${pm.terverifikasi.jumlah.toLocaleString("id-ID")} pembayaran · periode terpilih`}
          info="Uang pelanggan yang sudah diverifikasi Finance. Rekening muncul di sini, bukan selalu di pendapatan. Pembayaran yang masih menunggu verifikasi tidak ikut."
          onClick={() => ke("pembayaran")}
        />
        <KpiKartu
          nada="lavender" Ikon={IkStruk} label="Sisa tagihan" metrik="piutang_usaha"
          nilai={teksRp(r.piutangTersisa.nilai)} ket={`${r.piutangTersisa.jumlahOrder.toLocaleString("id-ID")} order · posisi per ${tanggalPendek(r.piutangTersisa.perTanggal)}`}
          info="Sisa tagihan yang belum tertagih menurut buku besar (posisi akhir periode, bukan arus). Bukan sama dengan uang masuk maupun pendapatan."
          onClick={() => navigate("/finance/receivables")}
        />
        <KpiKartu
          nada="lime" Ikon={IkJam} label="Menunggu verifikasi"
          nilai={String(v.totalJumlah)} ket={`${v.klaimSales.jumlah.toLocaleString("id-ID")} klaim lunas Sales · ${v.pembayaranMenunggu.jumlah.toLocaleString("id-ID")} pembayaran · semua periode`}
          info={v.penjelasan}
          catatanTanggal="Semua periode; tidak mengikuti pilihan tanggal di atas."
          onClick={() => ke("verifikasi")}
        />
      </section>

      <p className="fin-pm-beda" data-testid="pendapatan-beda">
        <Info size={16} aria-hidden="true" />
        <span>Pendapatan dan uang masuk berbeda cakupan. Keduanya tidak dijumlahkan.</span>
        <InfoTooltip lebar={304} text={PENJELASAN_BEDA} />
      </p>

      <div className="fin-dua">
        <Panel judul="Rincian pendapatan" sub="Mengikuti tanggal pengakuan, periode terpilih." testid="rincian-pendapatan">
          <dl className="fin-pm-rincian-uang">
            <div>
              <dt>Dari sistem <span className="fin-redup">{ps.jumlah.toLocaleString("id-ID")} pengakuan · retur {teksRp(ps.retur)}</span></dt>
              <dd>{teksRp(ps.nilai)}</dd>
            </div>
            <div>
              <dt>Data sebelum penggunaan sistem <span className="fin-redup">{ph.jumlah.toLocaleString("id-ID")} baris · {ph.perluDitinjau.jumlah.toLocaleString("id-ID")} perlu ditinjau</span>
                <InfoTooltip text={r.labelHistoris} lebar={304} />
              </dt>
              <dd>{teksRp(ph.nilai)}</dd>
            </div>
            <div className="fin-pm-total">
              <dt>Pendapatan gabungan <InfoTooltip text={r.pendapatanGabungan.catatan} lebar={304} /></dt>
              <dd>{teksRp(r.pendapatanGabungan.nilai)}</dd>
            </div>
          </dl>
          <p className="fin-pm-kaki">Setelah pemeriksaan duplikasi.</p>
          <p className="fin-pm-tautan-baris"><button type="button" className="fin-pm-tautan" onClick={() => ke("historis")}>Lihat data sebelum penggunaan sistem <ChevronRight size={14} aria-hidden="true" /></button></p>
        </Panel>

        <Panel judul="Perlu ditindaklanjuti" sub="Tiap baris punya cakupan sendiri dan tidak dijumlahkan." testid="perlu-ditindaklanjuti">
          <ul className="fin-pm-tl-daftar">{tl.map((b) => <BarisTindak key={b.id} b={b} ke={ke} />)}</ul>
        </Panel>
      </div>

      <Panel judul="Kategori pemasukan lainnya" sub="Dicatat dan dikelompokkan terpisah dari pendapatan." testid="kategori-pendukung">
        <ul className="fin-pm-kat-daftar">
          <BarisKategori ikon={IkKoin} judul="Pemasukan lain" ket={`${r.pemasukanLain.jumlah.toLocaleString("id-ID")} catatan`} nilai={teksRp(r.pemasukanLain.nilai)} onKlik={() => ke("lain")} testid="kat-lain" />
          <BarisKategori
            ikon={IkDanaMasuk} judul="Dana masuk bukan pendapatan" ket={`${r.danaMasukBukanPendapatan.jumlah.toLocaleString("id-ID")} catatan`} nilai={teksRp(r.danaMasukBukanPendapatan.nilai)} onKlik={() => ke("dana")} testid="kat-dana"
            anak={r.danaMasukBukanPendapatan.rincian.length > 0 && (
              <ul className="fin-pm-subrincian" aria-label="Rincian dana masuk bukan pendapatan">
                {r.danaMasukBukanPendapatan.rincian.map((x) => <li key={x.sub}><span>{x.label} ({x.jumlah})</span><span>{teksRp(x.nilai)}</span></li>)}
              </ul>
            )}
          />
          <li className="fin-pm-kat" data-testid="kat-dikecualikan">
            <div className="fin-pm-kat-tombol fin-pm-kat-statis">
              <span className="fin-pm-ikon" aria-hidden="true"><IkDikecualikan size={20} /></span>
              <span className="fin-pm-kat-teks"><span className="fin-pm-kat-judul">Transaksi yang dikecualikan</span><span className="fin-pm-kat-ket">Bukan pendapatan maupun dana masuk eksternal</span></span>
              <Pembuka buka={dikecualikan} onToggle={() => setDikecualikan((v) => !v)} id={idEx} className="fin-pm-kat-pembuka">{dikecualikan ? "Tutup" : "Lihat rincian"}</Pembuka>
            </div>
            {dikecualikan && (
              <ul id={idEx} className="fin-pm-subrincian">
                <li><span>Transfer antar-rekening ({dk.transfer.jumlah})</span><span>{teksRp(dk.transfer.nilai)}</span></li>
                <li><span>Saldo awal / koreksi saldo ({dk.saldoAwal.jumlah})</span><span>{teksRp(dk.saldoAwal.nilai)}</span></li>
                <li><span>Pembalikan pengeluaran ({dk.pembalikanBiaya.jumlah})</span><span>{teksRp(dk.pembalikanBiaya.nilai)}</span></li>
              </ul>
            )}
          </li>
        </ul>
      </Panel>

      <section className="fin-pm-tentang" data-testid="tentang-angka">
        <Pembuka buka={tentang} onToggle={() => setTentang((v) => !v)} id={idTentang} className="fin-pm-pembuka-lunak"><Info size={14} aria-hidden="true" /> Tentang angka dan data lama</Pembuka>
        {tentang && (
          <div id={idTentang} className="fin-catatan-kaki">
            <p>{r.labelHistoris}</p>
            {r.penjelasan?.map((t) => <p key={t}>{t}</p>)}
            {r.terpotong && <p>Data sangat besar; sebagian dipotong server. Persempit periode.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
