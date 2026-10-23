import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, parseJumlah, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import { ASAL_UMUM, CATATAN_SEMENTARA, DAMPAK_SEMENTARA, SATUAN_KOMPONEN, SUMBER_SEMENTARA } from "@/features/production/bahan/bahanModel.js";
import "@/features/production/bahan/bahan.css";

// Pemakaian SEMENTARA — fakta bahan yang SUDAH dipakai pada unit ini tetapi belum ada di katalog / belum punya sumber stok resmi.
// BUKAN Material Issue: stok tidak berkurang, tidak ada biaya/jurnal. Gudang menyelesaikannya kemudian ("Perlu rekonsiliasi Gudang").
// Satu niat = satu Idempotency-Key (klik ganda/retry tidak menggandakan catatan).
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export default function FormPemakaianSementara({ unitId, kodeUnit, awal = {}, onSelesai, onBatal }) {
  const terkunci = !!awal.proposalId; // nama + satuan mengikuti usulan
  const [nama, setNama] = useState(awal.name || ""); const [qty, setQty] = useState(""); const [uom, setUom] = useState(awal.uom || "PCS");
  const [asal, setAsal] = useState(""); const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [hasil, setHasil] = useState(null);
  const kunciRef = useRef(null); const sidikRef = useRef(""); const kirimRef = useRef(false);

  const jumlah = parseJumlah(qty);
  const valid = nama.trim().length >= 3 && jumlah !== null && jumlah > 0;
  const sidik = `${nama.trim()}|${jumlah}|${uom}|${asal.trim()}|${catatan.trim()}|${awal.proposalId || ""}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; } // isian berubah = niat baru; isian sama = kunci sama (klik ulang/retry)

  async function catat() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    kunciRef.current ??= kunciIdempoten("sementara");
    try {
      const r = await api.catatPemakaianSementara(unitId, { name: nama.trim(), qty: jumlah, uom, originNote: asal.trim() || undefined, note: catatan.trim() || undefined, proposalId: awal.proposalId || undefined }, kunciRef.current);
      setHasil(r);
      await onSelesai?.();
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }

  if (hasil) {
    return (
      <div role="status" data-testid="sementara-hasil" className="space-y-2 rounded-btn bg-greenbg px-3 py-3 text-[13px] text-green">
        <p className="m-0 flex items-start gap-2 font-medium"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />Tercatat sebagai <b>Pemakaian sementara — perlu rekonsiliasi Gudang</b>: {formatJumlah(hasil.item.qty)} {hasil.item.uom} {hasil.item.name}.</p>
        <p className="m-0 pl-6 text-ink2">Stok Gudang <b>tidak</b> berubah dan tidak ada biaya atau jurnal. Gudang akan menyelesaikan sumber stoknya lewat jalur resmi.</p>
        <div className="flex justify-end"><Button className="min-h-[44px]" onClick={onBatal}>Selesai</Button></div>
      </div>
    );
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  return (
    <div className="space-y-3" data-testid="form-sementara">
      <p className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span><b>{SUMBER_SEMENTARA.label}</b> untuk unit {kodeUnit || "ini"}. {CATATAN_SEMENTARA}</span></p>
      <label className="block"><span className="mb-1 block text-[12px] text-ink3">Nama bahan yang dipakai</span>
        <input value={nama} onChange={(e) => setNama(e.target.value)} readOnly={terkunci} maxLength={120} data-testid="sementara-nama" placeholder="mis. Lem kontak impor 5 liter" className={cn(kolom, terkunci && "bg-inset")} /></label>
      <div className="flex gap-2">
        <label className="flex-1"><span className="mb-1 block text-[12px] text-ink3">Jumlah dipakai</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="sementara-qty" placeholder="0" className={cn(kolom, "text-right tabular-nums")} /></label>
        <label className="w-32"><span className="mb-1 block text-[12px] text-ink3">Satuan</span>
          <select value={uom} onChange={(e) => setUom(e.target.value)} disabled={terkunci} data-testid="sementara-satuan" className={cn(kolom, "pr-1")}>{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </div>
      <div>
        <span className="mb-1 block text-[12px] text-ink3">Asal barang (yang diketahui)</span>
        <div className="mb-1 flex flex-wrap gap-1" role="group" aria-label="Asal barang">
          {ASAL_UMUM.map((a) => <button key={a} type="button" aria-pressed={asal === a} onClick={() => setAsal(asal === a ? "" : a)} className={cn("min-h-[40px] rounded-chip px-3 text-[12.5px] font-medium", asal === a ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{a}</button>)}
        </div>
        <input value={asal} onChange={(e) => setAsal(e.target.value)} maxLength={300} data-testid="sementara-asal" placeholder="atau tulis sendiri (mis. beli di Toko Jaya, Pasar Kosambi)" className={kolom} />
      </div>
      <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} aria-label="Catatan (opsional)" data-testid="sementara-catatan" placeholder="Catatan (opsional)" className={kolom} />
      <p className="m-0 text-[12px] text-ink3" data-testid="sementara-dampak">{DAMPAK_SEMENTARA}</p>
      {g && <p role="alert" data-testid="sementara-galat" className="m-0 text-[12.5px] text-red">{g.teks} {g.jenis === "jaringan" ? "Isian tetap di layar; coba lagi (tidak akan tercatat dua kali)." : ""}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" onClick={onBatal} disabled={sibuk}>Batal</Button>
        <Button className="bh-cta min-h-[44px]" data-testid="sementara-simpan" disabled={sibuk || !valid} onClick={catat}>{sibuk ? "Mencatat…" : "Catat pemakaian sementara"}</Button>
      </div>
    </div>
  );
}
