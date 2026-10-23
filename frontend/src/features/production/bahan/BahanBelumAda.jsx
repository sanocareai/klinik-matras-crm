import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, parseJumlah, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import { ASAL_UMUM, CATATAN_SEMENTARA, KELOMPOK_USULAN, SATUAN_KOMPONEN, STATUS_REKON } from "@/features/production/bahan/bahanModel.js";
import "@/features/production/bahan/bahan.css";

// "Bahan belum ada di katalog" — SATU formulir untuk dua jalur resmi yang sudah live:
//   (a) Pemakaian sementara (POST /production/units/:id/provisional-usages): fakta bahan yang SUDAH dipakai; BUKAN Material Issue — stok, biaya, jurnal tidak berubah; status "Perlu rekonsiliasi Gudang".
//   (b) Usulan bahan ke Gudang (POST /production/material-proposals): hanya baris usulan, tanpa saldo/penerimaan/pergerakan/biaya/jurnal; Gudang yang memutuskan dan memberi kode.
// Urutan kirim: usulan dulu (bila dipilih), lalu pemakaian sementara bertaut ke usulan itu. Gagal di tengah → usulan yang sudah terkirim TIDAK dikirim ulang; hanya pemakaian yang dicoba lagi (Idempotency-Key per niat).
// Status "Perlu rekonsiliasi Gudang" ditampilkan SEBELUM konfirmasi (ringkasan) dan SESUDAH tersimpan.
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export default function BahanBelumAda({ unitId, kodeUnit, izin = {}, awalNama = "", awalSatuan = "PCS", onTutup, onGunakanKatalog, onDone }) {
  const bolehSementara = !!izin.catatPemakaianSementara; const bolehUsul = !!izin.usulBahan;
  const [nama, setNama] = useState(awalNama); const [qty, setQty] = useState(""); const [satuan, setSatuan] = useState(awalSatuan); const [kelompok, setKelompok] = useState("");
  const [asal, setAsal] = useState(""); const [catatan, setCatatan] = useState(""); const [usulkan, setUsulkan] = useState(bolehUsul);
  const [kembar, setKembar] = useState({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); const [bedaDariMirip, setBedaDariMirip] = useState(false);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [usulan, setUsulan] = useState(null); const [hasil, setHasil] = useState(null);
  const kirimRef = useRef(false); const reqRef = useRef(0); const kunciRef = useRef(null); const sidikRef = useRef("");

  // periksa duplikasi saat mengetik (ditunda 350 ms); hasil basi dibuang. Setelah usulan terkirim, nama dikunci dan pemeriksaan dihentikan.
  useEffect(() => {
    const n = nama.trim();
    if (usulan || n.length < 3) { setKembar({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); return undefined; }
    const id = ++reqRef.current; setKembar((k) => ({ ...k, memuat: true }));
    const t = setTimeout(async () => {
      try { const d = await api.cekKembarBahan(n); if (id === reqRef.current) { setKembar({ ...d, memuat: false }); setBedaDariMirip(false); } } catch { if (id === reqRef.current) setKembar({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); }
    }, 350);
    return () => clearTimeout(t);
  }, [nama, usulan]);

  const jumlah = parseJumlah(qty);
  // Nama yang SUDAH ada di katalog/usulan terbuka: tidak diusulkan lagi (usulan dilewati otomatis), tetapi fakta pemakaian sementara tetap boleh dicatat (mis. bahan ada di katalog namun stoknya belum tercatat).
  const sudahAda = !usulan && kembar.adaSama;
  const usulkanEfektif = usulkan && !sudahAda;
  const perluKonfirmasiMirip = usulkanEfektif && !usulan && kembar.adaMirip;
  const namaOk = nama.trim().length >= 3;
  const usulanOk = !usulkanEfektif || !!usulan || (!!kelompok && !!satuan && (!perluKonfirmasiMirip || bedaDariMirip));
  const sementaraOk = !bolehSementara || (jumlah !== null && jumlah > 0);
  const valid = namaOk && usulanOk && sementaraOk && (bolehSementara || usulkanEfektif);
  const sidik = `${nama.trim()}|${jumlah}|${satuan}|${asal.trim()}|${catatan.trim()}|${usulan?.id || ""}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; } // isian berubah = niat baru; isian sama = kunci sama (klik ulang/retry)

  async function kirim() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null);
    let dibuat = usulan;
    try {
      if (usulkanEfektif && !dibuat) {
        const r = await api.ajukanBahanBaru({ name: nama.trim(), unit: satuan, kelompok, description: catatan.trim() || undefined, unitId }, perluKonfirmasiMirip && bedaDariMirip);
        dibuat = r.usulan; setUsulan(r.usulan);
      }
      if (bolehSementara) {
        kunciRef.current ??= kunciIdempoten("sementara");
        const r = await api.catatPemakaianSementara(unitId, { name: (dibuat?.name ?? nama.trim()), qty: jumlah, uom: dibuat?.unit ?? satuan, originNote: asal.trim() || undefined, note: catatan.trim() || undefined, proposalId: dibuat?.id || undefined }, kunciRef.current);
        setHasil({ sementara: r.item, usulan: dibuat });
      } else setHasil({ sementara: null, usulan: dibuat });
      await onDone?.();
    } catch (e) {
      setGalat(e);
      if (e.detail?.kandidat) setKembar((k) => ({ ...k, kandidat: e.detail.kandidat, adaSama: e.code === "BAHAN_SUDAH_ADA" || k.adaSama, adaMirip: true }));
    } finally { kirimRef.current = false; setSibuk(false); }
  }

  if (hasil) {
    return (
      <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="bahan-belum-ada">
        {hasil.sementara && (
          <div role="status" data-testid="sementara-hasil" className="space-y-1 rounded-btn bg-greenbg px-3 py-3 text-[13px] text-green">
            <p className="m-0 flex items-start gap-2 font-medium"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />Tercatat sebagai <b>Pemakaian sementara — {STATUS_REKON}</b>: {formatJumlah(hasil.sementara.qty)} {hasil.sementara.uom} {hasil.sementara.name}.</p>
            <p className="m-0 pl-6 text-ink2" data-testid="status-rekon-sesudah">Status: <b>{STATUS_REKON}</b>. Stok Gudang <b>tidak</b> berubah dan tidak ada Material Issue, biaya, atau jurnal. Gudang menyelesaikan sumber stoknya lewat jalur resmi.</p>
          </div>
        )}
        {hasil.usulan && (
          <p role="status" data-testid="usulan-hasil" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[13px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /><span><b>{hasil.usulan.name}</b> sudah diusulkan ke Gudang — status: <b>{hasil.usulan.statusLabel}</b>. Ini hanya usulan: tidak ada saldo, penerimaan, pergerakan stok, biaya, atau jurnal.</span></p>
        )}
        <div className="flex justify-end"><Button className="min-h-[44px]" data-testid="usulan-selesai" onClick={onTutup}>Selesai</Button></div>
      </div>
    );
  }

  const g = galat ? pesanGalatAdopsi(galat) : null;
  const ringkasan = [
    bolehSementara ? `${formatJumlah(jumlah ?? 0)} ${satuan} ${nama.trim() || "(nama bahan)"} → Pemakaian sementara · ${STATUS_REKON}` : null,
    usulkanEfektif ? (usulan ? "Usulan ke Gudang sudah terkirim" : "Usulan bahan ke Gudang dikirim bersamaan") : sudahAda ? "Tidak diusulkan lagi (nama sudah ada)" : null,
  ].filter(Boolean);
  return (
    <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="bahan-belum-ada">
      {bolehSementara && (
        <p className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="status-rekon-sebelum"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span>Status setelah disimpan: <b>{STATUS_REKON}</b> untuk unit {kodeUnit || "ini"}. {CATATAN_SEMENTARA} Tidak perlu membuat stok atau Material Issue.</span></p>
      )}
      {!bolehSementara && <p className="m-0 text-[12.5px] text-ink2">Akun Anda bisa <b>mengusulkan</b> bahan ke Gudang, tetapi tidak mencatat pemakaian sementara. Usulan tidak menambah saldo, pergerakan stok, biaya, atau jurnal.</p>}

      <label className="block"><span className="mb-1 block text-[12px] text-ink3">Nama bahan yang dipakai</span>
        <input value={nama} onChange={(e) => setNama(e.target.value)} readOnly={!!usulan} maxLength={120} data-testid="usulan-nama" placeholder="mis. Lem kontak impor 5 liter" className={cn(kolom, usulan && "bg-inset")} /></label>
      {kembar.memuat && <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink3"><Search size={13} aria-hidden />Memeriksa nama yang sama…</p>}
      {kembar.kandidat.length > 0 && !usulan && (
        <div role="status" data-testid="usulan-kembar" className={cn("space-y-2 rounded-btn px-3 py-2", kembar.adaSama ? "bg-redbg" : "bg-orangebg")}>
          <p className="m-0 text-[12.5px] font-semibold text-ink">{kembar.adaSama ? (bolehSementara ? "Sudah ada — tidak diusulkan lagi. Bila stoknya ada, lebih baik pakai bahan itu; bila belum ada stok, pemakaian tetap bisa dicatat sementara:" : "Sudah ada — tidak perlu diusulkan lagi:") : "Ada yang mirip. Periksa dulu:"}</p>
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

      <div className="flex gap-2">
        {bolehSementara && <label className="flex-1"><span className="mb-1 block text-[12px] text-ink3">Jumlah dipakai</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="sementara-qty" placeholder="0" className={cn(kolom, "text-right tabular-nums")} /></label>}
        <label className="w-36"><span className="mb-1 block text-[12px] text-ink3">Satuan</span>
          <select value={satuan} onChange={(e) => setSatuan(e.target.value)} disabled={!!usulan} data-testid="usulan-satuan" className={cn(kolom, "pr-1")}>{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </div>

      {bolehSementara && (
        <div>
          <span className="mb-1 block text-[12px] text-ink3">Asal barang (yang diketahui)</span>
          <div className="mb-1 flex flex-wrap gap-1" role="group" aria-label="Asal barang">
            {ASAL_UMUM.map((a) => <button key={a} type="button" aria-pressed={asal === a} onClick={() => setAsal(asal === a ? "" : a)} className={cn("min-h-[40px] rounded-chip px-3 text-[12.5px] font-medium", asal === a ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{a}</button>)}
          </div>
          <input value={asal} onChange={(e) => setAsal(e.target.value)} maxLength={300} data-testid="sementara-asal" placeholder="atau tulis sendiri (mis. beli di Toko Jaya, Pasar Kosambi)" className={kolom} />
        </div>
      )}

      {bolehUsul && !sudahAda && (
        <div className="space-y-2 rounded-btn border border-line px-3 py-2">
          <label className="flex items-start gap-2 text-[13px] text-ink"><input type="checkbox" checked={usulkan} onChange={(e) => setUsulkan(e.target.checked)} disabled={!!usulan || !bolehSementara} data-testid="usulan-centang" className="mt-0.5 h-5 w-5" /><span><b>Usulkan juga ke Gudang</b> agar bahan ini masuk katalog (disarankan). Hanya usulan — Gudang yang memutuskan dan memberi kode bahan.</span></label>
          {usulkanEfektif && !usulan && (
            <div>
              <span className="mb-1 block text-[12px] text-ink3">Kategori (sama dengan katalog Gudang)</span>
              <div role="radiogroup" aria-label="Kategori bahan" className="flex flex-wrap gap-1">
                {KELOMPOK_USULAN.map((k) => <button key={k.kode} type="button" role="radio" aria-checked={kelompok === k.kode} data-testid={`usulan-kelompok-${k.kode}`} onClick={() => setKelompok(k.kode)} className={cn("min-h-[40px] rounded-chip px-3 text-[13px] font-medium", kelompok === k.kode ? "bh-chip-on bg-accent text-white" : "bg-inset text-ink hover:bg-hovertint")}>{k.label}</button>)}
              </div>
            </div>
          )}
          {usulan && <p className="m-0 text-[12.5px] text-green" data-testid="usulan-terkirim">Usulan <b>{usulan.name}</b> sudah terkirim ke Gudang ({usulan.statusLabel}). Hanya pemakaian yang masih dicoba.</p>}
        </div>
      )}

      <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={500} aria-label="Catatan (opsional)" data-testid="sementara-catatan" placeholder="Catatan atau keterangan (opsional): ukuran, merek, kegunaan" className={kolom} />

      {!bolehSementara && sudahAda && <p role="alert" data-testid="usulan-sudah-ada" className="m-0 text-[12.5px] text-red">Bahan ini sudah ada, jadi tidak bisa diusulkan lagi. Pilih bahan itu dari “Bahan dari Gudang”.</p>}
      {valid && ringkasan.length > 0 && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink" data-testid="belum-ada-ringkasan"><b>Akan dicatat:</b> {ringkasan.join(" · ")}. Stok Gudang tidak berubah.</p>}
      {g && <p role="alert" data-testid="usulan-galat" className="m-0 text-[12.5px] text-red">{g.teks} {usulan ? "Usulan sudah terkirim; hanya pemakaian yang diulang." : ""} {g.jenis === "jaringan" ? "Isian tetap di layar; coba lagi (tidak akan tercatat dua kali)." : ""}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>Batal</Button>
        <Button className="bh-cta min-h-[44px]" data-testid="usulan-kirim" disabled={sibuk || !valid} onClick={kirim}>{sibuk ? "Menyimpan…" : bolehSementara ? (usulkan && !usulan ? "Catat sementara & usulkan ke Gudang" : "Catat pemakaian sementara") : "Usulkan ke Gudang"}</Button>
      </div>
    </div>
  );
}
