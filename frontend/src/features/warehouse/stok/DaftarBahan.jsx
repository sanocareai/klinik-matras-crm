import React from "react";
import { cn } from "@/lib/utils.js";
import { IkKotak, IkPanah } from "@/components/gudangIcons.jsx";
import IkonBahan from "./IkonBahan.jsx";
import { statusRingkas, teksTersedia, hargaBaris } from "./stokTampilanLogic.js";
import { tampilSaldo } from "./stokLogic.js";

// DAFTAR BAHAN (redesain Gudang, 3 Nov 2026) — kolom utama: Bahan & kode · Saldo tercatat · Tersedia · Satuan · Kondisi · Rincian (+ Harga / satuan bila berizin Finance).
// Satu elemen <button> per baris (keyboard dan sentuhan; tinggi ≥ 44px). Susunan menyesuaikan LEBAR DAFTAR (container query), bukan lebar layar: dengan panel kanan terbuka, kolom Harga disembunyikan
// (tetap ada di tab Harga) dan di bawah ±600px berubah menjadi kartu. Angka dari baris server; "belum diketahui" = belum ada catatan stok (BUKAN 0); harga belum ada = "Belum ada harga berlaku" (BUKAN Rp0).
// Satuan SELALU ditampilkan di kolomnya sendiri — kuantitas bahan berbeda satuan tidak pernah dijumlahkan.
const POLA = { green: "hijau", orange: "kuning", red: "merah", neutral: "netral" };

function Baris({ r, peta, dipilih, onPilih }) {
  const st = statusRingkas(r); const t = teksTersedia(r); const sd = tampilSaldo(r); const h = hargaBaris(peta, r.materialId); const satuan = String(r.satuan ?? "").toLowerCase();
  const tercatat = sd.jenis === "BELUM_DIKETAHUI" ? null : sd.teks;
  return (
    <li>
      <button type="button" onClick={() => onPilih(r)} aria-label={`Buka rincian ${r.nama}`} data-testid="baris-stok" data-kode={r.kode} data-status={st.kode} aria-current={dipilih ? "true" : undefined}
        title={r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok untuk bahan ini"} className="gud-stok-baris max-sm:min-h-11" data-harga={peta ? "ya" : "tidak"}>
        <IkonBahan kode={r.kelompok?.kode} className="gud-stok-ikon" />
        <span className="gud-stok-nama">
          <span className="gud-stok-judul" data-testid="nama-bahan">{r.nama}</span>
          <span className="gud-stok-kode" data-testid="kode-bahan">{r.kode}</span>
        </span>
        <span className="gud-stok-sel gud-stok-saldo" data-label="Saldo tercatat" data-testid="sel-saldo" data-jenis={sd.jenis} title={sd.keterangan}>
          {tercatat === null ? <em>belum diketahui</em> : <span className={cn("gud-angka", Number(r.saldo) < 0 && "gud-minus")} data-testid="saldo-angka">{tercatat}</span>}
        </span>
        <span className="gud-stok-sel gud-stok-tersedia" data-label="Tersedia">
          {t.angka === null ? <em>belum diketahui</em> : <span className={cn("gud-angka", t.minus && "gud-minus")} data-testid="tersedia-angka">{t.teks}</span>}
        </span>
        <span className="gud-stok-sel gud-stok-satuan" data-label="Satuan" data-testid="sel-satuan">{satuan || "—"}</span>
        {peta && (
          <span className="gud-stok-sel gud-stok-harga" data-label="Harga / satuan" data-testid="sel-harga">
            {h?.ada
              ? <span data-testid="harga-daftar" data-ada="1" title={`${h.label} — HPP operasional per satuan stok, bukan nilai persediaan Finance`}><span className="gud-angka">Rp{Number(h.harga).toLocaleString("id-ID", { maximumFractionDigits: 4 })}</span></span>
              : <em data-testid="harga-daftar" data-ada="0">{h?.teks ?? "Belum ada harga berlaku"}</em>}
          </span>
        )}
        <span className="gud-stok-sel gud-stok-kondisi" data-label="Kondisi">
          <span className="gud-pill gud-pill-titik" data-warna={st.nada === "neutral" ? "neutral" : st.nada === "green" ? "green" : st.nada === "red" ? "red" : "orange"} data-pola={POLA[st.nada]} data-testid="status-baris">{st.teks}</span>
        </span>
        <IkPanah size={16} aria-hidden className="gud-stok-panah" />
      </button>
    </li>
  );
}

function Rangka() {
  return <>{Array.from({ length: 6 }, (_, i) => <li key={i} className="gud-rangka" aria-hidden><span style={{ display: "block", height: 60, borderRadius: 12 }} /></li>)}</>;
}

export default function DaftarBahan({ halaman, loading, peta, dipilihId, onPilih, onHalaman, kosong, tampilBantuan = null }) {
  const adaHarga = !!peta;
  return (
    <section aria-label="Daftar bahan" className="gud-stok-daftar" data-testid="daftar-bahan">
      <div className="gud-stok-kepala" aria-hidden data-testid="kepala-kolom" data-harga={adaHarga ? "ya" : "tidak"}>
        <span className="gud-stok-k-bahan">Bahan &amp; kode</span><span className="gud-stok-k-saldo">Saldo tercatat</span><span className="gud-stok-k-tersedia">Tersedia</span><span className="gud-stok-k-satuan">Satuan</span>
        {adaHarga && <span className="gud-stok-k-harga">Harga / satuan</span>}<span className="gud-stok-k-kondisi">Kondisi</span><span className="gud-stok-k-rincian">Rincian</span>
      </div>
      {kosong ? (
        <div className="gud-kosong" data-testid="daftar-kosong">
          <IkKotak size={28} aria-hidden />
          <h2>{kosong.judul}</h2>
          <p>{kosong.deskripsi}</p>
          {tampilBantuan}
        </div>
      ) : (
        <ul className="gud-stok-ul">
          {loading ? <Rangka /> : halaman.baris.map((r) => <Baris key={r.materialId} r={r} peta={peta} dipilih={dipilihId === r.materialId} onPilih={onPilih} />)}
        </ul>
      )}
      {!kosong && !loading && (
        <nav aria-label="Halaman daftar" className="gud-stok-halaman" data-testid="halaman-daftar">
          <span data-testid="rentang-tampil">Menampilkan {halaman.dari}–{halaman.sampai} dari {halaman.total} bahan</span>
          {halaman.jumlahHalaman > 1 && (
            <span className="gud-stok-halaman-kontrol">
              <button type="button" onClick={() => onHalaman(halaman.halaman - 1)} disabled={halaman.halaman <= 1} aria-label="Halaman sebelumnya" data-testid="halaman-sebelumnya" className="gud-tombol-ikon"><IkPanah size={18} style={{ transform: "rotate(180deg)" }} /></button>
              <span className="gud-angka" aria-live="polite">{halaman.halaman} / {halaman.jumlahHalaman}</span>
              <button type="button" onClick={() => onHalaman(halaman.halaman + 1)} disabled={halaman.halaman >= halaman.jumlahHalaman} aria-label="Halaman berikutnya" data-testid="halaman-berikutnya" className="gud-tombol-ikon"><IkPanah size={18} /></button>
            </span>
          )}
        </nav>
      )}
    </section>
  );
}
