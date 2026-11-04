import React, { useId, useState } from "react";
import { ChevronRight, Info, Plus, Search, IkPesanan, IkKotak, IkAlur, IkJam } from "@/components/ikApple.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import {
  TAB_PO_TAMPIL, statusTampil, ringkasPenerimaan, kalimatHasil, kalimatCakupan, ALUR_PEMBELIAN, CATATAN_TANPA_PO, ALASAN_IZIN,
} from "./poTampilan.js";

// Panel-panel daftar Pesanan Pembelian (gaya: styles/sanss-finance-po.css, dikunci ke .fin-po). Hanya presentasi: data, filter, endpoint, dan izin datang dari FinancePurchaseOrders.jsx.

const tgl = (v) => (v ? tanggalPendek(String(v).slice(0, 10)) : "—");

export function ChipStatusPO({ status }) {
  const s = statusTampil(status);
  return <span className={`fin-chip fin-chip-${s.nada}`}>{s.label}</span>;
}

/** Tombol "PO baru". Tidak berizin → tetap tampil tetapi nonaktif dengan alasan yang dibaca pembaca layar (bukan hilang diam-diam). */
export function TombolPOBaru({ izin, onClick, kecil = false }) {
  const id = useId();
  const boleh = izin.catat;
  return (
    <span className="fin-po-baru">
      <Button size={kecil ? "sm" : undefined} onClick={onClick} disabled={!boleh} aria-describedby={boleh ? undefined : id} title={boleh ? undefined : ALASAN_IZIN.catat}>
        <Plus size={16} aria-hidden="true" /> PO baru
      </Button>
      {!boleh && <span id={id} className="fin-sr-saja">{ALASAN_IZIN.catat}</span>}
    </span>
  );
}

/** Strip pendek: PO = rencana pembelian; stok bertambah lewat proses penerimaan Gudang. Isi lengkap lewat "Alur pembelian". */
export function StripAlur() {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <section className="fin-po-strip" aria-label="Catatan alur pembelian">
      <div className="fin-po-strip-baris">
        <Info size={18} aria-hidden="true" className="fin-po-strip-ikon" />
        <p className="fin-po-strip-teks">PO mencatat rencana pembelian. Stok bertambah hanya setelah Gudang menyimpan barang ke stok.</p>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-pill-info" ikonKiri={<IkAlur size={18} />}>Alur pembelian</Pembuka>
      </div>
      {buka && (
        <div id={id} className="fin-po-strip-isi">
          <ol className="fin-po-alur">
            {ALUR_PEMBELIAN.map((l) => (
              <li key={l.no}><span className="fin-po-alur-no" aria-hidden="true">{l.no}</span><div><p className="fin-po-alur-judul">{l.judul}</p><p className="fin-po-alur-isi">{l.isi}</p></div></li>
            ))}
          </ol>
          <p className="fin-po-alur-catatan">{CATATAN_TANPA_PO}</p>
        </div>
      )}
    </section>
  );
}

function KpiPO({ nada, Ikon, label, nilai, ket, info }) {
  return (
    <div className={`fin-kpi fin-kpi-statis fin-kpi-${nada}`} role="group" aria-label={`${label}: ${nilai}. ${ket}`}>
      <div className="fin-kpi-atas">
        <span className="fin-kpi-ubin" aria-hidden="true"><Ikon size={22} /></span>
        <div className="fin-kpi-label"><span>{label}</span>{info && <InfoTooltip lebar={304} text={info} />}</div>
      </div>
      <p className="fin-kpi-nilai">{nilai}</p>
      <p className="fin-kpi-ket">{ket}</p>
    </div>
  );
}

/** Tiga KPI. Rumus & populasi lama dipertahankan (lihat kpiPO). Nilai belum masuk stok = ESTIMASI menurut harga PO — bukan utang dan bukan uang keluar. */
export function KpiDaftarPO({ kpi, cakupan }) {
  return (
    <>
      <section aria-label="Angka utama" className="fin-kpi-grid fin-kpi-grid-3">
        <KpiPO
          nada="biru" Ikon={IkPesanan} label="PO berjalan" nilai={kpi.berjalan.toLocaleString("id-ID")} ket="Disetujui · belum selesai masuk stok"
          info="PO berstatus Disetujui atau Diterima Sebagian. Selesai artinya semua jumlah yang dipesan sudah disimpan ke stok oleh Gudang."
        />
        <KpiPO
          nada="muda" Ikon={IkKotak} label="Estimasi belum masuk stok" nilai={formatUang(kpi.nilaiBelumMasukStok)} ket="Sisa jumlah × harga PO"
          info="Perkiraan nilai barang yang sudah dipesan tetapi belum disimpan ke stok, dihitung dari sisa jumlah dikali harga di PO (hanya PO berjalan). Ini bukan utang dan bukan uang keluar: utang baru ada saat faktur supplier disetujui, uang keluar saat dibayar."
        />
        <KpiPO
          nada="lavender" Ikon={IkJam} label="Draf" nilai={kpi.draf.toLocaleString("id-ID")} ket="Belum dapat dipilih Gudang"
          info="PO yang belum disetujui. Gudang belum bisa membuat penerimaan dari draf."
        />
      </section>
      <p className="fin-po-cakupan">{cakupan}</p>
    </>
  );
}

/** Satu panel: tahap status, pencarian, hasil, lalu daftar. */
export function ToolbarPO({ tab, setTab, q, setQ, jumlah, memuatUlang }) {
  return (
    <div className="fin-po-toolbar">
      <div className="fin-seg" role="group" aria-label="Tahap PO">
        {TAB_PO_TAMPIL.map((t) => (
          <button key={t.key || "semua"} type="button" className="fin-seg-item" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="fin-po-cari-baris">
        <label className="fin-po-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor PO atau supplier…" aria-label="Cari nomor PO atau supplier" />
        </label>
        {(q || tab) && <button type="button" className="fin-tombol" onClick={() => { setQ(""); setTab(""); }}><span>Atur ulang</span></button>}
      </div>
      <p className="fin-po-hasil" aria-live="polite" aria-busy={memuatUlang ? "true" : "false"}>{kalimatHasil({ jumlah, tab, q })}</p>
    </div>
  );
}

/** Bar penerimaan: satu bar (satu satuan) atau satu segmen per baris (satuan campuran). Selalu disertai teks, tidak mengandalkan warna. */
export function BarPenerimaan({ r }) {
  if (r.jenis === "campuran") {
    const segmen = r.segmen.length <= 12 ? r.segmen : null;
    return segmen ? (
      <div className="fin-po-seg" role="img" aria-label={r.judul}>
        {segmen.map((s, i) => <span key={i} className={`fin-po-seg-i${s.penuh ? " penuh" : ""}`} title={s.nama}><i style={{ width: `${Math.round(s.frac * 100)}%` }} /></span>)}
      </div>
    ) : (
      <div className="fin-po-bar" role="img" aria-label={r.judul}><i style={{ width: `${Math.round((r.selesai / r.segmen.length) * 100)}%` }} /></div>
    );
  }
  if (r.jenis === "draf" || r.jenis === "batal" || r.jenis === "kosong") return <div className="fin-po-bar fin-po-bar-kosong" aria-hidden="true"><i style={{ width: 0 }} /></div>;
  return <div className={`fin-po-bar${r.persen >= 100 ? " penuh" : ""}`} role="progressbar" aria-label="Persen masuk stok" aria-valuenow={r.persen} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${r.persen}%` }} /></div>;
}

function BarisPO({ p, onBuka }) {
  const r = ringkasPenerimaan(p);
  const nama = p.supplier?.name || "—";
  return (
    <div className="fin-po-baris" role="row" data-testid="baris-po-daftar" data-status={p.status} onClick={(e) => { if (!e.target.closest("button, a")) onBuka(p.id); }}>
      <div className="fin-po-sel fin-po-id" role="cell">
        <div className="fin-po-id-atas"><span className="fin-po-nomor">{p.poNumber}</span><ChipStatusPO status={p.status} /></div>
        <span className="fin-po-supplier" title={nama}>{nama}</span>
      </div>
      <div className="fin-po-sel fin-po-tgl" role="cell"><span className="fin-po-label-kecil">Tanggal PO</span>{tgl(p.orderDate)}</div>
      <div className="fin-po-sel fin-po-tgl" role="cell"><span className="fin-po-label-kecil">Perkiraan datang</span>{tgl(p.expectedDate)}</div>
      <div className="fin-po-sel fin-po-terima" role="cell">
        <span className="fin-po-label-kecil">Penerimaan</span>
        <span className="fin-po-terima-judul">{r.judul}</span>
        <BarPenerimaan r={r} />
        {r.sub && <span className="fin-po-terima-sub">{r.sub}</span>}
      </div>
      <div className="fin-po-sel fin-po-nilai" role="cell"><span className="fin-po-label-kecil">Nilai PO</span>{formatUang(p.totalDipesan)}</div>
      <div className="fin-po-sel fin-po-aksi" role="cell">
        <button type="button" className="fin-po-rincian" onClick={() => onBuka(p.id)} aria-label={`Rincian ${p.poNumber}, ${nama}`}><span className="fin-po-rincian-teks">Rincian</span><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

/** Daftar: tabel padat di panel lebar, daftar ringkas berkartu di panel sempit (container query). Memuat/gagal/kosong dirender HalamanFinance & EmptyState, bukan di sini. */
export function DaftarPOPanel({ daftar, onBuka, onBaru, izin, adaSaringan, onReset }) {
  if (daftar.length === 0) {
    return (
      <div className="fin-po-kosong">
        <EmptyState
          icon={IkPesanan}
          title={adaSaringan ? "Tidak ada PO yang cocok" : "Belum ada pesanan pembelian"}
          description={adaSaringan ? "Coba ubah tahap atau kata kunci pencarian." : "Buat PO untuk bahan yang akan dibeli dari supplier."}
          action={adaSaringan ? <Button size="sm" variant="neutral" onClick={onReset}>Atur ulang saringan</Button> : <TombolPOBaru izin={izin} onClick={onBaru} kecil />}
        />
      </div>
    );
  }
  return (
    <div className="fin-po-daftar" role="table" aria-label="Daftar pesanan pembelian">
      <div className="fin-po-kepala" role="row">
        <span role="columnheader">PO / Supplier</span><span role="columnheader">Tanggal PO</span><span role="columnheader">Perkiraan datang</span>
        <span role="columnheader">Penerimaan</span><span role="columnheader" className="fin-kanan">Nilai PO</span><span role="columnheader" className="fin-sr-saja">Rincian</span>
      </div>
      <div className="fin-po-isi" role="rowgroup">
        {daftar.map((p) => <BarisPO key={p.id} p={p} onBuka={onBuka} />)}
      </div>
    </div>
  );
}

export { kalimatCakupan };
