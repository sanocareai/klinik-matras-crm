import React, { useCallback, useEffect, useState } from "react";
import { History, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import UbahHargaModal from "./UbahHargaModal.jsx";
import PenerapanLamaModal from "./PenerapanLamaModal.jsx";
import Lipat from "./Lipat.jsx";
import { TEKS, rp, rpNilai, tanggalJam, STATUS_RIWAYAT, varianBukti } from "./hargaBerlakuLogic.js";
import { TEKS_DRAWER, barisDampakBermakna, peringatanHarga, ringkasHarga } from "./drawerBahanLogic.js";

// HARGA BERLAKU di layar Stok (drawer bahan) — tampilan RINGKAS. Hanya untuk pengguna dengan izin Finance (server 403 → panel tidak tampil).
// Awal: harga per satuan atau "Belum diisi", label bukti singkat, peringatan yang butuh tindakan, tombol Ubah harga dan Riwayat. Definisi HPP/aturan ada di ikon informasi;
// nilai persediaan Finance + pembanding dan rincian pemakaian terdampak ada di bagian terlipat. Harga Berlaku operasional TETAP dibedakan dari nilai persediaan Finance, dan "belum ada harga" tidak pernah menjadi Rp0.
export default function HargaBerlakuPanel({ materialId }) {
  const [d, setD] = useState(null); const [tersembunyi, setTersembunyi] = useState(false); const [galat, setGalat] = useState("");
  const [riwayat, setRiwayat] = useState(null); const [bukaRiwayat, setBukaRiwayat] = useState(false);
  const [modal, setModal] = useState(null); // null | { jenis: "ubah" } | { jenis: "koreksi", baris } | { jenis: "penerapan" }
  const [pesan, setPesan] = useState("");
  const info = useInfoToggle();

  const muat = useCallback(() => {
    setGalat("");
    return api.getHargaBerlaku(materialId).then(setD).catch((e) => { if (e.status === 403) setTersembunyi(true); else setGalat(e.message); });
  }, [materialId]);
  useEffect(() => { setD(null); setRiwayat(null); setBukaRiwayat(false); setTersembunyi(false); setPesan(""); muat(); }, [materialId, muat]);
  const muatRiwayat = useCallback(() => api.getRiwayatHargaBerlaku(materialId).then((r) => setRiwayat(r.riwayat)).catch((e) => setGalat(e.message)), [materialId]);
  useEffect(() => { if (bukaRiwayat) muatRiwayat(); }, [bukaRiwayat, muatRiwayat]);

  if (tersembunyi) return null;
  if (galat && !d) return <p role="alert" className="mt-3 rounded-btn bg-redbg px-3 py-2 text-[12px] text-red">{galat}</p>;
  if (!d) return <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat harga berlaku…</p>;
  const h = d.hargaBerlaku; const bahan = d.bahan; const dm = d.dampak;
  const selesai = () => { setModal(null); setPesan("Tersimpan. Pemakaian yang sudah dibekukan tidak berubah."); muat(); if (bukaRiwayat) muatRiwayat(); };
  const tampil = ringkasHarga(h, bahan.satuan, rp);
  const peringatan = peringatanHarga({ h, dampak: dm });
  const dampak = barisDampakBermakna(dm, rpNilai);
  const adaPenerapan = (dm.belumDibekukan.pemakaian > 0 || d.penerapanAktif) && (d.bolehUbah || d.bolehSetujui || d.penerapanAktif);
  const adaFinance = !!d.nilaiPersediaanFinance || !!d.pembanding.biayaPerolehanGRTerakhir || !!d.pembanding.referensiAgustus;

  return (
    <section className="mt-4 rounded-btn border border-line p-3" aria-label="Harga berlaku bahan" data-testid="panel-harga-berlaku">
      <div className="flex items-center gap-1.5">
        <h4 className="m-0 min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wide text-ink3">{TEKS.judul}</h4>
        <InfoToggleButton info={info} label="Harga Berlaku (HPP operasional)" />
      </div>
      <InfoToggleIsi info={info}>
        <p className="m-0" data-testid="pemisah-angka"><b>{TEKS.bukan}</b> {TEKS.finance} {TEKS.aturanWaktu}</p>
        <p className="m-0" data-testid="izin-teks">{d.bolehUbah ? `${d.izinTeks.ubah} ${TEKS.aturanTanpaMundur}` : TEKS.izinLihat}</p>
      </InfoToggleIsi>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {h
          ? <div className="text-[22px] font-extrabold leading-none tabular-nums text-ink" data-testid="harga-berlaku">{tampil.angka}<span className="ml-1 text-[12px] font-semibold text-ink2">/ {tampil.satuan}</span></div>
          : <div className="text-[18px] font-bold leading-none text-ink3" data-testid="belum-ada-harga">{tampil.angka}</div>}
        {h && <Badge variant={varianBukti(h.labelBukti)} data-testid="label-bukti">{h.teksLabelBukti}</Badge>}
      </div>
      {h && <div className="mt-1 text-[11.5px] text-ink3" data-testid="harga-sejak">Berlaku sejak {tanggalJam(h.berlakuMulai)}</div>}
      {d.terjadwal.map((t) => <div key={t.id} className="mt-1 text-[11.5px] text-accent" data-testid="harga-terjadwal">Terjadwal: {rp(t.harga)} / {bahan.satuan} mulai {tanggalJam(t.berlakuMulai)}</div>)}

      {peringatan.map((p) => (
        <p key={p.kode} role="status" data-testid={`peringatan-${p.kode.toLowerCase().replace(/_/g, "-")}`} className={`mt-2 flex items-start gap-2 rounded-btn px-2.5 py-1.5 text-[12px] ${p.nada === "red" ? "bg-redbg text-red" : "bg-orangebg text-ink"}`}>
          <TriangleAlert size={13} className={`mt-0.5 shrink-0 ${p.nada === "red" ? "text-red" : "text-orange"}`} aria-hidden />{p.teks}
        </p>
      ))}

      {pesan && <p className="mt-2 text-[11.5px] text-green" role="status" data-testid="pesan-tersimpan">{pesan}</p>}
      {galat && <p className="mt-2 text-[11.5px] text-red" role="alert">{galat}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {d.bolehUbah && <Button size="sm" onClick={() => setModal({ jenis: "ubah" })} className="max-sm:min-h-11" data-testid="tombol-ubah-harga"><Pencil size={13} /> Ubah harga</Button>}
        <Button size="sm" variant="secondary" onClick={() => setBukaRiwayat((v) => !v)} aria-expanded={bukaRiwayat} className="max-sm:min-h-11" data-testid="tombol-riwayat-harga"><History size={13} /> Riwayat ({d.jumlahRiwayat})</Button>
        {adaPenerapan && <Button size="sm" variant="secondary" onClick={() => setModal({ jenis: "penerapan" })} className="max-sm:min-h-11" data-testid="tombol-penerapan">Beri harga ke pemakaian lama{d.penerapanAktif ? " · ada pengajuan" : ""}</Button>}
      </div>

      {bukaRiwayat && (
        <ul className="mt-3 divide-y divide-line" data-testid="riwayat-harga">
          {!riwayat && <li className="py-2 text-[12px] text-ink3">Memuat riwayat…</li>}
          {riwayat?.length === 0 && <li className="py-2 text-[12px] text-ink3">Belum ada riwayat harga.</li>}
          {riwayat?.map((r) => {
            const st = STATUS_RIWAYAT[r.status] ?? { teks: r.status, varian: "neutral" };
            return (
              <li key={r.id} className="py-2 text-[12px]" data-testid="baris-riwayat">
                <div className="flex flex-wrap items-center gap-1.5"><b className="tabular-nums text-ink">{rp(r.harga)}</b><span className="text-ink3">/ {r.satuan}</span>
                  {r.jenis === "KOREKSI" && <Badge variant="orange">Koreksi</Badge>}<Badge variant={st.varian}>{st.teks}</Badge><Badge variant={varianBukti(r.labelBukti)}>{r.teksLabelBukti}</Badge></div>
                <div className="mt-0.5 text-ink3">Mulai {tanggalJam(r.berlakuMulai)} · {r.hargaLama != null ? `harga lama ${rp(r.hargaLama)} · ` : ""}dicatat {tanggalJam(r.dibuatPada)} oleh {r.dibuatOlehNama ?? "—"}</div>
                <div className="text-ink2">Alasan: {r.alasan}{r.catatanBukti ? ` · bukti: ${r.catatanBukti}` : ""}</div>
                {d.bolehUbah && r.status !== "DIGANTI_KOREKSI" && <button type="button" className="mt-1 min-h-6 text-[11.5px] font-medium text-accent hover:underline max-sm:min-h-11" onClick={() => setModal({ jenis: "koreksi", baris: r })} data-testid="koreksi-baris">Koreksi salah input historis (tindakan khusus)</button>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">
        {adaFinance && (
          <Lipat judul="Nilai Finance dan harga pembanding" testid="lipat-finance">
            <p className="m-0 mb-1.5 text-[11.5px] leading-relaxed text-ink3" data-testid="beda-angka">{TEKS_DRAWER.bedaAngka}</p>
            {d.nilaiPersediaanFinance && (
              <p className="m-0 mb-1.5 text-[11.5px] leading-relaxed text-ink3" data-testid="nilai-persediaan-finance">
                <b className="text-ink2">{d.nilaiPersediaanFinance.nama}:</b>{" "}
                {d.nilaiPersediaanFinance.tersedia ? <>{rpNilai(d.nilaiPersediaanFinance.nilai)} ({d.nilaiPersediaanFinance.qty} {String(d.nilaiPersediaanFinance.satuan ?? "").toLowerCase()} × {rp(d.nilaiPersediaanFinance.biayaSatuan)}, {d.nilaiPersediaanFinance.nomor}). {d.nilaiPersediaanFinance.teks}</> : d.nilaiPersediaanFinance.teks}
              </p>
            )}
            {(d.pembanding.biayaPerolehanGRTerakhir || d.pembanding.referensiAgustus) && (
              <p className="m-0 text-[11.5px] text-ink3" data-testid="pembanding">Pembanding (bukan sumber harga):{d.pembanding.biayaPerolehanGRTerakhir ? ` biaya perolehan GR terakhir ${rp(d.pembanding.biayaPerolehanGRTerakhir.harga)}` : ""}{d.pembanding.referensiAgustus ? ` · referensi ${d.pembanding.referensiAgustus.bulan} ${rp(d.pembanding.referensiAgustus.harga)}` : ""}.</p>
            )}
          </Lipat>
        )}
        <Lipat judul="Pemakaian terdampak" ringkas={dampak.length ? `${dampak.length} rincian` : "tidak ada"} testid="lipat-dampak">
          {dampak.length === 0
            ? <p className="m-0 text-[12px] text-ink3" data-testid="dampak-kosong">{TEKS_DRAWER.dampakKosong}</p>
            : (
              <dl className="m-0 grid grid-cols-1 gap-1 text-[12px] text-ink2" data-testid="dampak-ringkas">
                {dampak.map((x) => <div key={x.k} className="flex justify-between gap-3"><dt>{x.label}</dt><dd className="m-0 font-semibold tabular-nums text-ink" data-testid={x.k === "order" ? "jumlah-order-terdampak" : undefined}>{x.nilai}</dd></div>)}
              </dl>
            )}
        </Lipat>
      </div>

      {modal?.jenis === "ubah" && <UbahHargaModal open onClose={() => setModal(null)} bahan={bahan} hargaSekarang={h?.harga} onTersimpan={selesai} />}
      {modal?.jenis === "koreksi" && <UbahHargaModal open onClose={() => setModal(null)} bahan={bahan} hargaSekarang={h?.harga} koreksi={modal.baris} onTersimpan={selesai} />}
      {modal?.jenis === "penerapan" && <PenerapanLamaModal open onClose={() => setModal(null)} bahan={bahan} bolehUbah={d.bolehUbah} bolehSetujui={d.bolehSetujui} onSelesai={() => { muat(); }} />}
    </section>
  );
}
