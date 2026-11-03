import React, { useCallback, useEffect, useState } from "react";
import { IkAwas, IkEdit } from "@/components/gudangIcons.jsx";
import { api } from "@/api.js";
import UbahHargaModal from "./UbahHargaModal.jsx";
import PenerapanLamaModal from "./PenerapanLamaModal.jsx";
import { TEKS, rp, rpNilai, tanggalJam, STATUS_RIWAYAT, varianBukti } from "./hargaBerlakuLogic.js";
import { TEKS_DRAWER, barisDampakBermakna, peringatanHarga, ringkasHarga } from "./drawerBahanLogic.js";

// HARGA BERLAKU di layar Stok (drawer bahan) — tampilan RINGKAS. Hanya untuk pengguna dengan izin Finance (server 403 → panel tidak tampil).
// Awal: harga per satuan atau "Belum diisi", label bukti singkat, peringatan yang butuh tindakan, tombol Ubah harga dan Riwayat. Definisi HPP/aturan ada di ikon informasi;
// nilai persediaan Finance + pembanding dan rincian pemakaian terdampak ada di bagian terlipat. Harga Berlaku operasional TETAP dibedakan dari nilai persediaan Finance, dan "belum ada harga" tidak pernah menjadi Rp0.
export default function HargaBerlakuPanel({ materialId }) {
  const [d, setD] = useState(null); const [tersembunyi, setTersembunyi] = useState(false); const [galat, setGalat] = useState("");
  const [riwayat, setRiwayat] = useState(null);
  const [modal, setModal] = useState(null); // null | { jenis: "ubah" } | { jenis: "koreksi", baris } | { jenis: "penerapan" }
  const [pesan, setPesan] = useState("");

  const muat = useCallback(() => {
    setGalat("");
    return api.getHargaBerlaku(materialId).then(setD).catch((e) => { if (e.status === 403) setTersembunyi(true); else setGalat(e.message); });
  }, [materialId]);
  useEffect(() => { setD(null); setRiwayat(null); setTersembunyi(false); setPesan(""); muat(); }, [materialId, muat]);
  const muatRiwayat = useCallback(() => api.getRiwayatHargaBerlaku(materialId).then((r) => setRiwayat(r.riwayat)).catch((e) => setGalat(e.message)), [materialId]);
  useEffect(() => { muatRiwayat(); }, [muatRiwayat]);

  if (tersembunyi) return null;
  if (galat && !d) return <p role="alert" className="gud-info" data-nada="galat">{galat}</p>;
  if (!d) return <p className="gud-petunjuk" role="status">Memuat harga berlaku…</p>;
  const h = d.hargaBerlaku; const bahan = d.bahan; const dm = d.dampak;
  const selesai = () => { setModal(null); setPesan("Tersimpan. Pemakaian yang sudah dibekukan tidak berubah."); muat(); muatRiwayat(); };
  const tampil = ringkasHarga(h, bahan.satuan, rp);
  const peringatan = peringatanHarga({ h, dampak: dm });
  const dampak = barisDampakBermakna(dm, rpNilai);
  const adaPenerapan = (dm.belumDibekukan.pemakaian > 0 || d.penerapanAktif) && (d.bolehUbah || d.bolehSetujui || d.penerapanAktif);

  return (
    <section className="gud-bahan-bagian gud-harga" aria-label="Harga berlaku bahan" data-testid="panel-harga-berlaku">
      <div className="gud-bahan-judul-baris">
        <h3 className="gud-bahan-sub">{TEKS.judul}</h3>
      </div>
      <p className="gud-petunjuk" data-testid="pemisah-angka"><b>{TEKS.bukan}</b> {TEKS.finance} {TEKS.aturanWaktu}</p>

      <div className="gud-harga-utama">
        {h
          ? <div className="gud-saldo-angka" data-testid="harga-berlaku">{tampil.angka}<span className="gud-saldo-satuan">/ {tampil.satuan}</span></div>
          : <div className="gud-harga-kosong" data-testid="belum-ada-harga">{tampil.angka}</div>}
        {h && <span className="gud-pill" data-warna={varianBukti(h.labelBukti)} data-testid="label-bukti">{h.teksLabelBukti}</span>}
      </div>
      {h && <div className="gud-petunjuk" data-testid="harga-sejak">Berlaku sejak {tanggalJam(h.berlakuMulai)}</div>}
      {d.terjadwal.map((t) => <div key={t.id} className="gud-petunjuk gud-aksen" data-testid="harga-terjadwal">Terjadwal: {rp(t.harga)} / {bahan.satuan} mulai {tanggalJam(t.berlakuMulai)}</div>)}

      {peringatan.map((p) => (
        <p key={p.kode} role="status" data-testid={`peringatan-${p.kode.toLowerCase().replace(/_/g, "-")}`} className="gud-info" data-nada={p.nada === "red" ? "galat" : "awas"}>
          <IkAwas size={16} aria-hidden /><span>{p.teks}</span>
        </p>
      ))}

      {pesan && <p className="gud-info" data-nada="ok" role="status" data-testid="pesan-tersimpan">{pesan}</p>}
      {galat && <p className="gud-f-galat" role="alert">{galat}</p>}
      <p className="gud-petunjuk" data-testid="izin-teks">{d.bolehUbah ? `${d.izinTeks.ubah} ${TEKS.aturanTanpaMundur}` : TEKS.izinLihat}</p>
      <div className="gud-aksi-baris gud-bahan-tombol">
        {d.bolehUbah && <button type="button" onClick={() => setModal({ jenis: "ubah" })} className="gud-tombol gud-tombol-utama" data-testid="tombol-ubah-harga"><IkEdit size={16} /> Ubah harga</button>}
        {adaPenerapan && <button type="button" onClick={() => setModal({ jenis: "penerapan" })} className="gud-tombol" data-testid="tombol-penerapan">Beri harga ke pemakaian lama{d.penerapanAktif ? " · ada pengajuan" : ""}</button>}
      </div>

      <h4 className="gud-bahan-sub2" data-testid="tombol-riwayat-harga">Riwayat harga ({d.jumlahRiwayat})</h4>
      {(
        <ul className="gud-riwayat" data-testid="riwayat-harga">
          {!riwayat && <li className="gud-petunjuk">Memuat riwayat…</li>}
          {riwayat?.length === 0 && <li className="gud-petunjuk">Belum ada riwayat harga.</li>}
          {riwayat?.map((r) => {
            const st = STATUS_RIWAYAT[r.status] ?? { teks: r.status, varian: "neutral" };
            return (
              <li key={r.id} data-testid="baris-riwayat">
                <div className="gud-riwayat-atas"><b className="gud-angka">{rp(r.harga)}</b><span className="gud-redup">/ {r.satuan}</span>
                  {r.jenis === "KOREKSI" && <span className="gud-pill" data-warna="orange">Koreksi</span>}<span className="gud-pill" data-warna={st.varian}>{st.teks}</span><span className="gud-pill" data-warna={varianBukti(r.labelBukti)}>{r.teksLabelBukti}</span></div>
                <div className="gud-sekunder">Mulai {tanggalJam(r.berlakuMulai)} · {r.hargaLama != null ? `harga lama ${rp(r.hargaLama)} · ` : ""}dicatat {tanggalJam(r.dibuatPada)} oleh {r.dibuatOlehNama ?? "—"}</div>
                {r.sumber?.teks && <div className="gud-sekunder" data-testid="sumber-riwayat-harga">Sumber: {r.sumber.teks}{r.sumber.hargaBeli != null && r.sumber.satuanBeli ? ` (di PO: ${r.sumber.hargaBeli.toLocaleString("id-ID")} / ${r.sumber.satuanBeli}${r.sumber.faktor ? `, 1 ${r.sumber.satuanBeli} = ${r.sumber.faktor} ${r.satuan}` : ""})` : ""}</div>}
                <div className="gud-sekunder">Alasan: {r.alasan}{r.catatanBukti ? ` · bukti: ${r.catatanBukti}` : ""}</div>
                {d.bolehUbah && r.status !== "DIGANTI_KOREKSI" && <button type="button" className="gud-tautan" onClick={() => setModal({ jenis: "koreksi", baris: r })} data-testid="koreksi-baris">Koreksi salah input historis (tindakan khusus)</button>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="gud-bahan-pendukung">
        <h3 className="gud-bahan-sub">Nilai Finance dan harga pembanding</h3>
        <p className="gud-petunjuk" data-testid="beda-angka">{TEKS_DRAWER.bedaAngka}</p>
        {d.nilaiPersediaanFinance && (
          <p className="gud-petunjuk" data-testid="nilai-persediaan-finance">
            <b>{d.nilaiPersediaanFinance.nama}:</b>{" "}
            {d.nilaiPersediaanFinance.tersedia ? <>{rpNilai(d.nilaiPersediaanFinance.nilai)} ({d.nilaiPersediaanFinance.qty} {String(d.nilaiPersediaanFinance.satuan ?? "").toLowerCase()} × {rp(d.nilaiPersediaanFinance.biayaSatuan)}, {d.nilaiPersediaanFinance.nomor}). {d.nilaiPersediaanFinance.teks}</> : d.nilaiPersediaanFinance.teks}
          </p>
        )}
        {(d.pembanding.biayaPerolehanGRTerakhir || d.pembanding.referensiAgustus)
          ? <p className="gud-petunjuk" data-testid="pembanding">Pembanding (bukan sumber harga):{d.pembanding.biayaPerolehanGRTerakhir ? ` biaya perolehan GR terakhir ${rp(d.pembanding.biayaPerolehanGRTerakhir.harga)}` : ""}{d.pembanding.referensiAgustus ? ` · referensi ${d.pembanding.referensiAgustus.bulan} ${rp(d.pembanding.referensiAgustus.harga)}` : ""}</p>
          : !d.nilaiPersediaanFinance && <p className="gud-petunjuk">Belum ada pembanding dari Finance untuk bahan ini.</p>}
      </div>
      <div className="gud-bahan-pendukung" data-testid="lipat-dampak">
        <h3 className="gud-bahan-sub">Pemakaian terdampak <span className="gud-redup">{dampak.length ? `${dampak.length} rincian` : "tidak ada"}</span></h3>
        {dampak.length === 0
          ? <p className="gud-petunjuk" data-testid="dampak-kosong">{TEKS_DRAWER.dampakKosong}</p>
          : (
            <dl className="gud-dl" data-testid="dampak-ringkas">
              {dampak.map((x) => <div key={x.k} className="gud-dl-baris"><dt>{x.label}</dt><dd data-testid={x.k === "order" ? "jumlah-order-terdampak" : undefined}>{x.nilai}</dd></div>)}
            </dl>
          )}
      </div>

      {modal?.jenis === "ubah" && <UbahHargaModal open onClose={() => setModal(null)} bahan={bahan} hargaSekarang={h?.harga} onTersimpan={selesai} />}
      {modal?.jenis === "koreksi" && <UbahHargaModal open onClose={() => setModal(null)} bahan={bahan} hargaSekarang={h?.harga} koreksi={modal.baris} onTersimpan={selesai} />}
      {modal?.jenis === "penerapan" && <PenerapanLamaModal open onClose={() => setModal(null)} bahan={bahan} bolehUbah={d.bolehUbah} bolehSetujui={d.bolehSetujui} onSelesai={() => { muat(); }} />}
    </section>
  );
}
