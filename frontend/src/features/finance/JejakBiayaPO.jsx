import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge.jsx";
import { api } from "@/api.js";
import { teksQty, teksRupiah } from "@/features/finance/biayaBahanLogic.js";

// Panel "Jejak Biaya Bahan" pada detail PO (Finance). Murni baca: nilai diterima, dipakai Produksi, retur, waste, selisih harga faktur — sampai ke unit.
// Porsi per PO dihitung dari dasar harga yang DIBEKUKAN saat Material Issue (bukan harga master terkini). Selisih harga faktur tidak mengubah nilai pemakaian historis.
const nilai = (n, opsi) => teksRupiah(n, opsi) ?? "—";

export default function JejakBiayaPO({ poId, segar = 0 }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  useEffect(() => {
    let batal = false;
    setGalat("");
    api.getBiayaBahanPO(poId).then((r) => { if (!batal) setD(r); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat jejak biaya bahan"); });
    return () => { batal = true; };
  }, [poId, segar]);

  if (galat) return <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>;
  if (!d) return <p className="text-[12.5px] text-ink3">Memuat jejak biaya bahan…</p>;
  const r = d.ringkasan;
  const kartu = [
    ["Nilai diterima (harga PO)", nilai(r.nilaiDiterima), "Barang baik yang sudah masuk stok"],
    ["Dipakai Produksi", nilai(r.nilaiDipakai), "Material Issue, harga saat diposting"],
    ["Retur diterima Gudang", r.nilaiRetur ? `−${nilai(r.nilaiRetur)}` : nilai(r.nilaiRetur), "Mengurangi biaya"],
    ["Waste (terpisah)", nilai(r.nilaiWaste), "Susut, tidak digabung dengan retur"],
    ["Selisih harga faktur", nilai(r.selisihHargaFaktur, { tanda: true }), "Faktur − harga PO, di luar nilai pemakaian"],
  ];
  return (
    <section data-testid="jejak-biaya-po" className="space-y-2" aria-label="Jejak biaya bahan PO">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {kartu.map(([judul, isi, sub]) => (
          <div key={judul} className="rounded-btn bg-inset px-3 py-2">
            <div className="text-[11px] text-ink3">{judul}</div>
            <div className="text-[14px] font-bold tabular-nums text-ink">{isi}</div>
            <div className="text-[11px] text-ink2">{sub}</div>
          </div>
        ))}
      </div>
      {r.jumlahTanpaHarga > 0 && (
        <div className="flex items-start gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="po-tanpa-harga">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {r.jumlahTanpaHarga} pergerakan bahan dari PO ini pernah keluar tanpa harga perolehan ({d.bahanTanpaHarga.map((b) => b.kode).join(", ")}) — tidak dihitung, bukan Rp0.
          </span>
        </div>
      )}
      {d.unit.length === 0 ? (
        <p className="text-[12.5px] text-ink3">Belum ada bahan dari PO ini yang dipakai Produksi.</p>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0">
          {d.unit.map((u) => (
            <li key={u.unitId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-btn border border-line px-3 py-1.5 text-[12.5px]">
              <Link to={`/finance/biaya-bahan?buka=${u.unitId}`} className="font-mono text-[12px] font-semibold text-accent hover:underline">{u.unitCode}</Link>
              <span className="text-ink3">{u.orderNumber || "tanpa order"}</span>
              <span className="ml-auto tabular-nums text-ink">dipakai {teksQty(u.dipakai.qty)} · {nilai(u.dipakai.nilai)}</span>
              {u.retur.qty > 0 && <Badge variant="green">retur {teksQty(u.retur.qty)}</Badge>}
              {u.waste.qty > 0 && <Badge variant="orange">waste {teksQty(u.waste.qty)}</Badge>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-snug text-ink3">{r.catatan}</p>
    </section>
  );
}
