import React, { useMemo, useState } from "react";
import { IkAwas, IkCari } from "@/components/gudangIcons.jsx";
import { catatanBaris, kodeSekunder, progresItemPO, teksAngka } from "./penerimaanLogic.js";

// RINCIAN PER ITEM (redesain Penerimaan, 4 Nov 2026) — baca-saja. Tata letak mengikuti LEBAR KONTAINER panel (container query `gud-pi`), bukan lebar layar: nama bahan SATU baris penuh di atas (membungkus wajar),
// kode hanya bila tidak sekadar mengulang nama, lalu dua grid berlabel yang turun baris sendiri bila sempit:
//   • "Dokumen ini": Dijadwalkan · Tiba · Baik · Ditolak · Masuk stok (jumlah pada penerimaan yang dibuka; "—" = belum diisi, bukan nol);
//   • "PO … (semua penerimaan)": Dipesan · Sudah datang · Belum datang · Baik belum disimpan · Sudah masuk stok (+ Menunggu pengganti / Ditolak bila ada) — angka & definisi dari server (progresPO.js), per satuan.
// Pengisian jumlah (tiba / baik / ditolak) TIDAK di sini: dialog Pemeriksaan (DialogPemeriksaan.jsx). Panel ini hanya untuk membaca.
const SEL_DOKUMEN = [["dijadwalkan", "Dijadwalkan"], ["tiba", "Tiba"], ["baik", "Baik"], ["ditolak", "Ditolak"], ["masukStok", "Masuk stok"]];

// Definisi = teks server (services/finance/progresPO.js DEFINISI_PROGRES), dipakai verbatim agar semua layar sepakat tentang arti angka. Satuan: satuan beli PO bila ada.
const LEGENDA = [
  ["Dipesan", "Jumlah yang dipesan di PO."],
  ["Sudah datang", "Total yang tiba pada pengiriman asli (bukan pengganti), termasuk yang kemudian ditolak. Inilah yang dihitung terhadap jumlah dipesan."],
  ["Belum datang", "Dipesan dikurangi datang pada pengiriman asli. Barang ditolak tetap dihitung sudah datang; pengiriman pengganti tidak mengurangi angka ini dan tidak menaikkan batas PO."],
  ["Baik belum disimpan", "Jumlah baik dikurangi masuk stok: lolos pemeriksaan, tetapi Simpan ke Stok belum ditekan."],
  ["Sudah masuk stok", "Barang baik yang sudah disimpan ke stok. Hanya ini yang menambah stok."],
  ["Menunggu pengganti", "Jumlah ditolak yang belum diganti supplier."],
];

function Sel({ label, nilai, satuan, aksen, testid }) {
  return <div className="gud-pi-sel" data-testid={testid}><dt>{label}</dt><dd className={aksen}>{teksAngka(nilai)}{nilai !== null && nilai !== undefined && satuan ? <span className="gud-pi-satuan-kecil"> {satuan}</span> : null}</dd></div>;
}

export default function TabelPerItem({ rows: semua, nomorPO = null, className }) {
  const [cari, setCari] = useState(""); const banyak = semua.length > 8;
  const rows = useMemo(() => { const k = cari.trim().toLowerCase(); return !banyak || !k ? semua : semua.filter((b) => `${b.kode} ${b.nama}`.toLowerCase().includes(k)); }, [semua, cari, banyak]);
  const adaCatatan = banyak ? semua.filter((b) => catatanBaris(b).length > 0).length : 0;
  return (
    <div className={className} data-testid="tabel-per-item">
      {banyak && (
        <div className="gud-pi-alat" data-testid="ringkas-item">
          <span className="gud-petunjuk m-0"><strong>{semua.length}</strong> item{adaCatatan > 0 && <> · <strong>{adaCatatan}</strong> perlu dicek</>}{cari && <> · {rows.length} cocok</>}</span>
          <div className="gud-cari"><IkCari size={16} aria-hidden /><input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari item di dokumen ini" aria-label="Cari item di dokumen ini" data-testid="cari-item" /></div>
        </div>
      )}
      {banyak && rows.length === 0 && <p className="gud-petunjuk" data-testid="item-tak-cocok">Tidak ada item yang cocok dengan “{cari}”.</p>}
      <ul className="gud-pi-daftar">
        {rows.map((b) => {
          const kode = kodeSekunder(b); const po = progresItemPO(b);
          return (
            <li key={b.id} className="gud-pi" data-testid="kartu-item" data-kode={b.kode}>
              <div className="gud-pi-kepala">
                <span className="gud-pi-nama" data-testid="nama-item">{b.nama || b.kode}</span>
                <span className="gud-pi-satuan" title="Satuan hitung penerimaan ini">{b.satuan}</span>
              </div>
              {kode && <div className="gud-pi-kode" data-testid="kode-item">{kode}</div>}
              <dl className="gud-pi-grid" aria-label={`${b.nama || b.kode}: dokumen ini`} data-testid="angka-dokumen">
                {SEL_DOKUMEN.map(([k, label]) => <Sel key={k} label={label} nilai={b[k]} satuan={b.satuan} aksen={k === "masukStok" && b.masukStok > 0 ? "gud-pi-hijau" : undefined} testid={`sel-${k}`} />)}
              </dl>
              {po && (
                <>
                  <div className="gud-pi-judul">{nomorPO ? `${nomorPO} — ` : ""}semua penerimaan PO</div>
                  <dl className="gud-pi-grid gud-pi-grid-po" aria-label={`${b.nama || b.kode}: progres PO`} data-testid="angka-po">
                    {po.map((s) => <Sel key={s.kunci} label={s.label} nilai={s.nilai} satuan={b.satuan} aksen={s.kunci === "belumDatang" && s.nilai > 0 ? "gud-pi-tebal" : s.kunci === "menungguPengganti" && s.nilai > 0 ? "gud-pi-awas" : undefined} testid={`po-${s.kunci}`} />)}
                  </dl>
                </>
              )}
              {b.faktor !== 1 && b.satuanStok && <div className="gud-pi-catatan gud-pi-info" data-testid="konversi-penerimaan">Hitung dalam {b.satuan} sesuai PO: 1 {b.satuan} = {teksAngka(b.faktor)} {b.satuanStok}. Simpan ke Stok menambah {teksAngka(Math.round((b.baik ?? 0) * b.faktor * 1e4) / 1e4)} {b.satuanStok}{b.masukStok > 0 ? ` (sudah masuk: ${teksAngka(b.masukStokStok)} ${b.satuanStok})` : ""}.</div>}
              {catatanBaris(b).map((c) => <div key={c} className="gud-pi-catatan"><IkAwas size={14} aria-hidden /> {c}</div>)}
            </li>
          );
        })}
      </ul>
      {semua.some((b) => b.progres) && (
        <details className="gud-lipat mt-3" data-testid="legenda-angka">
          <summary><span>Arti tiap angka</span></summary>
          <dl className="gud-pi-legenda">
            {LEGENDA.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}
          </dl>
        </details>
      )}
    </div>
  );
}
