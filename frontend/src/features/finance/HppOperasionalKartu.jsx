import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { rp, rpNilai, tanggalJam, varianBukti } from "@/features/warehouse/stok/hargaBerlakuLogic.js";

// HPP OPERASIONAL (harga berlaku) — kartu TERPISAH dari "Biaya persediaan" Finance (biaya perolehan PSA/GR). Dua sumber, dua angka; tidak pernah dijumlahkan atau disamakan.
// Dibekukan saat pemakaian diposting pada harga yang berlaku di WAKTU PEMAKAIAN; pemakaian lama tanpa harga hanya diberi harga lewat penerapan khusus berpersetujuan (Stok → bahan → Harga Berlaku).
const STATUS = {
  PARSIAL: { teks: "Parsial", varian: "orange" }, LENGKAP_MENURUT_HARGA_BERLAKU: { teks: "Lengkap menurut harga berlaku", varian: "green" }, BELUM_ADA_PEMAKAIAN: { teks: "Belum ada pemakaian", varian: "neutral" },
};
const STATUS_BARIS = { DIBEKUKAN: "Dibekukan", DIBEKUKAN_TANPA_HARGA_BERLAKU: "Dibekukan tanpa harga", BELUM_DIBEKUKAN: "Belum dibekukan", GAGAL_PEMBEKUAN: "GAGAL membekukan — perlu diperbaiki" };

export default function HppOperasionalKartu({ h }) {
  const [buka, setBuka] = useState(false); const Ikon = buka ? ChevronDown : ChevronRight;
  if (!h) return null;
  const st = STATUS[h.status] ?? { teks: h.status, varian: "neutral" }; const r = h.ringkasan;
  const nBeku = h.baris.filter((b) => b.status === "DIBEKUKAN").length; // tidak ada Rp0 palsu: tanpa baris dibekukan → "Belum ada", bukan Rp0
  return (
    <section className="rounded-btn border border-line p-3" data-testid="hpp-operasional" aria-label="HPP operasional (harga berlaku)">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 text-[12.5px] font-bold text-ink">{h.judul}</h4><Badge variant={st.varian} data-testid="status-hpp-operasional">{st.teks}</Badge>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink2" data-testid="peringatan-hpp-operasional">{h.peringatan}</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-btn bg-inset px-3 py-2"><div className="text-[11px] text-ink3">HPP operasional dibekukan</div><div className="text-[15px] font-bold tabular-nums text-ink" data-testid="nilai-hpp-operasional">{nBeku > 0 ? rpNilai(r.hppOperasionalDibekukan) : "Belum ada"}</div><div className="text-[11.5px] text-ink2">{nBeku > 0 ? `${nBeku} pemakaian · harga berlaku × pemakaian aktual` : "Belum ada pemakaian yang dibekukan harganya"}</div></div>
        <div className="rounded-btn bg-inset px-3 py-2"><div className="text-[11px] text-ink3">Pemakaian tanpa harga operasional</div><div className={cn("text-[15px] font-bold tabular-nums", r.pemakaianTanpaHargaOperasional + r.pemakaianBelumDibekukan + (r.pemakaianGagalPembekuan ?? 0) > 0 ? "text-orange" : "text-ink")}>{r.pemakaianTanpaHargaOperasional + r.pemakaianBelumDibekukan + (r.pemakaianGagalPembekuan ?? 0)}</div><div className="text-[11.5px] text-ink2">bukan Rp0; butuh penerapan berpersetujuan</div></div>
        <div className="rounded-btn bg-inset px-3 py-2"><div className="text-[11px] text-ink3">Pratinjau belum memakai bahan</div><div className="text-[15px] font-bold tabular-nums text-ink">{h.belumMemakai.length > 0 ? rpNilai(r.pratinjauBelumMemakai) : "—"}</div><div className="text-[11.5px] text-ink2">harga terbaru; bukan nilai beku</div></div>
      </div>
      {h.belumMemakai.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11.5px] text-ink2" data-testid="belum-memakai">
          {h.belumMemakai.map((b) => <li key={b.kode}><b className="text-ink">{b.kode}</b> {b.qty} {b.satuan} ({b.asal}) — {b.hargaTerbaru != null ? <>pratinjau {rp(b.hargaTerbaru)}/{b.satuan} = {rpNilai(b.nilaiPratinjau)} <Badge variant={varianBukti(b.labelBukti)}>{b.teksLabelBukti}</Badge>{b.hargaTerjadwal ? ` · terjadwal ${rp(b.hargaTerjadwal.harga)} mulai ${tanggalJam(b.hargaTerjadwal.berlakuMulai)}` : ""}</> : "belum ada harga berlaku"}</li>)}
        </ul>
      )}
      {h.baris.length > 0 && (
        <button type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} className="mt-2 flex items-center gap-1 text-[12px] font-medium text-accent" data-testid="buka-baris-operasional"><Ikon size={13} aria-hidden /> Rincian per pergerakan ({h.baris.length})</button>
      )}
      {buka && (
        <div className="mt-1.5 space-y-1" data-testid="baris-operasional">
          {h.baris.map((b) => (
            <div key={b.movementId} className="rounded-btn bg-surface px-2.5 py-1.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-ink3">{tanggalJam(b.tanggal)}</span><span className="font-semibold text-ink">{b.kode}</span><span className="tabular-nums">{Math.abs(b.qty)} {b.satuan}</span>
                <Badge variant={b.status === "DIBEKUKAN" ? "green" : "orange"}>{STATUS_BARIS[b.status]}</Badge>{b.teksLabelBukti && <Badge variant={varianBukti(b.labelBukti)}>{b.teksLabelBukti}</Badge>}
                <span className="basis-full text-[11.5px] text-ink3" data-testid="basis-harga">Dasar harga: {b.basisTeks}</span><span className="ml-auto font-semibold tabular-nums text-ink">{b.nilai != null ? `${rpNilai(b.nilai)} (${rp(b.harga)}/${b.satuan})` : b.pratinjau ? `pratinjau ${rpNilai(b.pratinjau.nilai)}` : "tanpa harga"}</span></div>
              {b.pratinjau && <div className="mt-0.5 text-[11.5px] text-orange">{b.pratinjau.ket}</div>}
              {b.sumber === "PENERAPAN_DISETUJUI" && <div className="mt-0.5 text-[11.5px] text-ink3">Diberi harga lewat penerapan khusus yang disetujui (bukan dibekukan saat posting).</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
