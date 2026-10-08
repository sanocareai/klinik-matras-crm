import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { tanggalPendek } from "@/features/finance/shared.jsx";
import {
  STATUS_BIAYA, STATUS_BARIS, JENIS_BIAYA, STATUS_FAKTUR, NAMA_BELUM_FINAL, teksQty, teksRupiah, selNilai, kartuTotal, teksSumber,
} from "@/features/finance/biayaBahanLogic.js";

// Jejak biaya bahan SATU unit: PO → penerimaan → Material Issue → pemakaian PIC → waste/retur → faktur.
// Dipakai di Finance (sumber "finance", nominal penuh) dan di Unit 360 tab Bahan (sumber "unit": nominal hanya bila pengguna punya izin harga).
// Murni baca: tidak ada tombol yang mengubah stok/jurnal. Nilai dibekukan server saat pergerakan diposting.
const wib = (v) => (v ? tanggalPendek(new Date(new Date(v).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)) : "—");

export default function JejakBiayaBahan({ unitId, sumber = "unit" }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  useEffect(() => {
    let batal = false;
    setD(null); setGalat("");
    const ambil = sumber === "finance" ? api.getBiayaBahanUnit(unitId) : api.getJejakBahanUnit(unitId);
    ambil.then((r) => { if (!batal) setD(r); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat jejak biaya bahan"); });
    return () => { batal = true; };
  }, [unitId, sumber]);

  if (galat) return <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>;
  if (!d) return <p className="text-[12.5px] text-ink3">Memuat jejak biaya bahan…</p>;

  const st = STATUS_BIAYA[d.statusBiaya] || { label: d.statusBiaya, variant: "neutral" };
  const total = kartuTotal(d.ringkasan, d.statusBiaya);
  return (
    <section className="space-y-3" data-testid="jejak-biaya-bahan" aria-label="Jejak biaya bahan">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[13px] font-bold text-ink">Jejak biaya bahan</h3>
        <Badge variant={st.variant} data-testid="status-biaya">{st.label}</Badge>
        {!d.izinHarga && <span className="text-[11.5px] text-ink3" data-testid="catatan-tanpa-harga">Nominal harga tidak ditampilkan untuk peran Anda — kuantitas, status, dan dokumen tetap terlihat.</span>}
      </div>

      {d.izinHarga && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="kartu-ringkasan">
          <div className="rounded-btn bg-inset px-3 py-2">
            <div className="text-[11px] text-ink3">{total.judul}</div>
            <div className={cn("text-[15px] font-bold tabular-nums", total.pasti ? "text-ink" : "text-orange")} data-testid="total-biaya">{total.nilai}</div>
            <div className="text-[11.5px] text-ink2">{total.sub}</div>
          </div>
          <div className="rounded-btn bg-inset px-3 py-2">
            <div className="text-[11px] text-ink3">Susut / waste (di luar biaya unit)</div>
            <div className="text-[15px] font-bold tabular-nums text-ink">{teksRupiah(d.ringkasan.nilaiSusut) ?? "Belum bisa dihitung"}</div>
            <div className="text-[11.5px] text-ink2">Dinilai pada harga saat pergerakan</div>
          </div>
          <div className="rounded-btn bg-inset px-3 py-2" data-testid="kartu-selisih-faktur">
            <div className="text-[11px] text-ink3">Selisih harga faktur (terpisah)</div>
            <div className="text-[15px] font-bold tabular-nums text-ink">{teksRupiah(d.ringkasan.selisihHargaFaktur?.nilai, { tanda: true }) ?? "—"}</div>
            <div className="text-[11.5px] text-ink2">Tidak dijumlahkan ke biaya persediaan; masuk Selisih Harga Pembelian</div>
          </div>
        </div>
      )}

      {d.belumFinal.length > 0 && (
        <div className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="belum-final">
          <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={13} aria-hidden /> Belum final ({d.belumFinal.length})</div>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {d.belumFinal.map((x, i) => <li key={i}><strong>{NAMA_BELUM_FINAL[x.jenis] || x.jenis}:</strong> {x.pesan}</li>)}
          </ul>
        </div>
      )}

      {d.bahan.length === 0 ? (
        <p className="text-[12.5px] text-ink3">Belum ada bahan yang keluar ke unit ini lewat Material Issue Gudang.</p>
      ) : (
        <div className="space-y-2">{d.bahan.map((b) => <BarisBahan key={b.materialId} b={b} izinHarga={d.izinHarga} />)}</div>
      )}
      <p className="text-[11px] leading-snug text-ink3">Stok keluar hanya lewat Material Issue Gudang. Catatan pemakaian PIC hanya pembanding fisik, tidak membuat stok atau jurnal. Retur baru mengurangi biaya setelah Gudang menerimanya. Biaya historis tidak berubah oleh transaksi bertanggal mundur.</p>
    </section>
  );
}

function BarisBahan({ b, izinHarga }) {
  const [buka, setBuka] = useState(false);
  const Ikon = buka ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-btn border border-line" data-testid="baris-bahan">
      <button type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <Ikon size={14} className="mt-0.5 shrink-0 text-ink3" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-ink">{b.kode} <span className="font-normal text-ink2">{b.nama}</span></span>
          <span className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-ink2 sm:grid-cols-6">
            <span>Diserahkan <strong className="tabular-nums text-ink">{teksQty(b.diserahkan)}</strong></span>
            <span>Dipakai (PIC) <strong className="tabular-nums text-ink">{teksQty(b.dipakaiPIC)}</strong></span>
            <span>Waste <strong className="tabular-nums text-ink">{teksQty(b.waste)}</strong></span>
            <span>Retur diterima <strong className="tabular-nums text-ink">{teksQty(b.retur)}</strong></span>
            <span>Retur menunggu <strong className="tabular-nums text-ink">{teksQty(b.returPending)}</strong></span>
            <span>Sisa di unit <strong className="tabular-nums text-ink">{teksQty(b.sisaDiUnit)} {b.satuan}</strong></span>
          </span>
        </span>
      </button>
      {buka && (
        <div className="space-y-1.5 border-t border-line px-3 py-2">
          {b.pergerakan.map((r) => <Pergerakan key={r.movementId} r={r} izinHarga={izinHarga} />)}
          {b.pemakaianPIC.length > 0 && (
            <div className="rounded-btn bg-inset px-2.5 py-1.5 text-[11.5px] text-ink2" data-testid="pemakaian-pic">
              <strong className="text-ink">Catatan pemakaian PIC</strong> (pembanding, bukan stok/jurnal):{" "}
              {b.pemakaianPIC.map((p, i) => <span key={i}>{i ? " · " : ""}tahap {p.stepNo} {teksQty(p.qty)} {b.satuan}{p.oleh ? ` oleh ${p.oleh}` : ""}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pergerakan({ r, izinHarga }) {
  const nilai = selNilai(r, izinHarga);
  const sb = STATUS_BARIS[r.status] || { label: r.status, variant: "neutral" };
  const fk = r.faktur ? STATUS_FAKTUR[r.faktur.status] : null;
  return (
    <div className="rounded-btn bg-surface px-2.5 py-1.5 text-[12px]" data-testid="pergerakan">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ink3">{wib(r.tanggal)}</span>
        <span className="font-semibold text-ink">{JENIS_BIAYA[r.jenisBiaya] || r.jenisBiaya}</span>
        <span className="tabular-nums">{teksQty(r.qty)} {r.satuan}</span>
        {r.dokumen && <span className="font-mono text-[11.5px] text-ink2">{r.dokumen.nomor}</span>}
        <Badge variant={sb.variant}>{sb.label}</Badge>
        {fk && <Badge variant={fk.variant}>{fk.label}</Badge>}
        <span className={cn("ml-auto font-semibold tabular-nums", nilai.pasti ? "text-ink" : "text-orange")} data-testid="nilai-pergerakan">{nilai.teks}</span>
      </div>
      {nilai.ket && <div className="mt-0.5 text-[11.5px] text-orange">{nilai.ket}</div>}
      <div className="mt-0.5 text-[11.5px] text-ink2">
        {r.status === "DINILAI" ? (
          <>
            Dasar harga {izinHarga ? `${teksRupiah(r.hargaDasar)} / ${r.satuan}` : "(disembunyikan)"} — rata-rata tertimbang per {wib(r.asOfDasar)}:{" "}
            {r.sumber.length === 0 ? "stok awal" : r.sumber.map((s, i) => <span key={i}>{i ? "; " : ""}{teksSumber(s, izinHarga)}</span>)}
            {r.sumberDipangkas > 0 && ` (+${r.sumberDipangkas} lot lain)`}
          </>
        ) : null}
        {r.faktur && izinHarga && r.faktur.selisih != null && r.faktur.selisih !== 0 && <> · selisih harga faktur {teksRupiah(r.faktur.selisih, { tanda: true })} (terpisah)</>}
        {r.catatan && <> · {r.catatan}</>}
        {r.jurnal === "BELUM_DIJURNAL" && <> · HPP belum dijurnal</>}
      </div>
    </div>
  );
}
