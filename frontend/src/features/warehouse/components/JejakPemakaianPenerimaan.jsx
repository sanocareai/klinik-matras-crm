import React, { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { teksQty } from "@/features/finance/biayaBahanLogic.js";

// Progres penerimaan di Gudang: Diterima → Diperiksa → Simpan ke Stok → Dipakai Produksi / Tersisa. Murni baca.
// Harga TIDAK ditampilkan di sini (kebijakan Gudang: tanpa nominal); server hanya mengirim nilai bila pengguna punya izin Finance.
// "Dipakai / Tersisa" adalah porsi penerimaan ini menurut rata-rata tertimbang yang dibekukan saat Material Issue — bukan penunjukan lot fisik.
export default function JejakPemakaianPenerimaan({ receiptId, status }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  useEffect(() => {
    let batal = false;
    setD(null); setGalat("");
    api.getJejakPemakaianPenerimaan(receiptId).then((r) => { if (!batal) setD(r); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat progres"); });
    return () => { batal = true; };
  }, [receiptId, status]);

  if (galat) return <p role="alert" className="text-[12px] text-red">{galat}</p>;
  if (!d) return <p className="text-[12px] text-ink3">Memuat progres…</p>;
  return (
    <section data-testid="progres-penerimaan" aria-label="Progres penerimaan" className="space-y-2.5">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-1 p-0 text-[12px]" data-testid="langkah-penerimaan">
        {d.langkah.map((l, i) => (
          <li key={l.kunci} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 text-ink3" aria-hidden>→</span>}
            {l.selesai ? <Check size={13} className="text-green" aria-hidden /> : <Circle size={11} className="text-ink3" aria-hidden />}
            <span className={cn(l.selesai ? "font-semibold text-ink" : "text-ink3")}>{l.nama}</span>
          </li>
        ))}
      </ol>
      {d.bahan.map((b) => (
        <div key={b.materialId} className="rounded-btn bg-inset px-3 py-2 text-[12px]" data-testid="progres-bahan">
          <div className="font-semibold text-ink">{b.kode} <span className="font-normal text-ink2">{b.nama}</span></div>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-ink2 sm:grid-cols-4">
            <span>Datang <strong className="tabular-nums text-ink">{teksQty(b.diterima)}</strong></span>
            <span>Baik <strong className="tabular-nums text-ink">{teksQty(b.baik)}</strong> · ditolak <strong className="tabular-nums text-ink">{teksQty(b.ditolak)}</strong></span>
            <span title="Bruto: yang disimpan ke stok dari penerimaan ini">Masuk stok <strong className="tabular-nums text-ink">{teksQty(b.masukStok)}</strong></span>
            <span title="Retur Supplier untuk kredit yang barangnya sudah keluar gudang">Diretur ke supplier <strong className="tabular-nums text-ink" data-testid="diretur-supplier">{teksQty(b.returSupplier ?? 0)}</strong></span>
            <span title="Masuk stok dikurangi diretur ke supplier, sebelum dipakai Produksi">Stok bersih <strong className="tabular-nums text-ink" data-testid="stok-bersih">{teksQty(b.stokBersih ?? b.masukStok)}</strong></span>
            <span>Lokasi <strong className="text-ink">{b.lokasi || "—"}</strong></span>
            <span>Dipakai Produksi <strong className="tabular-nums text-ink">{teksQty(b.dipakaiProduksi)}</strong></span>
            <span>Waste <strong className="tabular-nums text-ink">{teksQty(b.waste)}</strong></span>
            <span title="Barang yang dikembalikan Produksi ke gudang">Retur dari Produksi <strong className="tabular-nums text-ink">{teksQty(b.returDiterima)}</strong></span>
            <span>Tersisa <strong className="tabular-nums text-ink">{teksQty(b.tersisa)} {b.satuan}</strong></span>
          </div>
        </div>
      ))}
      {d.materialIssue.length > 0 && (
        <p className="m-0 text-[12px] text-ink2" data-testid="materialissue-pemakai">
          Material Issue yang memakai bahan ini:{" "}
          {d.materialIssue.map((m, i) => (
            <span key={m.materialIssueId}>{i ? ", " : ""}<Link to={`/warehouse/material-issue?buka=${m.materialIssueId}`} className="font-mono text-accent hover:underline">{m.nomor}</Link>{m.unitCode ? ` (${m.unitCode}, ${teksQty(m.qty)})` : ""}</span>
          ))}
        </p>
      )}
      {d.returDariProduksi.length > 0 && (
        <p className="m-0 text-[12px] text-ink2">Retur dari Produksi yang sudah diterima kembali: {d.returDariProduksi.map((r) => `${r.unitCode ?? "—"} ${teksQty(r.qty)}`).join(", ")}</p>
      )}
      <p className="m-0 text-[11px] leading-snug text-ink3">{d.catatan}</p>
    </section>
  );
}
