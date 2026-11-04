import React, { useMemo } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { IkDokumen } from "@/components/financeIconsBiaya.jsx";
import { IkTermin, IkKotak } from "@/components/financeIconsPO.jsx";
import { IkPersetujuan, IkKoin, IkGedung, IkKosong } from "@/components/financeIconsTagihan.jsx";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { SelectPO } from "@/features/finance/po/KontrolPO.jsx";
import { teksPeringatanUangMuka } from "@/features/finance/uangMukaFaktur/kelayakanLogika.js";
import {
  TAB_TAGIHAN, LABEL_TEMPO, tampilSisa, formatUangTepat, sisaKurangSatuRupiah, KET_SISA_SEN, statusTempo, asalTagihan, nomorFakturTampil, hitungTab, ringkasKpi, BATAS_DAFTAR_TAGIHAN,
} from "./tagihanLogika.js";

// Daftar Tagihan supplier: KPI utama + info pendukung + satu panel (tab status, pencarian, filter, jumlah hasil, baris).
// Populasi, satuan, dan rumus angka mengikuti server; komponen ini hanya menyajikan. Tidak ada paginasi/urut palsu: daftar server maksimal 300 baris.

const LABEL_STATUS_TAGIHAN = { DRAFT: "Draf", MENUNGGU_APPROVAL: "Menunggu persetujuan", DISETUJUI: "Disetujui", DIBAYAR_SEBAGIAN: "Dibayar sebagian", LUNAS: "Lunas", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan" };
const NADA_STATUS = { DRAFT: "netral", MENUNGGU_APPROVAL: "jingga", DISETUJUI: "biru", DIBAYAR_SEBAGIAN: "biru", LUNAS: "hijau", DITOLAK: "merah", DIBATALKAN: "netral" };

export function ChipStatusTagihan({ status, tempo }) {
  return (
    <span className="fin-tg-status">
      <span className="fin-tg-chip" data-nada={NADA_STATUS[status] || "netral"}><span className="fin-tg-titik" aria-hidden="true" />{LABEL_STATUS_TAGIHAN[status] || status}</span>
      {status === "DISETUJUI" && tempo !== "lewat" && <span className="fin-tg-sub">Belum dibayar</span>}
      {tempo === "lewat" && <span className="fin-tg-sub lewat">Lewat jatuh tempo</span>}
    </span>
  );
}

function KartuKpi({ Ikon, label, nilai, chip, ket, onClick, nada = "biasa", testid }) {
  const isi = (
    <>
      <span className="fin-tg-kpi-ikon" aria-hidden="true"><Ikon size={24} /></span>
      <span className="fin-tg-kpi-teks">
        <span className="fin-tg-kpi-label">{label}</span>
        <span className="fin-tg-kpi-nilai">{nilai}{chip && <span className="fin-tg-kpi-chip">{chip}</span>}</span>
        {ket && <span className="fin-tg-kpi-ket">{ket}</span>}
      </span>
      {onClick && <ChevronRight size={18} aria-hidden="true" className="fin-tg-kpi-panah" />}
    </>
  );
  return onClick
    ? <button type="button" className="fin-tg-kpi" data-nada={nada} onClick={onClick} data-testid={testid}>{isi}</button>
    : <div className="fin-tg-kpi" data-nada={nada} data-testid={testid}>{isi}</div>;
}

export function RingkasanTagihan({ aging, bills, uangMuka, unbilled, onTab, onLihatUangMuka, onLihatPenerimaan }) {
  const k = useMemo(() => ringkasKpi({ aging, bills, uangMuka, unbilled }), [aging, bills, uangMuka, unbilled]);
  return (
    <section className="fin-tg-kpi-wadah" aria-label="Ringkasan utang supplier" data-testid="kartu-supplier-utang">
      <div className="fin-tg-kpi-utama">
        <KartuKpi Ikon={IkDokumen} label="Sisa utang" nilai={formatUangTepat(k.sisaUtang.nilai)} ket={`${k.sisaUtang.jumlah} tagihan terbuka · utang resmi, sudah disetujui`} onClick={() => onTab("belum")} testid="kpi-sisa-utang" />
        <KartuKpi Ikon={IkTermin} label="Lewat jatuh tempo" nilai={formatUangTepat(k.lewatTempo.nilai)} chip={k.lewatTempo.jumlah > 0 ? `${k.lewatTempo.jumlah} tagihan` : undefined} nada={k.lewatTempo.jumlah > 0 ? "peringatan" : "biasa"} ket={k.lewatTempo.jumlah === 0 ? "Tidak ada" : undefined} onClick={() => onTab("proses")} testid="kpi-lewat-tempo" />
        <KartuKpi Ikon={IkPersetujuan} label="Menunggu persetujuan" nilai={`${k.menunggu.jumlah} tagihan`} ket={k.menunggu.terpotong ? "Dihitung dari 300 tagihan yang dimuat" : "Belum menjadi utang sampai disetujui"} nada={k.menunggu.jumlah > 0 ? "peringatan" : "biasa"} onClick={() => onTab("proses")} testid="kpi-menunggu" />
      </div>
      <div className="fin-tg-kpi-pendukung">
        <KartuKpi Ikon={IkKoin} label="Uang muka belum dialokasikan" nilai={formatUang(k.uangMuka.nilai)} ket={`${k.uangMuka.supplier} supplier · aset, bukan utang`} onClick={onLihatUangMuka} testid="kpi-uang-muka" />
        <KartuKpi Ikon={IkKotak} label="Penerimaan belum ditagih" nilai={`${k.penerimaan.jumlah}${k.penerimaan.terpotong ? "+" : ""} penerimaan`} ket={k.penerimaan.terpotong ? "Menampilkan 100 terbaru; mungkin ada lebih" : "Barang masuk, tagihan belum dicatat"} onClick={onLihatPenerimaan} testid="kpi-penerimaan" />
      </div>
    </section>
  );
}

function BarisTagihan({ b, hariIni, aksi, onBuka, kelayakanUm }) {
  const umPO = kelayakanUm?.get(b.id);
  const sisa = tampilSisa(b);
  const tempo = statusTempo(b, hariIni);
  const asal = asalTagihan(b);
  const nomor = nomorFakturTampil(b);
  const bukaDariKlik = (e) => {
    if (e.target.closest("button, a, input, select, textarea, [role='menuitem'], [data-tanpa-detail]")) return;
    onBuka(b);
  };
  const a = aksi(b);
  return (
    <div
      className="fin-tg-baris" role="row" tabIndex={0} data-testid="baris-tagihan" data-status={b.status}
      onClick={bukaDariKlik} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onBuka(b); } }}
      aria-label={`Tagihan ${nomor || b.billNumber} dari ${b.supplier?.name || "supplier"}, ${LABEL_STATUS_TAGIHAN[b.status] || b.status}. Buka rincian`}
    >
      <div className="fin-tg-sel fin-tg-faktur" role="cell">
        <span className="fin-tg-ikon-gedung" aria-hidden="true"><IkGedung size={20} /></span>
        <span className="fin-tg-faktur-teks">
          <span className="fin-tg-supplier" title={b.supplier?.name}>{b.supplier?.name || "—"}</span>
          {nomor ? <span className="fin-tg-nomor" title={nomor} data-testid="nomor-faktur-supplier">{nomor}</span> : <span className="fin-tg-nomor kosong" data-testid="nomor-faktur-kosong">Nomor faktur belum diisi</span>}
          <span className="fin-tg-bill" title="Nomor tagihan SANSS">{b.billNumber}</span>
        </span>
      </div>
      <div className="fin-tg-sel fin-tg-asal" role="cell" data-label="Asal">
        <span className="fin-tg-label-kecil">Asal</span>
        {asal.jenis === "PO" && <span className="fin-tg-asal-nomor" title="Faktur atas PO">{asal.nomor}</span>}
        {asal.jenis === "PENERIMAAN" && <><span className="fin-tg-asal-nomor" title="Tertaut ke satu penerimaan barang">{asal.nomor}</span><span className="fin-tg-sub">Penerimaan</span></>}
        {asal.jenis === "TANPA_PO" && <><span className="fin-tg-asal-nomor lembut">Tanpa PO</span>{asal.jenisTagihan && <span className="fin-tg-sub" title={asal.jenisTagihan}>{asal.jenisTagihan}</span>}</>}
      </div>
      <div className="fin-tg-sel fin-tg-tempo" role="cell" data-label="Jatuh tempo">
        <span className="fin-tg-label-kecil">Jatuh tempo</span>
        <span className={cn(tempo === "lewat" && "fin-tg-merah")}>{b.dueDate ? tanggalPendek(String(b.dueDate).slice(0, 10)) : "—"}</span>
      </div>
      <div className="fin-tg-sel fin-tg-angka" role="cell" data-label="Nilai"><span className="fin-tg-label-kecil">Nilai</span>{formatUangTepat(b.amount)}</div>
      <div className="fin-tg-sel fin-tg-angka" role="cell" data-label="Terbayar"><span className="fin-tg-label-kecil">Terbayar</span>{Number(b.terbayar) > 0 ? formatUangTepat(b.terbayar) : "—"}</div>
      <div className="fin-tg-sel fin-tg-angka fin-tg-sisa" role="cell" data-label="Sisa utang">
        <span className="fin-tg-label-kecil">Sisa utang</span>
        {sisa.tampil ? <strong title={sisaKurangSatuRupiah(b) ? KET_SISA_SEN : undefined}>{formatUangTepat(sisa.nilai)}</strong> : <span className="fin-tg-strip" title={sisa.alasan} aria-label={sisa.alasan}>—</span>}
        {umPO?.ada && <span className="fin-tg-um-chip" data-testid="chip-uang-muka" title={teksPeringatanUangMuka(umPO)}><IkKoin size={12} aria-hidden="true" />Uang muka {formatUangTepat(umPO.saldoPO)} belum diterapkan</span>}
      </div>
      <div className="fin-tg-sel fin-tg-st" role="cell" data-label="Status"><span className="fin-tg-label-kecil">Status</span><ChipStatusTagihan status={b.status} tempo={tempo} /></div>
      <div className="fin-tg-sel fin-tg-aksi" role="cell" data-tanpa-detail>
        <RowActions primary={a.primary} items={a.items} />
        <ChevronRight size={18} aria-hidden="true" className="fin-tg-buka" />
      </div>
    </div>
  );
}

export default function DaftarTagihan({
  bills, billsTampil, tab, onTab, q, onQ, fSup, onFSup, fTempo, onFTempo, onReset, aksi, onBuka, onCatat, hariIni, kelayakanUm,
}) {
  const hitung = useMemo(() => hitungTab(bills, hariIni), [bills, hariIni]);
  const namaSupplier = useMemo(() => [...new Set(bills.map((b) => b.supplier?.name).filter(Boolean))].sort(), [bills]);
  const adaFilter = !!q || !!fSup || !!fTempo || tab !== "semua";
  const ket = TAB_TAGIHAN.find((t) => t.key === tab)?.ket;
  const terpotong = bills.length >= BATAS_DAFTAR_TAGIHAN;
  return (
    <section className="fin-tg-panel" aria-label="Daftar tagihan supplier">
      <div className="fin-tg-alat">
        <div className="fin-tg-seg" role="tablist" aria-label="Status tagihan">
          {TAB_TAGIHAN.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="fin-tg-seg-item" data-aktif={tab === t.key ? "1" : "0"} onClick={() => onTab(t.key)} title={t.ket} data-testid={`tab-${t.key}`}>
              {t.label}<span className="fin-tg-seg-n">{hitung[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="fin-tg-cari">
          <label className="fin-tg-cari-kolom">
            <Search size={17} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="Cari supplier, nomor faktur, atau PO…" aria-label="Cari tagihan" data-testid="cari-tagihan" />
            {q && <button type="button" className="fin-tg-hapus-cari" onClick={() => onQ("")} aria-label="Hapus pencarian"><X size={15} aria-hidden="true" /></button>}
          </label>
          <div className="fin-tg-pilih"><SelectPO value={fSup} onChange={onFSup} ariaLabel="Supplier" opsi={[{ nilai: "", label: "Semua supplier" }, ...namaSupplier.map((n) => ({ nilai: n, label: n }))]} /></div>
          <div className="fin-tg-pilih"><SelectPO value={fTempo} onChange={onFTempo} ariaLabel="Jatuh tempo" opsi={[{ nilai: "", label: "Semua jatuh tempo" }, ...Object.entries(LABEL_TEMPO).map(([k, v]) => ({ nilai: k, label: v }))]} /></div>
        </div>
      </div>
      <p className="fin-tg-jumlah" role="status" aria-live="polite" data-testid="jumlah-tagihan">
        {billsTampil.length === bills.length ? `${bills.length} tagihan` : `${billsTampil.length} dari ${bills.length} tagihan`}
        {ket && <span className="fin-tg-jumlah-ket"> · {ket}</span>}
        {adaFilter && <button type="button" className="fin-tg-reset" onClick={onReset}>Atur ulang</button>}
      </p>

      {bills.length === 0 ? (
        <div className="fin-tg-kosong" data-testid="tagihan-kosong">
          <span className="fin-tg-kosong-ikon" aria-hidden="true"><IkKosong size={28} /></span>
          <p className="fin-tg-kosong-judul">Belum ada tagihan</p>
          <p className="fin-tg-kosong-ket">Catat tagihan yang datang dari supplier. Faktur atas PO dicocokkan per baris dengan PO.</p>
          <button type="button" className="fin-tg-tombol-utama" onClick={onCatat}>Catat tagihan</button>
        </div>
      ) : billsTampil.length === 0 ? (
        <div className="fin-tg-kosong" data-testid="tagihan-tak-cocok">
          <span className="fin-tg-kosong-ikon" aria-hidden="true"><IkKosong size={28} /></span>
          <p className="fin-tg-kosong-judul">Tidak ada tagihan yang cocok</p>
          <p className="fin-tg-kosong-ket">{tab !== "semua" && !q && !fSup && !fTempo ? "Tidak ada tagihan di kelompok ini. Lihat semua tagihan untuk memeriksa kelompok lain." : "Ubah kata kunci atau filter."}</p>
          <button type="button" className="fin-tg-tombol-sekunder" onClick={() => { onReset(); onTab("semua"); }}>Lihat semua tagihan</button>
        </div>
      ) : (
        <div className="fin-tg-tabel" role="table" aria-label="Tagihan supplier">
          <div className="fin-tg-judul-kolom" role="row">
            <span role="columnheader">Supplier / Faktur</span><span role="columnheader">Asal</span><span role="columnheader">Jatuh tempo</span>
            <span role="columnheader" className="kanan">Nilai</span><span role="columnheader" className="kanan">Terbayar</span><span role="columnheader" className="kanan">Sisa utang</span>
            <span role="columnheader">Status</span><span role="columnheader" className="fin-sr-saja">Tindakan</span>
          </div>
          {billsTampil.map((b) => <BarisTagihan key={b.id} b={b} hariIni={hariIni} aksi={aksi} onBuka={onBuka} kelayakanUm={kelayakanUm} />)}
        </div>
      )}
      {terpotong && <p className="fin-tg-batas" data-testid="batas-daftar">Server memuat paling banyak {BATAS_DAFTAR_TAGIHAN} tagihan (urut jatuh tempo), tanpa penanda terpotong. Daftar ini mungkin belum lengkap; angka Sisa utang di atas dan Jadwal & Aging dihitung langsung oleh server.</p>}
    </section>
  );
}
