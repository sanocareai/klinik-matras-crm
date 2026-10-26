import React, { useCallback, useEffect, useState } from "react";
import { History, Loader2, Pencil } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import UbahHargaModal from "./UbahHargaModal.jsx";
import PenerapanLamaModal from "./PenerapanLamaModal.jsx";
import { TEKS, rp, rpNilai, tanggalJam, STATUS_RIWAYAT, varianBukti } from "./hargaBerlakuLogic.js";

// HARGA BERLAKU di layar Stok (drawer bahan). Hanya untuk pengguna dengan izin Finance (server 403 → panel tidak tampil).
// Memisahkan dengan tegas: HPP operasional (harga berlaku, di sini) ≠ nilai persediaan/jurnal Finance (biaya perolehan PSA/GR).
export default function HargaBerlakuPanel({ materialId }) {
  const [d, setD] = useState(null); const [tersembunyi, setTersembunyi] = useState(false); const [galat, setGalat] = useState("");
  const [riwayat, setRiwayat] = useState(null); const [bukaRiwayat, setBukaRiwayat] = useState(false);
  const [modal, setModal] = useState(null); // null | { jenis: "ubah" } | { jenis: "koreksi", baris } | { jenis: "penerapan" }
  const [pesan, setPesan] = useState("");

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

  return (
    <section className="mt-4 rounded-btn border border-line p-3" aria-label="Harga berlaku bahan" data-testid="panel-harga-berlaku">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">{TEKS.judul}</h4>
        {h ? <Badge variant={varianBukti(h.labelBukti)} data-testid="label-bukti">{h.teksLabelBukti}</Badge> : <Badge variant="orange" data-testid="label-bukti">Belum ada harga berlaku</Badge>}
      </div>
      {h ? (
        <div className="mt-1.5">
          <div className="text-[22px] font-extrabold leading-none tabular-nums text-ink" data-testid="harga-berlaku">{rp(h.harga)}<span className="ml-1 text-[12px] font-semibold text-ink2">/ {bahan.satuan}</span></div>
          <div className="mt-1 text-[11.5px] text-ink3">Berlaku sejak {tanggalJam(h.berlakuMulai)} · alasan: {h.alasan}{h.catatanBukti ? ` · catatan bukti: ${h.catatanBukti}` : ""}</div>
        </div>
      ) : <p className="mt-1.5 text-[12.5px] text-ink2" data-testid="belum-ada-harga">Belum ada harga berlaku. Pemakaian yang diposting sekarang dibekukan <b>tanpa harga operasional</b> (bukan Rp0).</p>}
      {d.terjadwal.map((t) => <div key={t.id} className="mt-1 text-[11.5px] text-accent" data-testid="harga-terjadwal">Terjadwal: {rp(t.harga)} / {bahan.satuan} mulai {tanggalJam(t.berlakuMulai)}</div>)}

      <p className="mt-2 rounded-btn bg-inset px-2.5 py-1.5 text-[11px] leading-relaxed text-ink2" data-testid="pemisah-angka">
        <b>{TEKS.bukan}</b> {TEKS.finance} {TEKS.aturanWaktu}
      </p>
      {(d.pembanding.biayaPerolehanGRTerakhir || d.pembanding.referensiAgustus) && (
        <p className="mt-1.5 text-[11px] text-ink3" data-testid="pembanding">Pembanding (bukan sumber harga):{d.pembanding.biayaPerolehanGRTerakhir ? ` biaya perolehan GR terakhir ${rp(d.pembanding.biayaPerolehanGRTerakhir.harga)}` : ""}{d.pembanding.referensiAgustus ? ` · referensi ${d.pembanding.referensiAgustus.bulan} ${rp(d.pembanding.referensiAgustus.harga)}` : ""}.</p>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink3" data-testid="izin-teks">{d.bolehUbah ? `${d.izinTeks.ubah} ${TEKS.aturanTanpaMundur}` : TEKS.izinLihat}</p>

      <dl className="mt-2 grid grid-cols-1 gap-1 text-[12px] text-ink2" data-testid="dampak-ringkas">
        <div className="flex justify-between gap-3"><dt>Order belum memakai bahan ini</dt><dd className="font-semibold text-ink tabular-nums" data-testid="jumlah-order-terdampak">{dm.akanMemakai.order} order · {dm.akanMemakai.unit} unit</dd></div>
        <div className="flex justify-between gap-3"><dt>Pemakaian sudah dibekukan sejak harga berlaku</dt><dd className="font-semibold text-ink tabular-nums">{dm.sudahDibekukanSejakMulai.pemakaian} · {rpNilai(dm.sudahDibekukanSejakMulai.nilai)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Pemakaian lama tanpa harga operasional</dt><dd className="font-semibold text-ink tabular-nums">{dm.belumDibekukan.pemakaian} · {dm.belumDibekukan.unit} unit</dd></div>
        {dm.gagalPembekuan?.pemakaian > 0 && <div className="flex justify-between gap-3 text-red" data-testid="gagal-pembekuan"><dt>Pembekuan harga GAGAL (tercatat; perlu diperbaiki)</dt><dd className="font-semibold tabular-nums">{dm.gagalPembekuan.pemakaian} pemakaian</dd></div>}
      </dl>

      {pesan && <p className="mt-2 text-[11.5px] text-green" role="status" data-testid="pesan-tersimpan">{pesan}</p>}
      {galat && <p className="mt-2 text-[11.5px] text-red" role="alert">{galat}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {d.bolehUbah && <Button size="sm" onClick={() => setModal({ jenis: "ubah" })} data-testid="tombol-ubah-harga"><Pencil size={13} /> Ubah harga</Button>}
        <Button size="sm" variant="secondary" onClick={() => setBukaRiwayat((v) => !v)} data-testid="tombol-riwayat-harga"><History size={13} /> Riwayat ({d.jumlahRiwayat})</Button>
        {(dm.belumDibekukan.pemakaian > 0 || d.penerapanAktif) && (d.bolehUbah || d.bolehSetujui || d.penerapanAktif) && <Button size="sm" variant="secondary" onClick={() => setModal({ jenis: "penerapan" })} data-testid="tombol-penerapan">Beri harga ke pemakaian lama{d.penerapanAktif ? " · ada pengajuan" : ""}</Button>}
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
                {d.bolehUbah && r.status !== "DIGANTI_KOREKSI" && <button type="button" className="mt-1 text-[11.5px] font-medium text-accent hover:underline" onClick={() => setModal({ jenis: "koreksi", baris: r })} data-testid="koreksi-baris">Koreksi salah input historis (tindakan khusus)</button>}
              </li>
            );
          })}
        </ul>
      )}

      {modal?.jenis === "ubah" && <UbahHargaModal open onClose={() => setModal(null)} bahan={bahan} hargaSekarang={h?.harga} onTersimpan={selesai} />}
      {modal?.jenis === "koreksi" && <UbahHargaModal open onClose={() => setModal(null)} bahan={bahan} hargaSekarang={h?.harga} koreksi={modal.baris} onTersimpan={selesai} />}
      {modal?.jenis === "penerapan" && <PenerapanLamaModal open onClose={() => setModal(null)} bahan={bahan} bolehUbah={d.bolehUbah} bolehSetujui={d.bolehSetujui} onSelesai={() => { muat(); }} />}
    </section>
  );
}
