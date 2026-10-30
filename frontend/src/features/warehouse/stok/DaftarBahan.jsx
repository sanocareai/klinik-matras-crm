import React from "react";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { cn } from "@/lib/utils.js";
import IkonBahan from "./IkonBahan.jsx";
import { statusRingkas, teksTersedia, hargaBaris } from "./stokTampilanLogic.js";
import { tampilSaldo } from "./stokLogic.js";

// DAFTAR BAHAN — satu susunan untuk desktop dan HP (tombol per baris: bisa dibuka dengan keyboard dan sentuhan; tinggi baris ≥ 44px).
// Per baris: ikon kelompok, nama + kode, Tersedia + satuan, harga per satuan (hanya bila berizin), SATU status singkat. Kelompok, batas minimum, dan riwayat penerimaan ada di drawer.
// "belum diketahui" = belum ada catatan stok (BUKAN 0); harga "Belum ada harga berlaku" (BUKAN Rp0).
const NADA = { green: "bg-greenbg text-green", orange: "bg-orangebg text-orange", red: "bg-redbg text-red", neutral: "bg-inset stok-t2" };
const TITIK = { green: "bg-green", orange: "bg-orange", red: "bg-red", neutral: "bg-ink3" };

// Penempatan kolom (kelas literal supaya terbaca Tailwind). Mobile: ikon | nama + status | tersedia + harga. Desktop: ikon | nama | tersedia | harga | status | panah.
const GRID = {
  ya: "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:grid-cols-[2.75rem_minmax(0,2.4fr)_minmax(6rem,1fr)_minmax(8rem,1.2fr)_minmax(9rem,1.3fr)_1rem] md:gap-x-4",
  tidak: "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:grid-cols-[2.75rem_minmax(0,2.4fr)_minmax(6rem,1fr)_minmax(9rem,1.3fr)_1rem] md:gap-x-4",
};
const POS = {
  ya: { status: "md:col-start-5", panah: "md:col-start-6" },
  tidak: { status: "md:col-start-4", panah: "md:col-start-5" },
};

function KepalaKolom({ adaHarga }) {
  const k = adaHarga ? "ya" : "tidak";
  return (
    <div className={cn("px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide stok-t2 max-md:hidden", GRID[k])} aria-hidden data-testid="kepala-kolom">
      <span className="md:col-span-2 md:col-start-1">Bahan</span>
      <span className="md:col-start-3">Tersedia</span>
      {adaHarga && <span className="md:col-start-4">Harga / satuan</span>}
      <span className={POS[k].status}>Status</span>
    </div>
  );
}

function Baris({ r, peta, dipilih, onPilih }) {
  const adaHarga = !!peta; const k = adaHarga ? "ya" : "tidak";
  const st = statusRingkas(r); const t = teksTersedia(r); const h = hargaBaris(peta, r.materialId); const satuan = String(r.satuan ?? "").toLowerCase();
  return (
    <li>
      <button type="button" onClick={() => onPilih(r)} aria-label={`Buka detail ${r.nama}`} data-testid="baris-stok" data-kode={r.kode} data-status={st.kode} aria-current={dipilih ? "true" : undefined}
        title={r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok untuk bahan ini"}
        className={cn("w-full items-center px-4 py-3 text-left outline-none transition-colors hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 max-sm:min-h-11", GRID[k], dipilih && "bg-accentbg shadow-[inset_3px_0_0_var(--accent)]")}>
        <IkonBahan kode={r.kelompok?.kode} fotoUrl={r.fotoThumbUrl} className="row-span-2 row-start-1 md:row-span-1 md:col-start-1" />
        <span className="col-start-2 row-start-1 min-w-0 md:col-start-2">
          <span className="block truncate text-[14px] font-semibold text-ink" data-testid="nama-bahan">{r.nama}</span>
          <span className="block truncate text-[12px] stok-t2 [overflow-wrap:anywhere]" data-testid="kode-bahan">{r.kode}</span>
        </span>
        <span className="col-start-3 row-start-1 text-right md:col-start-3 md:text-left" data-testid="sel-saldo" data-jenis={tampilSaldo(r).jenis} title={tampilSaldo(r).keterangan}>
          {t.angka === null
            ? <span className="text-[12.5px] font-medium italic stok-t2">{t.teks}</span>
            : <span className={cn("text-[15px] font-bold tabular-nums", t.minus ? "text-red" : "text-ink")} data-testid="tersedia-angka">{t.teks}<span className="ml-1 text-[12px] font-medium stok-t2">{satuan}</span></span>}
        </span>
        {adaHarga && (
          <span className="col-start-3 row-start-2 text-right text-[12.5px] md:col-start-4 md:row-start-1 md:text-left" data-testid="sel-harga">
            {h?.ada
              ? <span data-testid="harga-daftar" data-ada="1" title={`${h.label} — HPP operasional per satuan stok, bukan nilai persediaan Finance`}><span className="font-semibold tabular-nums text-ink">Rp{Number(h.harga).toLocaleString("id-ID", { maximumFractionDigits: 4 })}</span><span className="stok-t2"> / {h.satuan}</span></span>
              : <span className="italic stok-t2" data-testid="harga-daftar" data-ada="0">{h?.teks ?? "Belum ada harga berlaku"}</span>}
          </span>
        )}
        <span className={cn("col-start-2 row-start-2 md:row-start-1", POS[k].status)}>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", NADA[st.nada])} data-testid="status-baris"><span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TITIK[st.nada])} />{st.teks}</span>
        </span>
        <ChevronRight size={16} aria-hidden className={cn("hidden stok-t2 md:block md:row-start-1", POS[k].panah)} />
      </button>
    </li>
  );
}

function Rangka({ adaHarga }) {
  const k = adaHarga ? "ya" : "tidak";
  return <>{Array.from({ length: 6 }, (_, i) => (
    <li key={i} className={cn("items-center px-4 py-3", GRID[k])} aria-hidden>
      <span className="row-span-2 h-11 w-11 animate-pulse rounded-xl bg-inset md:row-span-1" />
      <span className="col-start-2 space-y-1.5"><span className="block h-3.5 w-40 max-w-full animate-pulse rounded bg-inset" /><span className="block h-3 w-24 animate-pulse rounded bg-inset" /></span>
    </li>
  ))}</>;
}

export default function DaftarBahan({ halaman, loading, peta, dipilihId, onPilih, onHalaman, kosong, tampilBantuan = null }) {
  const adaHarga = !!peta;
  return (
    <section aria-label="Daftar bahan" className="overflow-hidden rounded-card bg-surface shadow-card" data-testid="daftar-bahan">
      <KepalaKolom adaHarga={adaHarga} />
      {kosong ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" data-testid="daftar-kosong">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-inset stok-t2"><Package size={22} aria-hidden /></span>
          <p className="m-0 text-[14px] font-semibold text-ink">{kosong.judul}</p>
          <p className="m-0 max-w-sm text-[12.5px] stok-t2">{kosong.deskripsi}</p>
          {tampilBantuan}
        </div>
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0 md:border-t md:border-line">
          {loading ? <Rangka adaHarga={adaHarga} /> : halaman.baris.map((r) => <Baris key={r.materialId} r={r} peta={peta} dipilih={dipilihId === r.materialId} onPilih={onPilih} />)}
        </ul>
      )}
      {!kosong && !loading && (
        <nav aria-label="Halaman daftar" className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5" data-testid="halaman-daftar">
          <span className="text-[12px] stok-t2" data-testid="rentang-tampil">Menampilkan {halaman.dari}–{halaman.sampai} dari {halaman.total} bahan</span>
          {halaman.jumlahHalaman > 1 && (
            <span className="flex items-center gap-1.5">
              <button type="button" onClick={() => onHalaman(halaman.halaman - 1)} disabled={halaman.halaman <= 1} aria-label="Halaman sebelumnya" data-testid="halaman-sebelumnya" className="flex h-11 w-11 items-center justify-center rounded-xl stok-t2 hover:bg-hovertint disabled:opacity-40 sm:h-9 sm:w-9"><ChevronLeft size={16} aria-hidden /></button>
              <span className="min-w-[4.5rem] text-center text-[12.5px] font-semibold tabular-nums text-ink" aria-live="polite">{halaman.halaman} / {halaman.jumlahHalaman}</span>
              <button type="button" onClick={() => onHalaman(halaman.halaman + 1)} disabled={halaman.halaman >= halaman.jumlahHalaman} aria-label="Halaman berikutnya" data-testid="halaman-berikutnya" className="flex h-11 w-11 items-center justify-center rounded-xl stok-t2 hover:bg-hovertint disabled:opacity-40 sm:h-9 sm:w-9"><ChevronRight size={16} aria-hidden /></button>
            </span>
          )}
        </nav>
      )}
    </section>
  );
}
