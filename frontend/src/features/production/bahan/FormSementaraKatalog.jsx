import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, parseJumlah, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import { ALASAN_KATALOG, ASAL_UMUM, STATUS_REKON } from "@/features/production/bahan/bahanModel.js";
import "@/features/production/bahan/bahan.css";

// "Catat sementara — stok belum diketahui": pemakaian bahan yang SUDAH ADA di katalog tetapi belum punya satu pun catatan stok (pemakaian resmi pasti ditolak: ledger 0).
// Tertaut ke ID bahan katalog (POST /production/units/:id/provisional-usages dengan materialId); nama + satuan dari katalog dan TERKUNCI. Wajib: jumlah, asal barang, alasan.
// Status "Perlu rekonsiliasi Gudang" sebelum konfirmasi dan sesudah simpan. BUKAN Material Issue: stok, biaya, jurnal tidak berubah. Satu niat = satu Idempotency-Key (klik ganda/retry tidak menggandakan).
// Server menolak bila stok bahan ternyata sudah diketahui (BAHAN_STOK_DIKETAHUI): pesan menjelaskan jalur resminya.
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export default function FormSementaraKatalog({ unitId, kodeUnit, bahan, qtyAwal = "", onSelesai, onBatal, onBukanBahanIni = null, alasanPembetulan = "" }) { // alasanPembetulan: hanya untuk unit TERKIRIM (pembetulan; server mewajibkan)
  const [qty, setQty] = useState(qtyAwal); const [asal, setAsal] = useState(""); const [alasan, setAlasan] = useState(ALASAN_KATALOG[0].key); const [alasanLain, setAlasanLain] = useState(""); const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [hasil, setHasil] = useState(null);
  const kunciRef = useRef(null); const sidikRef = useRef(""); const kirimRef = useRef(false);
  const jumlah = parseJumlah(qty);
  const teksAlasan = alasan === "LAINNYA" ? alasanLain.trim() : (ALASAN_KATALOG.find((a) => a.key === alasan)?.teks ?? "");
  const valid = !!bahan?.materialId && jumlah !== null && jumlah > 0 && asal.trim().length >= 2 && teksAlasan.length >= 3;
  const sidik = `${bahan?.materialId}|${jumlah}|${asal.trim()}|${teksAlasan}|${catatan.trim()}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; } // isian berubah = niat baru; isian sama = kunci sama (klik ulang/retry)

  async function catat() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    kunciRef.current ??= kunciIdempoten("sementara-katalog");
    try {
      const r = await api.catatPemakaianSementara(unitId, { materialId: bahan.materialId, qty: jumlah, uom: bahan.satuan, originNote: asal.trim(), alasanPencatatan: teksAlasan, note: catatan.trim() || undefined, ...(alasanPembetulan ? { alasanPembetulan } : {}) }, kunciRef.current);
      setHasil(r); await onSelesai?.();
    } catch (e) { setGalat(e); } finally { kirimRef.current = false; setSibuk(false); }
  }

  if (hasil) {
    const it = hasil.item;
    return (
      <div role="status" data-testid="katalog-hasil" className="space-y-2 rounded-card border border-line px-4 py-4">
        <div className="space-y-1 rounded-btn bg-greenbg px-3 py-3 text-[13px] text-green">
          <p className="m-0 flex items-start gap-2 font-medium"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />Tercatat sebagai <b>Pemakaian sementara — {STATUS_REKON}</b>: {formatJumlah(it.qty)} {it.uom} {it.name}.</p>
          <p className="m-0 pl-6 text-ink2" data-testid="status-rekon-sesudah">Status: <b>{STATUS_REKON}</b>. Stok Gudang <b>tidak</b> berubah dan tidak ada Material Issue, pergerakan, biaya, atau jurnal. Bahan katalog {it.bahanKatalog?.kode ?? bahan.kode}; Gudang menindaklanjuti lewat jalur stok resmi (stok awal/opname → pengeluaran resmi → tautkan).</p>
          <p className="m-0 pl-6 text-ink2" data-testid="hasil-asal">Asal barang untuk Gudang: {it.originNote}</p>
          <p className="m-0 pl-6 text-ink2" data-testid="hasil-alasan">{it.note}</p>
        </div>
        <div className="flex justify-end"><Button className="min-h-[44px]" data-testid="katalog-selesai" onClick={onBatal}>Selesai</Button></div>
      </div>
    );
  }
  const g = galat ? pesanGalatAdopsi(galat) : null;
  return (
    <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="form-sementara-katalog">
      <p className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="status-rekon-sebelum"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span>Status setelah disimpan: <b>{STATUS_REKON}</b> untuk unit {kodeUnit || "ini"}. Hanya mencatat fakta: stok tidak berkurang, tidak ada Material Issue, biaya, atau jurnal. Tidak perlu membuat stok.</span></p>
      <div className="rounded-btn bg-inset px-3 py-2 text-[13px] text-ink" data-testid="katalog-bahan-terkunci">
        <p className="m-0 font-medium">{bahan.nama} <span className="font-normal text-ink3">({bahan.kode})</span></p>
        <p className="m-0 text-[12px] text-ink2">Satuan {bahan.satuan} · Stok belum diketahui (belum punya catatan stok di Gudang). Bahan dan satuan mengikuti katalog.</p>
      </div>
      <label className="block"><span className="mb-1 block text-[12px] text-ink3">Jumlah dipakai ({bahan.satuan})</span>
        <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="katalog-qty" placeholder="0" className={cn(kolom, "text-right tabular-nums")} /></label>
      <div>
        <span className="mb-1 block text-[12px] text-ink3">Asal barang (wajib — Gudang perlu tahu dari mana bahan ini diperoleh)</span>
        <div className="mb-1 flex flex-wrap gap-1" role="group" aria-label="Asal barang">
          {ASAL_UMUM.map((a) => <button key={a} type="button" aria-pressed={asal === a} onClick={() => setAsal(asal === a ? "" : a)} className={cn("min-h-[40px] rounded-chip px-3 text-[12.5px] font-medium", asal === a ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{a}</button>)}
        </div>
        <input value={asal} onChange={(e) => setAsal(e.target.value)} maxLength={300} data-testid="katalog-asal" placeholder="atau tulis sendiri (mis. sisa potongan dari meja 2)" className={kolom} />
      </div>
      <fieldset className="space-y-1 rounded-btn border border-line px-3 py-2" data-testid="katalog-alasan">
        <legend className="px-1 text-[12.5px] font-semibold text-ink">Alasan dicatat sementara (Gudang membaca ini)</legend>
        {ALASAN_KATALOG.map((a) => <label key={a.key} className="flex min-h-[40px] items-start gap-2 py-2 text-[13px] text-ink"><input type="radio" name="katalog-alasan" value={a.key} checked={alasan === a.key} onChange={() => setAlasan(a.key)} data-testid={`katalog-alasan-${a.key}`} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent,#2563eb)]" />{a.label}</label>)}
        {alasan === "LAINNYA" && <input value={alasanLain} onChange={(e) => setAlasanLain(e.target.value)} maxLength={200} data-testid="katalog-alasan-lain" placeholder="Tulis alasannya (min. 3 huruf)" className={kolom} />}
      </fieldset>
      <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} aria-label="Catatan (opsional)" data-testid="katalog-catatan" placeholder="Catatan (opsional)" className={kolom} />
      {valid && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink" data-testid="katalog-ringkasan"><b>Akan dicatat:</b> {formatJumlah(jumlah)} {bahan.satuan} {bahan.nama} → Pemakaian sementara · {STATUS_REKON}. Asal: {asal.trim()}. Stok Gudang tidak berubah.</p>}
      {g && <p role="alert" data-testid="katalog-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{g.teks} {g.jenis === "jaringan" ? "Isian tetap di layar; coba lagi (tidak akan tercatat dua kali)." : ""}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBukanBahanIni ? <Button variant="tertiary" className="min-h-[44px]" data-testid="katalog-bukan-bahan-ini" onClick={onBukanBahanIni}>Yang saya pakai bukan bahan ini</Button> : <span />}
        <div className="flex w-full items-stretch gap-2 sm:w-auto">
          <Button variant="neutral" className="min-h-[44px] shrink-0" onClick={onBatal} disabled={sibuk}>Batal</Button>
          <Button className="bh-cta min-h-[44px] min-w-0 flex-1 !h-auto whitespace-normal py-2 leading-tight" data-testid="katalog-simpan" disabled={sibuk || !valid} onClick={catat}>{sibuk ? "Menyimpan…" : "Catat sementara — stok belum diketahui"}</Button>
        </div>
      </div>
    </div>
  );
}
