import React from "react";
import { Link } from "react-router-dom";
import { Glif, Ubin } from "./IkonApple.jsx";
import { ringkasPerhatian, waktuPembaruan } from "./berandaLogika.js";
import { barisDefinisi } from "@/features/warehouse/pusatkerja/urlFokus.js";

// Panel pendukung: ringkasan hambatan (angka dari server, tanpa mengulang daftar) + tautan pekerjaan. Setiap baris hambatan menyaring daftar utama; tautan membuka halaman yang sudah ada.
export function PanelPerhatian({ data, onPilih }) {
  const daftar = ringkasPerhatian(data);
  return (
    <section className="gud-br-samping gud-panel" aria-label="Perlu perhatian" data-testid="panel-perhatian">
      <h2 className="gud-br-judul-samping">Perlu perhatian</h2>
      {daftar.length === 0 ? <p className="gud-br-sekunder" data-testid="tidak-ada-tertahan">Tidak ada dokumen yang terlambat atau tertahan menurut tanggal dan syarat yang tercatat.</p> : (
        <ul className="gud-br-perhatian">
          {daftar.map((p) => (
            <li key={p.kode} className="gud-br-perhatian-item" data-testid={`perhatian-${p.kode}`}>
              <Ubin nada={UBIN_PERHATIAN[p.kode]?.nada ?? "oranye"} nama={UBIN_PERHATIAN[p.kode]?.nama ?? "awas"} ukuran={34} className="gud-br-perhatian-ikon" />
              <div>
                <p className="gud-br-perhatian-judul">{p.jumlah.toLocaleString("id-ID")} {p.satuan} · {p.judul.toLowerCase()}</p>
                <p className="gud-br-sekunder">{p.ket}</p>
                <button type="button" className="gud-br-taut" onClick={() => onPilih(p.kode)} data-testid={`pilih-${p.kode}`}>Lihat di daftar <Glif nama="kanan" size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link to="/warehouse/perlu-perhatian" className="gud-br-taut gud-br-taut-sendiri" data-testid="ke-perlu-perhatian"><Glif nama="awas" size={15} /> Buka Perlu Perhatian (stok &amp; data bahan) <Glif nama="kanan" size={14} /></Link>
    </section>
  );
}

const UBIN_PERHATIAN = { JADWAL_LEWAT: { nada: "oranye", nama: "jam" }, DATA_WAJIB: { nada: "oranye", nama: "dokumen" }, MENUNGGU_WORKSPACE: { nada: "abu", nama: "jam" } };
const AKSES = [
  { to: "/warehouse/barang-akan-datang", label: "Barang akan datang", nada: "biru", nama: "truk" },
  { to: "/warehouse/goods-receipt", label: "Penerimaan barang", nada: "hijau", nama: "dokumen" },
  { to: "/warehouse/inventory", label: "Stok bahan", nada: "ungu", nama: "kotak" },
];
export function AksesCepat() {
  return (
    <section className="gud-br-samping gud-panel" aria-label="Akses cepat" data-testid="akses-cepat">
      <h2 className="gud-br-judul-samping">Akses cepat</h2>
      <ul className="gud-br-akses">{AKSES.map((a) => <li key={a.to}><Link to={a.to}><Ubin nada={a.nada} nama={a.nama} ukuran={36} className="gud-br-akses-ikon" /><span>{a.label}</span><Glif nama="kanan" size={15} className="gud-br-akses-panah" /></Link></li>)}</ul>
    </section>
  );
}

/** "Tentang angka": definisi antrean dan catatan cakupan dibuka saat dibutuhkan (tidak memenuhi halaman). Definisi datang dari server bersama datanya. */
export function TentangAngka({ data, buka, onTutup }) {
  if (!buka) return null;
  return (
    <section className="gud-br-tentang gud-panel" aria-label="Tentang angka Beranda" data-testid="tentang-angka">
      <div className="gud-br-tentang-kepala"><h2 className="gud-br-judul-samping">Tentang angka di Beranda</h2><button type="button" className="gud-tombol-ikon" onClick={onTutup} aria-label="Tutup penjelasan"><Glif nama="tutup" size={16} /></button></div>
      <ul className="gud-br-tentang-daftar">
        <li>Angka di kartu adalah jumlah <b>dokumen</b> per antrean dari server (satu dokumen satu hitungan). Kartu dapat tumpang tindih dan tidak dijumlahkan menjadi total pekerjaan.</li>
        <li>“Lewat jadwal” hanya dipakai bila ada tanggal yang sah (jadwal penerimaan, estimasi PO, tanggal dibutuhkan, jadwal hitung) dan tanggal itu sudah lewat. Dokumen tanpa tanggal tidak pernah disebut terlambat.</li>
        <li>{data?.umurDefinisi ?? "Umur = sejak dokumen terakhir diubah (bukan SLA)."} Umur hanya tampil di rincian baris.</li>
        <li>Dihitung {waktuPembaruan(data?.dihitungPada) ?? "—"} (waktu server). Daftar menampilkan baris yang sudah dimuat; bila ada sisa di server, hal itu dinyatakan di atas daftar.</li>
        {data?.ringkasan?.produksiV2 !== "AKTIF" && <li data-testid="catatan-produksi-v2">Antrean Produksi (bahan, unit masuk, barang jadi, kekurangan) tidak dihitung di sini karena pembaca Produksi V2 belum aktif; lihat menu Produksi bila sudah diaktifkan.</li>}
        {(data?.tidakDihitung ?? []).map((t) => <li key={t.kode} data-testid={`tidak-dihitung-${t.kode}`}>Tidak dihitung — {t.kode === "KONFLIK_REVISI" ? "konflik revisi" : t.kode}: {t.alasan}</li>)}
      </ul>
      <div className="gud-br-def-daftar">
        {(data?.antrean ?? []).map((a) => {
          const def = barisDefinisi(a.definisi);
          return (
            <details key={a.kode} className="gud-br-def" data-testid="definisi-antrean">
              <summary>{a.judul} <span className="gud-br-sekunder">· {a.jumlah} {a.satuanHitung ?? a.definisi?.satuan ?? "dokumen"}</span></summary>
              <dl className="gud-br-dl gud-br-dl-def">{def.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </details>
          );
        })}
      </div>
    </section>
  );
}
