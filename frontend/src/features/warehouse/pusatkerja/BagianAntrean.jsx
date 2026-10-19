import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import KartuPekerjaan from "./KartuPekerjaan.jsx";
import { barisDefinisi } from "./urlFokus.js";

/**
 * Satu antrean (atau satu sebab tertahan) di Beranda: judul + jumlah (dengan satuan hitung yang jujur: dokumen atau baris) + Definisi + kartu pekerjaan + "Tampilkan lagi".
 * Halaman berikutnya diambil dari server (offset/limit) — daftar tidak pernah dipotong diam-diam; sisa selalu disebut.
 */
export default function BagianAntrean({ antrean, ambilLagi, onBuka, tampilSebab = false, versi }) {
  const [tambahan, setTambahan] = useState([]); const [memuat, setMemuat] = useState(false); const [galat, setGalat] = useState(""); const [sisa, setSisa] = useState(antrean.lebih);
  useEffect(() => { setTambahan([]); setSisa(antrean.lebih); setGalat(""); }, [versi, antrean.kode, antrean.lebih]);
  const item = [...antrean.item, ...tambahan];
  const lagi = async () => {
    setMemuat(true); setGalat("");
    try { const d = await ambilLagi(antrean.kode, { offset: item.length, limit: 20 }); setTambahan((t) => [...t, ...d.item]); setSisa(d.lebih); } catch (e) { setGalat(e.message || "Gagal memuat"); } finally { setMemuat(false); }
  };
  const def = barisDefinisi(antrean.definisi);
  return (
    <section className="space-y-2" aria-label={antrean.judul} data-testid={`antrean-${antrean.kode}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[14px] font-semibold text-ink">{antrean.judul}</h3>
        <Badge variant={tampilSebab ? "orange" : "accent"} data-testid="jumlah-antrean">{antrean.jumlah} {antrean.satuanHitung ?? antrean.definisi?.satuan ?? "dokumen"}</Badge>
      </div>
      {def.length > 0 && (
        <details className="text-[12px] text-ink2" data-testid="definisi-antrean">
          <summary className="cursor-pointer select-none font-semibold text-accent max-sm:flex max-sm:min-h-11 max-sm:items-center">Definisi antrean ini</summary>
          <dl className="m-0 mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 rounded-btn bg-inset p-3 sm:grid-cols-[170px_1fr]">
            {def.map(([k, v]) => <React.Fragment key={k}><dt className="font-semibold text-ink3">{k}</dt><dd className="m-0">{v}</dd></React.Fragment>)}
          </dl>
        </details>
      )}
      <ul className="m-0 list-none space-y-2 p-0">{item.map((i) => <KartuPekerjaan key={i.kunci} item={i} onBuka={onBuka} tampilSebab={tampilSebab} />)}</ul>
      {galat && <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>}
      {sisa > 0 && (
        <Button variant="secondary" size="sm" onClick={lagi} disabled={memuat} className="max-sm:min-h-11 max-sm:w-full" data-testid="tampilkan-lagi">
          {memuat ? <Loader2 size={14} className="animate-spin" /> : null} Tampilkan lagi ({sisa} lainnya)
        </Button>
      )}
    </section>
  );
}
