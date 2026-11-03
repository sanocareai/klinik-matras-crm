import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils.js";
import { IkCentang, IkKotak, IkPanah, IkSalin } from "@/components/gudangIcons.jsx";
import { statusRingkas, teksTersedia } from "./stokTampilanLogic.js";
import { tampilSaldo } from "./stokLogic.js";

// DAFTAR BAHAN (redesain Gudang, 3 Nov 2026; disusun ulang tahap 2) — kolom: Bahan & kode · Saldo tercatat · Tersedia · Kondisi · Rincian. Harga TIDAK jadi kolom (ada di tab Harga ruang kerja bahan).
// Setiap baris = satu area yang bisa diklik (tombol berisi nama bahan diperluas ke seluruh baris; tombol "Salin kode" berdiri sendiri di atasnya — tidak ada tombol di dalam tombol).
// Susunan mengikuti LEBAR DAFTAR (container query), bukan lebar layar: dengan ruang kerja terbuka daftar tetap tabel; di bawah ±560px menjadi kartu.
// Angka dari baris server: "Saldo tercatat" = saldo buku pergerakan; "Tersedia" = saldo dikurangi yang sudah dipesan (angka server). "belum diketahui" = belum ada catatan stok (BUKAN 0).
// Satuan SELALU menempel pada angkanya — kuantitas bahan berbeda satuan tidak pernah dijumlahkan. Hanya kondisi yang perlu perhatian yang diberi lencana berwarna; kondisi normal berupa teks biasa.
const PERHATIAN = new Set(["MINUS", "BELUM_DIKETAHUI", "MENIPIS", "TERPESAN_PENUH"]);

function SalinKode({ kode }) {
  const [ok, setOk] = useState(false); const waktu = useRef(null);
  const salin = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(kode); }
    catch { const t = document.createElement("textarea"); t.value = kode; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } finally { document.body.removeChild(t); } }
    setOk(true); clearTimeout(waktu.current); waktu.current = setTimeout(() => setOk(false), 1600);
  };
  return (
    <button type="button" onClick={salin} className="gud-salin" aria-label={ok ? `Kode ${kode} tersalin` : `Salin kode ${kode}`} title={ok ? "Tersalin" : "Salin kode"} data-testid="salin-kode" data-ok={ok ? "ya" : undefined}>
      {ok ? <IkCentang size={14} /> : <IkSalin size={14} />}
    </button>
  );
}

function Baris({ r, dipilih, onPilih }) {
  const st = statusRingkas(r); const t = teksTersedia(r); const sd = tampilSaldo(r); const satuan = String(r.satuan ?? "").toLowerCase();
  const tercatat = sd.jenis === "BELUM_DIKETAHUI" ? null : sd.teks;
  return (
    <li>
      <div className="gud-stok-baris" data-testid="baris-stok" data-kode={r.kode} data-status={st.kode} data-aktif={dipilih ? "ya" : undefined} aria-current={dipilih ? "true" : undefined}
        title={r.sumberAngka?.teks ?? "Belum ada catatan pergerakan stok untuk bahan ini"}>
        <span className="gud-stok-nama">
          <button type="button" onClick={() => onPilih(r)} className="gud-stok-buka max-sm:min-h-11" aria-label={`Buka rincian ${r.nama}`}>
            <span className="gud-stok-judul" data-testid="nama-bahan">{r.nama}</span>
          </button>
          <span className="gud-stok-kodebaris"><span className="gud-stok-kode" data-testid="kode-bahan">{r.kode}</span><SalinKode kode={r.kode} /></span>
        </span>
        <span className="gud-stok-sel gud-stok-saldo" data-label="Saldo tercatat" data-testid="sel-saldo" data-jenis={sd.jenis} title={sd.keterangan}>
          {tercatat === null ? <em>belum diketahui</em> : <><span className={cn("gud-angka", Number(r.saldo) < 0 && "gud-minus")} data-testid="saldo-angka">{tercatat}</span> <span className="gud-stok-satuan" data-testid="sel-satuan">{satuan || "—"}</span></>}
        </span>
        <span className="gud-stok-sel gud-stok-tersedia" data-label="Tersedia">
          {t.angka === null ? <em>belum diketahui</em> : <><span className={cn("gud-angka", t.minus && "gud-minus")} data-testid="tersedia-angka">{t.teks}</span> <span className="gud-stok-satuan">{satuan || "—"}</span></>}
        </span>
        <span className="gud-stok-sel gud-stok-kondisi" data-label="Kondisi">
          {PERHATIAN.has(st.kode)
            ? <span className="gud-pill gud-pill-titik" data-warna={st.nada === "red" ? "red" : st.nada === "orange" ? "orange" : "neutral"} data-testid="status-baris">{st.teks}</span>
            : <span className="gud-kondisi-biasa" data-nada={st.nada} data-testid="status-baris">{st.teks}</span>}
        </span>
        <span className="gud-stok-rincian-sel" aria-hidden><span className="gud-stok-rincian-teks">Rincian</span><IkPanah size={16} className="gud-stok-panah" /></span>
      </div>
    </li>
  );
}

function Rangka() {
  return <>{Array.from({ length: 6 }, (_, i) => <li key={i} className="gud-rangka" aria-hidden><span style={{ display: "block", height: 56, borderRadius: 12 }} /></li>)}</>;
}

export default function DaftarBahan({ halaman, loading, dipilihId, onPilih, onHalaman, kosong, tampilBantuan = null }) {
  return (
    <section aria-label="Daftar bahan" className="gud-stok-daftar" data-testid="daftar-bahan">
      <div className="gud-stok-kepala" aria-hidden data-testid="kepala-kolom">
        <span className="gud-stok-k-bahan">Bahan &amp; kode</span><span className="gud-stok-k-saldo">Saldo tercatat</span><span className="gud-stok-k-tersedia">Tersedia</span><span className="gud-stok-k-kondisi">Kondisi</span><span className="gud-stok-k-rincian">Rincian</span>
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
          {loading ? <Rangka /> : halaman.baris.map((r) => <Baris key={r.materialId} r={r} dipilih={dipilihId === r.materialId} onPilih={onPilih} />)}
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
