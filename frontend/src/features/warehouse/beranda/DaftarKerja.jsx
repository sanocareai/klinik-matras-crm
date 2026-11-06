import React, { useId, useState } from "react";
import { IkDokumen, IkKeluar, IkTransfer, IkOpname, IkRestok, IkRusak, IkRetur, IkKoreksi, IkProduksi, IkTruk, IkBawah, IkAwas, IkCentang } from "@/components/gudangIcons.jsx";
import { gayaAksi, ringkasHambatan, LABEL_SEBAB_PENDEK } from "./berandaLogika.js";

// Daftar padat "Perlu dikerjakan": SATU dokumen = SATU baris. Kolom: Dokumen & supplier/unit · Tahap · Jadwal/masalah · Tindakan.
// Keterlambatan dan hambatan adalah penanda pada baris yang sama (bukan baris kedua di kelompok lain). Umur dokumen (sejak terakhir diubah) hanya di rincian baris dan BUKAN SLA.
// Baca-saja: tombol hanya MEMBUKA dokumen (jendela fokus) dengan aksi itu disorot; tidak ada transaksi yang dikirim dari sini. Tombol hanya ada bila server menyatakan pengguna berizin.
const IKON_JENIS = { penerimaan: IkDokumen, po: IkTruk, "pengeluaran-material": IkKeluar, transfer: IkTransfer, opname: IkOpname, restok: IkRestok, rusak: IkRusak, retur: IkRetur, "retur-supplier": IkRetur, koreksi: IkKoreksi, penyesuaian: IkKoreksi, bahan: IkProduksi };
const NADA_TAHAP = { PENERIMAAN_AKAN_DATANG: "biru", PENERIMAAN_PERIKSA: "kuning", PENERIMAAN_SIAP_STOK: "lavender" };
const LABEL_CAKUPAN = { DOKUMEN: "hanya dokumen ini", BAHAN: "bahan yang bersangkutan", FITUR: "satu fitur", PROSES: "seluruh proses" };

// Klik di area baris membuka dokumen; klik pada tombol/tautan di dalamnya tidak ikut memicu pembukaan.
function klikBaris(buka) {
  return { onClick: (e) => { if (!e.currentTarget.contains(e.target)) return; if (e.target.closest("button, a, input, select, summary, [data-tanpa-detail]")) return; buka(); } };
}

function Jadwal({ r }) {
  if (r.hambatan.length === 0) return <span className="gud-br-teks-jadwal" title={r.alasan}>{r.alasan}</span>;
  const tampil = r.hambatan.slice(0, 2); const lebih = r.hambatan.length - tampil.length;
  return (
    <>
      {tampil.map((h) => {
        const s = ringkasHambatan(h);
        return (
          <span key={h.sebab} className={`gud-br-hambatan${h.sebab === "JADWAL_LEWAT" ? " gud-br-hambatan-lewat" : ""}`} data-testid={`hambatan-${h.sebab}`} title={h.teks}>
            {h.sebab === "JADWAL_LEWAT"
              ? <><span className="gud-br-hambatan-judul">{s.judul}</span><span className="gud-br-hambatan-ket gud-br-merah">{s.ket}</span></>
              : <><span className="gud-br-hambatan-judul"><IkAwas size={15} aria-hidden="true" /> {s.judul}</span>{s.ket && s.ket !== s.judul && <span className="gud-br-hambatan-ket">{s.ket}</span>}</>}
          </span>
        );
      })}
      {lebih > 0 && <span className="gud-br-lagi">+{lebih} penanda lain</span>}
    </>
  );
}

function Rincian({ r, id, onBuka }) {
  return (
    <div id={id} className="gud-br-rincian" data-tanpa-detail data-testid="rincian-baris">
      <dl className="gud-br-dl">
        <div><dt>Alasan muncul</dt><dd>{r.alasan}</dd></div>
        <div><dt>Yang bertindak</dt><dd>{r.pemilikLabel}{r.sesudahnya ? ` · sesudahnya ${r.sesudahnya}` : ""}</dd></div>
        <div><dt>Terakhir diubah</dt><dd>{r.umurTeks}<span className="gud-br-sekunder"> — umur dokumen sejak perubahan terakhir, bukan batas waktu layanan (SLA)</span></dd></div>
        {r.jumlahItem != null && <div><dt>Jumlah item</dt><dd>{r.jumlahItem}</dd></div>}
        {r.hambatan.length > 0 && (
          <div className="gud-br-dl-lebar"><dt>Hambatan</dt>
            <dd><ul className="gud-br-daftar-hambatan">{r.hambatan.map((h) => (
              <li key={h.sebab}><strong>{LABEL_SEBAB_PENDEK[h.sebab] ?? h.sebab}.</strong> {h.teks}{h.cakupan ? <span className="gud-br-sekunder"> ({LABEL_CAKUPAN[h.cakupan] ?? h.cakupan})</span> : null}</li>
            ))}</ul></dd>
          </div>
        )}
        {r.terblokirSimpan && <div className="gud-br-dl-lebar"><dt>Tindakan</dt><dd>Aksi bawaan “Simpan ke stok” tidak ditawarkan di sini karena sistem akan menolaknya. Buka pemeriksaan untuk melengkapi jumlah baik; status dokumen tidak berubah.</dd></div>}
      </dl>
      <button type="button" className="gud-tombol" onClick={() => onBuka(r, null)} data-testid="buka-dokumen-rincian">Buka dokumen</button>
    </div>
  );
}

function Baris({ r, onBuka }) {
  const [buka, setBuka] = useState(false); const id = useId();
  const Ikon = IKON_JENIS[r.jenis] ?? IkDokumen;
  const menungguLain = !r.aksi && r.pemilikLabel && r.pemilikLabel !== "Gudang";
  return (
    <li className="gud-br-baris" data-testid="baris-kerja" data-jenis={r.jenis} data-nomor={r.nomor} data-terblokir={String(r.terblokirSimpan)} data-lewat={String(!!r.lewat)} {...klikBaris(() => onBuka(r, null))}>
      <div className="gud-br-dok">
        <span className="gud-br-ikon" aria-hidden="true"><Ikon size={20} /></span>
        <div className="gud-br-dok-teks">
          <button type="button" className="gud-br-nomor" onClick={() => onBuka(r, null)} data-testid="buka-pekerjaan" aria-label={`Buka ${r.jenisLabel} ${r.nomor}`}>{r.nomor}</button>
          {r.terkait && <span className="gud-br-terkait" title={r.terkait}>{r.terkait}</span>}
          <span className="gud-br-jenis">{r.jenisLabel}</span>
        </div>
      </div>
      <div className="gud-br-tahap"><span className="gud-br-label-kecil">Tahap</span><span className={`gud-br-pil gud-br-pil-${NADA_TAHAP[r.antreanKode] ?? "netral"}`} data-testid="status-pekerjaan">{r.status}</span></div>
      <div className="gud-br-jadwal"><span className="gud-br-label-kecil">Jadwal / masalah</span><Jadwal r={r} /></div>
      <div className="gud-br-aksi" data-tanpa-detail>
        {r.aksi
          ? <button type="button" className={`gud-br-tombol gud-br-tombol-${gayaAksi(r.aksi.kode)}`} onClick={() => onBuka(r, r.aksi.kode)} data-testid="aksi-kartu" data-kode={r.aksi.kode} title={r.terblokirSimpan ? "Simpan ke stok akan ditolak karena tidak ada jumlah baik; lengkapi pemeriksaan dulu." : undefined}>{r.aksi.label}</button>
          : <button type="button" className="gud-br-tombol gud-br-tombol-garis" onClick={() => onBuka(r, null)} data-testid="buka-tanpa-aksi">Buka dokumen</button>}
        <button type="button" className="gud-br-chevron" aria-expanded={buka} aria-controls={buka ? id : undefined} aria-label={`${buka ? "Tutup" : "Buka"} rincian ${r.nomor}`} onClick={() => setBuka((v) => !v)} data-testid="rincian-toggle"><IkBawah size={18} /></button>
        {menungguLain && <span className="gud-br-menunggu">Menunggu {r.pemilikLabel}</span>}
      </div>
      {buka && <Rincian r={r} id={id} onBuka={onBuka} />}
    </li>
  );
}

/** Daftar baris. `tampil` = jumlah baris yang ditampilkan sekarang; sisanya lewat "Tampilkan lebih banyak" (hanya memperlihatkan baris yang sudah dimuat; bukan pemuatan server). */
export default function DaftarKerja({ baris, onBuka, tampil, onLagi, kosongTeks, kosongAksi }) {
  if (baris.length === 0) {
    return (
      <div className="gud-br-kosong" data-testid="daftar-kosong">
        <span className="gud-br-kosong-ikon" aria-hidden="true"><IkCentang size={22} /></span>
        <p className="gud-br-kosong-judul">{kosongTeks}</p>
        {kosongAksi}
      </div>
    );
  }
  const lihat = baris.slice(0, tampil);
  return (
    <div className="gud-br-daftar">
      <div className="gud-br-kepala" aria-hidden="true"><span>Dokumen &amp; supplier / unit</span><span>Tahap</span><span>Jadwal / masalah</span><span>Tindakan</span></div>
      <ul className="gud-br-baris-daftar" aria-label="Daftar pekerjaan Gudang" data-testid="daftar-kerja">{lihat.map((r) => <Baris key={r.kunci} r={r} onBuka={onBuka} />)}</ul>
      {baris.length > lihat.length && <button type="button" className="gud-tombol gud-br-lagi-tombol" onClick={onLagi} data-testid="tampilkan-lagi">Tampilkan lebih banyak ({baris.length - lihat.length} lagi)</button>}
    </div>
  );
}
