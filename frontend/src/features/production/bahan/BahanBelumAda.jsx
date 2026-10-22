import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, HelpCircle, Search } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import { KELOMPOK_USULAN, SATUAN_KOMPONEN } from "@/features/production/bahan/bahanModel.js";
import FormPemakaianSementara from "@/features/production/bahan/FormPemakaianSementara.jsx";
import "@/features/production/bahan/bahan.css";

// "Bahan belum ada?" — mengusulkan entri katalog ke Gudang. HANYA baris usulan: tidak membuat saldo, penerimaan, pergerakan stok, biaya, atau jurnal.
// Nama/kode diperiksa dulu terhadap katalog dan usulan terbuka (duplikasi). Bila bahannya sudah terlanjur dipakai, tersedia "Pemakaian sementara" (perlu rekonsiliasi Gudang).
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export default function BahanBelumAda({ unitId, kodeUnit, izin, awalNama = "", onTutup, onGunakanKatalog, onDone }) {
  const [tahap, setTahap] = useState("form"); // form | diajukan | sementara
  const [nama, setNama] = useState(awalNama); const [kelompok, setKelompok] = useState(""); const [satuan, setSatuan] = useState("PCS"); const [keterangan, setKeterangan] = useState("");
  const [kembar, setKembar] = useState({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); const [bedaDariMirip, setBedaDariMirip] = useState(false);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [usulan, setUsulan] = useState(null); const [sementaraAwal, setSementaraAwal] = useState(null);
  const kirimRef = useRef(false); const reqRef = useRef(0);

  // periksa duplikasi saat mengetik (ditunda 350 ms); hasil basi dibuang
  useEffect(() => {
    const n = nama.trim();
    if (n.length < 3) { setKembar({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); return undefined; }
    const id = ++reqRef.current; setKembar((k) => ({ ...k, memuat: true }));
    const t = setTimeout(async () => {
      try { const d = await api.cekKembarBahan(n); if (id === reqRef.current) { setKembar({ ...d, memuat: false }); setBedaDariMirip(false); } } catch { if (id === reqRef.current) setKembar({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); }
    }, 350);
    return () => clearTimeout(t);
  }, [nama]);

  const perluKonfirmasiMirip = kembar.adaMirip && !kembar.adaSama;
  const valid = nama.trim().length >= 3 && !!kelompok && !!satuan && !kembar.adaSama && (!perluKonfirmasiMirip || bedaDariMirip);

  async function ajukan() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    try {
      const r = await api.ajukanBahanBaru({ name: nama.trim(), unit: satuan, kelompok, description: keterangan.trim() || undefined, unitId }, perluKonfirmasiMirip && bedaDariMirip);
      setUsulan(r.usulan); setTahap("diajukan");
    } catch (e) {
      setGalat(e);
      if (e.detail?.kandidat) setKembar((k) => ({ ...k, kandidat: e.detail.kandidat, adaSama: e.code === "BAHAN_SUDAH_ADA" || k.adaSama, adaMirip: true }));
    } finally { kirimRef.current = false; setSibuk(false); }
  }

  if (tahap === "sementara") {
    return (
      <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="bahan-belum-ada">
        <h4 className="m-0 text-[14px] font-semibold text-ink">Catat pemakaian sementara</h4>
        <FormPemakaianSementara unitId={unitId} kodeUnit={kodeUnit} awal={sementaraAwal || { name: nama.trim() }} onSelesai={onDone} onBatal={onTutup} />
      </div>
    );
  }
  if (tahap === "diajukan" && usulan) {
    return (
      <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="bahan-belum-ada">
        <p role="status" data-testid="usulan-hasil" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[13px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /><span><b>{usulan.name}</b> sudah diusulkan ke Gudang — status: <b>{usulan.statusLabel}</b>. {usulan.diajukanOleh ? `Diajukan oleh ${usulan.diajukanOleh}. ` : ""}Ini hanya usulan: tidak menambah stok, penerimaan, biaya, atau jurnal. Gudang melihatnya di <b>Gudang › Usulan Bahan</b>.</span></p>
        {izin.catatPemakaianSementara && (
          <div className="rounded-btn border border-line px-3 py-2">
            <p className="m-0 text-[12.5px] text-ink">Bahan ini sudah terlanjur dipakai pada unit {kodeUnit}? Catat faktanya sekarang — stok tetap tidak berubah sampai Gudang menyelesaikannya.</p>
            <Button variant="secondary" className="mt-2 min-h-[44px]" data-testid="usulan-lanjut-sementara" onClick={() => { setSementaraAwal({ name: usulan.name, uom: usulan.unit, proposalId: usulan.id }); setTahap("sementara"); }}>Catat pemakaian sementara</Button>
          </div>
        )}
        <div className="flex justify-end"><Button variant="neutral" className="min-h-[44px]" onClick={onTutup} data-testid="usulan-selesai">Selesai</Button></div>
      </div>
    );
  }

  const g = galat ? pesanGalatAdopsi(galat) : null;
  return (
    <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="bahan-belum-ada">
      <h4 className="m-0 flex items-center gap-2 text-[14px] font-semibold text-ink"><HelpCircle size={16} className="text-ink3" aria-hidden />Bahan belum ada di katalog?</h4>
      <p className="m-0 text-[12.5px] text-ink2">Usulkan ke Gudang. Ini <b>hanya usulan</b> — tidak menambah saldo, penerimaan, pergerakan stok, biaya, atau jurnal. Gudang yang memutuskan dan menentukan kode bahannya.</p>
      <label className="block"><span className="mb-1 block text-[12px] text-ink3">Nama bahan</span>
        <input value={nama} onChange={(e) => setNama(e.target.value)} maxLength={120} data-testid="usulan-nama" placeholder="mis. Pegas spiral khusus orthopedic" className={kolom} /></label>
      {kembar.memuat && <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink3"><Search size={13} aria-hidden />Memeriksa nama yang sama…</p>}
      {kembar.kandidat.length > 0 && (
        <div role="status" data-testid="usulan-kembar" className={cn("space-y-2 rounded-btn px-3 py-2", kembar.adaSama ? "bg-redbg" : "bg-orangebg")}>
          <p className="m-0 text-[12.5px] font-semibold text-ink">{kembar.adaSama ? "Sudah ada — tidak perlu diusulkan lagi:" : "Ada yang mirip. Periksa dulu:"}</p>
          <ul className="m-0 list-none space-y-1 p-0">
            {kembar.kandidat.map((k, i) => (
              <li key={k.materialId || k.proposalId || i} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
                <span className="min-w-0 flex-1"><b>{k.nama}</b>{k.kode ? ` (${k.kode})` : ""} · {k.satuan} — {k.alasan}{k.jenis === "KATALOG" && k.aktif === false ? " · nonaktif" : ""}</span>
                {k.jenis === "KATALOG" && k.aktif !== false && onGunakanKatalog && <Button variant="secondary" size="sm" className="min-h-[40px]" onClick={() => onGunakanKatalog(k)}>Pakai bahan ini</Button>}
              </li>
            ))}
          </ul>
          {perluKonfirmasiMirip && <label className="flex items-start gap-2 text-[12.5px] text-ink"><input type="checkbox" checked={bedaDariMirip} onChange={(e) => setBedaDariMirip(e.target.checked)} data-testid="usulan-beda" className="mt-0.5 h-5 w-5" />Ini bahan yang berbeda dari yang mirip di atas.</label>}
        </div>
      )}
      <div>
        <span className="mb-1 block text-[12px] text-ink3">Kategori (sama dengan katalog Gudang)</span>
        <div role="radiogroup" aria-label="Kategori bahan" className="flex flex-wrap gap-1">
          {KELOMPOK_USULAN.map((k) => <button key={k.kode} type="button" role="radio" aria-checked={kelompok === k.kode} data-testid={`usulan-kelompok-${k.kode}`} onClick={() => setKelompok(k.kode)} className={cn("min-h-[40px] rounded-chip px-3 text-[13px] font-medium", kelompok === k.kode ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{k.label}</button>)}
        </div>
      </div>
      <div className="flex gap-2">
        <label className="w-36"><span className="mb-1 block text-[12px] text-ink3">Satuan</span>
          <select value={satuan} onChange={(e) => setSatuan(e.target.value)} data-testid="usulan-satuan" className={cn(kolom, "pr-1")}>{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="min-w-0 flex-1"><span className="mb-1 block text-[12px] text-ink3">Keterangan (opsional)</span>
          <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} maxLength={500} data-testid="usulan-keterangan" placeholder="ukuran, merek, kegunaan" className={kolom} /></label>
      </div>
      {g && <div role="alert" data-testid="usulan-galat" className="m-0 text-[12.5px] text-red"><p className="m-0">{g.teks}</p></div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {izin.catatPemakaianSementara ? <Button variant="tertiary" className="min-h-[44px]" data-testid="usulan-langsung-sementara" onClick={() => { setSementaraAwal({ name: nama.trim() }); setTahap("sementara"); }}>Sudah dipakai — catat tanpa usulan</Button> : <span />}
        <div className="flex gap-2">
          <Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>Batal</Button>
          <Button className="bh-cta min-h-[44px]" data-testid="usulan-kirim" disabled={sibuk || !valid} onClick={ajukan}>{sibuk ? "Mengirim…" : "Usulkan ke Gudang"}</Button>
        </div>
      </div>
    </div>
  );
}
