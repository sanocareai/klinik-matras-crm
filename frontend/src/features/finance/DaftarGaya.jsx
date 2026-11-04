import React from "react";
import { Search, X, ChevronRight } from "@/components/ikApple.jsx";
import { UbinApple, Glif } from "@/components/ikApple.jsx";
import "@/styles/sanss-finance-tagihan.css"; // panel/alat/pil `.fin-tg-*` dipakai bersama; tanpa ini halaman yang dibuka langsung (mis. Pembelian) tampil tanpa gaya
import "@/styles/sanss-finance-daftar.css";

// KIT TAMPILAN BERSAMA "Pembelian & Supplier": kartu KPI warna-warni (bukan datar), segmen status, kolom cari, chip status, dan keadaan kosong.
// Hanya presentasi — angka/aturan tetap dari halaman pemanggil (server). Kelas fin-tg-* (panel, segmen, chip, cari) dipakai ulang dari gaya Tagihan supplier.

const WARNA = ["biru", "hijau", "jingga", "merah", "merahmuda", "ungu", "indigo", "tosca", "grafit"];

/** Kartu KPI berwarna: gradien lembut + kilau kaca + ubin ikon Apple + hiasan glif besar samar. `warna` menentukan nuansa; `onClick` menjadikannya tombol. */
export function KartuKpiApple({ ikon, warna = "biru", label, nilai, ket, chip, onClick, testid, kecil = false }) {
  const w = WARNA.includes(warna) ? warna : "biru";
  const isi = (
    <>
      <span className="fin-kw-hiasan" aria-hidden="true"><Glif nama={ikon} size={92} strokeWidth={1.2} /></span>
      <UbinApple nama={ikon} ukuran={kecil ? 40 : 48} nada={w === "merah" ? "merah" : w === "tosca" ? "indigo" : w} />
      <span className="fin-kw-teks">
        <span className="fin-kw-label">{label}</span>
        <span className="fin-kw-nilai">{nilai}{chip && <span className="fin-kw-chip">{chip}</span>}</span>
        {ket && <span className="fin-kw-ket">{ket}</span>}
      </span>
      {onClick && <ChevronRight size={18} className="fin-kw-panah" />}
    </>
  );
  return onClick
    ? <button type="button" className="fin-kw" data-warna={w} data-kecil={kecil ? "1" : undefined} onClick={onClick} data-testid={testid}>{isi}</button>
    : <div className="fin-kw" data-warna={w} data-kecil={kecil ? "1" : undefined} data-testid={testid}>{isi}</div>;
}

/** Segmen status (satu pilihan aktif). `item`: [{ kunci, label, jumlah? }]. */
export function SegStatus({ item, nilai, onPilih, label, testidAwalan = "tab" }) {
  return (
    <div className="fin-tg-seg fin-dl-seg" role="tablist" aria-label={label}>
      {item.map((t) => (
        <button key={t.kunci || "semua"} type="button" role="tab" aria-selected={nilai === t.kunci} className="fin-tg-seg-item" data-aktif={nilai === t.kunci ? "1" : "0"} onClick={() => onPilih(t.kunci)} title={t.ket} data-testid={`${testidAwalan}-${t.kunci || "semua"}`}>
          {t.label}{t.jumlah != null && <span className="fin-tg-seg-n">{t.jumlah}</span>}
        </button>
      ))}
    </div>
  );
}

/** Kolom cari bergaya Apple (ikon kaca, tombol hapus). */
export function KolomCari({ nilai, onUbah, placeholder, ariaLabel, testid }) {
  return (
    <label className="fin-tg-cari-kolom">
      <Search size={17} aria-hidden="true" />
      <input type="search" value={nilai} onChange={(e) => onUbah(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} data-testid={testid} />
      {nilai && <button type="button" className="fin-tg-hapus-cari" onClick={() => onUbah("")} aria-label="Hapus pencarian"><X size={15} aria-hidden="true" /></button>}
    </label>
  );
}

/** Chip status bernuansa (hijau | jingga | biru | merah | netral) dengan titik. */
export function ChipNada({ nada = "netral", children, sub, subLewat = false }) {
  return (
    <span className="fin-tg-status">
      <span className="fin-tg-chip" data-nada={nada}><span className="fin-tg-titik" aria-hidden="true" />{children}</span>
      {sub && <span className={subLewat ? "fin-tg-sub lewat" : "fin-tg-sub"}>{sub}</span>}
    </span>
  );
}

/** Keadaan kosong berubin. */
export function KosongDaftar({ ikon = "kosong", judul, ket, aksi, testid }) {
  return (
    <div className="fin-tg-kosong" data-testid={testid}>
      <UbinApple nama={ikon} ukuran={64} />
      <p className="fin-tg-kosong-judul">{judul}</p>
      {ket && <p className="fin-tg-kosong-ket">{ket}</p>}
      {aksi}
    </div>
  );
}
