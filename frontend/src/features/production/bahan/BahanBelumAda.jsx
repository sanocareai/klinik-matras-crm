import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, kunciIdempoten, parseJumlah, pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";
import { ALASAN_SEMENTARA, ASAL_UMUM, CATATAN_SEMENTARA, KELOMPOK_USULAN, SATUAN_KOMPONEN, STATUS_REKON, susunCatatanRekon } from "@/features/production/bahan/bahanModel.js";
import "@/features/production/bahan/bahan.css";

// "Bahan belum ada di katalog" — SATU formulir untuk dua jalur resmi yang sudah live:
//   (a) Pemakaian sementara (POST /production/units/:id/provisional-usages): fakta bahan yang SUDAH dipakai; BUKAN Material Issue — stok, biaya, jurnal tidak berubah; status "Perlu rekonsiliasi Gudang".
//   (b) Usulan bahan ke Gudang (POST /production/material-proposals): hanya baris usulan, tanpa saldo/penerimaan/pergerakan/biaya/jurnal; Gudang yang memutuskan dan memberi kode.
// Urutan kirim: usulan dulu (bila dipilih), lalu pemakaian sementara bertaut ke usulan itu.
// GAGAL DI TENGAH (usulan terkirim, pemakaian belum tersimpan): usulan TIDAK dikirim ulang; keadaan ini disimpan di induk (onTertinggal) berikut Idempotency-Key + isian, sehingga banner "usulan tertinggal" tetap tampil
// (juga setelah formulir ditutup/refresh) dan "Simpan pemakaian lagi" memakai kunci yang SAMA (tidak menggandakan walau percobaan pertama sebenarnya berhasil di server).
// Bahan yang namanya SUDAH ada di katalog tetapi dicatat sementara: asal barang WAJIB diisi dan alasan rekonsiliasi dipilih — keduanya ditulis ke catatan sehingga terbaca jelas oleh Gudang.
const KODE_FINAL = ["BAHAN_ADA_DI_KATALOG", "USULAN_DITOLAK"];
const kolom = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export default function BahanBelumAda({ unitId, kodeUnit, izin = {}, awalNama = "", awalSatuan = "PCS", alasanAwal = "", tertinggalAwal = null, onTertinggal = null, onTutup, onGunakanKatalog, onDone }) {
  const bolehSementara = !!izin.catatPemakaianSementara; const bolehUsul = !!izin.usulBahan;
  const f0 = tertinggalAwal?.form ?? {};
  const [nama, setNama] = useState(f0.nama ?? awalNama); const [qty, setQty] = useState(f0.qty ?? ""); const [satuan, setSatuan] = useState(f0.satuan ?? awalSatuan); const [kelompok, setKelompok] = useState(f0.kelompok ?? "");
  const [asal, setAsal] = useState(f0.asal ?? ""); const [catatan, setCatatan] = useState(f0.catatan ?? ""); const [usulkan, setUsulkan] = useState(f0.usulkan ?? bolehUsul);
  const [alasan, setAlasan] = useState(f0.alasan ?? alasanAwal); const [alasanLain, setAlasanLain] = useState(f0.alasanLain ?? "");
  const [kembar, setKembar] = useState({ kandidat: [], adaSama: false, adaMirip: false, memuat: false }); const [bedaDariMirip, setBedaDariMirip] = useState(false);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null); const [usulan, setUsulan] = useState(tertinggalAwal?.usulan ?? null); const [hasil, setHasil] = useState(null);
  const [langkah, setLangkah] = useState(null); // langkah yang gagal: "usulan" | "pemakaian"
  const kirimRef = useRef(false); const reqRef = useRef(0); const kunciRef = useRef(tertinggalAwal?.kunci ?? null); const sidikRef = useRef(tertinggalAwal?.sidik ?? "");

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
  // ATURAN SERVER (unitProvisionalUsageService): nama yang SAMA PERSIS dengan bahan katalog aktif DITOLAK (409 BAHAN_ADA_DI_KATALOG: "Catat lewat pemakaian aktual resmi supaya saldo ikut tercatat") — UI tidak menawarkan jalur yang pasti ditolak.
  // Nama yang hanya MIRIP bahan katalog boleh dicatat sementara, tetapi alasan + asal WAJIB agar Gudang tahu mengapa tidak lewat katalog.
  const katalogSama = !usulan ? (kembar.kandidat.find((k) => k.jenis === "KATALOG" && (k.tingkat ?? "SAMA") === "SAMA") ?? null) : null;
  const blokKatalogSama = bolehSementara && !!katalogSama;
  const kandidatKatalog = !usulan && !katalogSama ? (kembar.kandidat.find((k) => k.jenis === "KATALOG" && k.aktif !== false) ?? null) : null;
  const kandidatUsulan = sudahAda && !katalogSama ? (kembar.kandidat.find((k) => k.jenis !== "KATALOG") ?? null) : null;
  const wajibAlasan = bolehSementara && !!kandidatKatalog && !blokKatalogSama; // bahan MIRIP katalog tetapi dicatat sementara → Gudang perlu tahu mengapa
  const usulkanEfektif = usulkan && !sudahAda;
  const perluKonfirmasiMirip = usulkanEfektif && !usulan && kembar.adaMirip;
  const namaOk = nama.trim().length >= 3;
  const usulanOk = !usulkanEfektif || !!usulan || (!!kelompok && !!satuan && (!perluKonfirmasiMirip || bedaDariMirip));
  const sementaraOk = !bolehSementara || (jumlah !== null && jumlah > 0);
  const alasanOk = !wajibAlasan || (!!alasan && (alasan !== "LAINNYA" || alasanLain.trim().length >= 3));
  const asalOk = !wajibAlasan || asal.trim().length >= 2;
  const valid = namaOk && !blokKatalogSama && usulanOk && sementaraOk && alasanOk && asalOk && (bolehSementara || usulkanEfektif);
  const catatanGudang = susunCatatanRekon({ kandidatKatalog, kandidatUsulan, alasan, alasanLain, catatan });
  const sidik = `${nama.trim()}|${jumlah}|${satuan}|${asal.trim()}|${catatanGudang}|${usulan?.id || ""}`;
  if (sidikRef.current !== sidik) { sidikRef.current = sidik; kunciRef.current = null; } // isian berubah = niat baru; isian sama = kunci sama (klik ulang/retry)
  const formSimpan = () => ({ nama, qty, satuan, kelompok, asal, catatan, usulkan, alasan, alasanLain });

  async function kirim() {
    if (kirimRef.current || !valid) return;
    kirimRef.current = true; setSibuk(true); setGalat(null); setLangkah(null);
    let dibuat = usulan;
    try {
      if (usulkanEfektif && !dibuat) {
        try {
          const r = await api.ajukanBahanBaru({ name: nama.trim(), unit: satuan, kelompok, description: catatan.trim() || undefined, unitId }, perluKonfirmasiMirip && bedaDariMirip);
          dibuat = r.usulan; setUsulan(r.usulan);
          onTertinggal?.({ usulan: r.usulan, form: formSimpan(), kunci: null, sidik: null }); // dari sini: usulan SUDAH ada di Gudang — tampilkan sebagai tertinggal sampai pemakaian tersimpan
          if (bolehSementara) await onDone?.();
        } catch (e) { setLangkah("usulan"); throw e; }
      }
      if (bolehSementara) {
        const sidikBaru = `${nama.trim()}|${jumlah}|${dibuat?.unit ?? satuan}|${asal.trim()}|${catatanGudang}|${dibuat?.id || ""}`;
        if (sidikRef.current !== sidikBaru) { sidikRef.current = sidikBaru; kunciRef.current = null; }
        kunciRef.current ??= kunciIdempoten("sementara");
        try {
          const r = await api.catatPemakaianSementara(unitId, { name: (dibuat?.name ?? nama.trim()), qty: jumlah, uom: dibuat?.unit ?? satuan, originNote: asal.trim() || undefined, note: catatanGudang || undefined, proposalId: dibuat?.id || undefined }, kunciRef.current);
          setHasil({ sementara: r.item, usulan: dibuat }); onTertinggal?.(null);
        } catch (e) {
          setLangkah(KODE_FINAL.includes(e?.code) ? "final" : "pemakaian");
          // Gudang sudah memutuskan usulan (disetujui/ditolak) saat pemakaian belum tersimpan → mengulang PASTI ditolak server: jangan simpan sebagai tertinggal, jelaskan jalur resminya.
          if (dibuat) onTertinggal?.(KODE_FINAL.includes(e?.code) ? null : { usulan: dibuat, form: formSimpan(), kunci: kunciRef.current, sidik: sidikRef.current }); // simpan kunci: retry (juga setelah formulir ditutup) tidak menggandakan
          throw e;
        }
      } else { setHasil({ sementara: null, usulan: dibuat }); onTertinggal?.(null); }
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
            {hasil.sementara.originNote && <p className="m-0 pl-6 text-ink2" data-testid="hasil-asal">Asal barang untuk Gudang: {hasil.sementara.originNote}</p>}
            {hasil.sementara.note && <p className="m-0 pl-6 text-ink2" data-testid="hasil-alasan">{hasil.sementara.note}</p>}
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
      {usulan && bolehSementara && (
        <p role="note" data-testid="usulan-tertinggal-form" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span><b>Langkah 1 selesai:</b> usulan “{usulan.name}” sudah terkirim ke Gudang ({usulan.statusLabel}). <b>Langkah 2 belum selesai:</b> pemakaian sementara belum tersimpan. Tekan “Simpan pemakaian lagi” — usulan tidak akan dikirim ulang.</span></p>
      )}
      {bolehSementara && (
        <p className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="status-rekon-sebelum"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span>Status setelah disimpan: <b>{STATUS_REKON}</b> untuk unit {kodeUnit || "ini"}. {CATATAN_SEMENTARA} Tidak perlu membuat stok atau Material Issue.</span></p>
      )}
      {!bolehSementara && <p className="m-0 text-[12.5px] text-ink2">Akun Anda bisa <b>mengusulkan</b> bahan ke Gudang, tetapi tidak mencatat pemakaian sementara. Usulan tidak menambah saldo, pergerakan stok, biaya, atau jurnal.</p>}

      <label className="block"><span className="mb-1 block text-[12px] text-ink3">Nama bahan yang dipakai</span>
        <input value={nama} onChange={(e) => setNama(e.target.value)} readOnly={!!usulan} maxLength={120} data-testid="usulan-nama" placeholder="mis. Lem kontak impor 5 liter" className={cn(kolom, usulan && "bg-inset")} /></label>
      {kembar.memuat && <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink3"><Search size={13} aria-hidden />Memeriksa nama yang sama…</p>}
      {kembar.kandidat.length > 0 && !usulan && (
        <div role="status" data-testid="usulan-kembar" className={cn("space-y-2 rounded-btn px-3 py-2", kembar.adaSama ? "bg-redbg" : "bg-orangebg")}>
          <p className="m-0 text-[12.5px] font-semibold text-ink">{kembar.adaSama ? (blokKatalogSama ? "Bahan ini SUDAH ADA di katalog Gudang:" : "Sudah ada — tidak perlu diusulkan lagi:") : bolehSementara && kandidatKatalog ? "Ada bahan katalog yang mirip. Bila itu bahan yang Anda pakai, pilih bahan itu. Bila berbeda, pemakaian boleh dicatat sementara (alasan dan asal wajib):" : "Ada yang mirip. Periksa dulu:"}</p>
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

      {blokKatalogSama && (
        <div role="alert" data-testid="katalog-sama-blok" className="space-y-1 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">
          <p className="m-0"><b>Tidak bisa dicatat sementara:</b> “{katalogSama.nama}” sudah ada di katalog, jadi server menolak pemakaian sementara dengan nama ini. Catat lewat <b>Bahan dari Gudang</b> (tombol “Pakai bahan ini”) supaya saldo ikut tercatat.</p>
          <p className="m-0">Bila stok bahan itu belum tercatat (“Stok belum diketahui”), pencatatan juga ditolak sampai Gudang mencatat stok awal/opname — minta Gudang lebih dulu. Bila bahan yang Anda pakai sebenarnya berbeda dari yang di katalog, ubah namanya agar tidak sama persis.</p>
        </div>
      )}
      {wajibAlasan && (
        <fieldset className="space-y-1 rounded-btn border border-line px-3 py-2" data-testid="alasan-rekon">
          <legend className="px-1 text-[12.5px] font-semibold text-ink">Mengapa dicatat sementara, padahal bahan ini ada di katalog? (Gudang membaca ini)</legend>
          {ALASAN_SEMENTARA.map((a) => (
            <label key={a.key} className="flex min-h-[40px] items-center gap-2 text-[13px] text-ink"><input type="radio" name="alasan-rekon" value={a.key} checked={alasan === a.key} onChange={() => setAlasan(a.key)} data-testid={`alasan-${a.key}`} className="h-4 w-4 accent-[var(--accent,#2563eb)]" />{a.label}</label>
          ))}
          {alasan === "LAINNYA" && <input value={alasanLain} onChange={(e) => setAlasanLain(e.target.value)} maxLength={200} data-testid="alasan-lain" placeholder="Tulis alasannya (min. 3 huruf)" className={kolom} />}
        </fieldset>
      )}

      <div className="flex gap-2">
        {bolehSementara && <label className="flex-1"><span className="mb-1 block text-[12px] text-ink3">Jumlah dipakai</span>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="sementara-qty" placeholder="0" className={cn(kolom, "text-right tabular-nums")} /></label>}
        <label className="w-36"><span className="mb-1 block text-[12px] text-ink3">Satuan</span>
          <select value={satuan} onChange={(e) => setSatuan(e.target.value)} disabled={!!usulan} data-testid="usulan-satuan" className={cn(kolom, "pr-1")}>{SATUAN_KOMPONEN.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
      </div>

      {bolehSementara && (
        <div>
          <span className="mb-1 block text-[12px] text-ink3">Asal barang{wajibAlasan ? " (wajib — Gudang perlu tahu dari mana barang ini)" : " (yang diketahui)"}</span>
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

      <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} aria-label="Catatan (opsional)" data-testid="sementara-catatan" placeholder="Catatan atau keterangan (opsional): ukuran, merek, kegunaan" className={kolom} />

      {valid && bolehSementara && catatanGudang && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="catatan-untuk-gudang"><b>Yang akan dibaca Gudang:</b> asal: {asal.trim() || "belum diisi"} · {catatanGudang}</p>}
      {valid && ringkasan.length > 0 && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink" data-testid="belum-ada-ringkasan"><b>Akan dicatat:</b> {ringkasan.join(" · ")}. Stok Gudang tidak berubah.</p>}
      {g && (
        <div role="alert" data-testid="usulan-galat" className="space-y-1 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">
          {langkah === "pemakaian" && usulan
            ? <p className="m-0"><b>Usulan “{usulan.name}” SUDAH terkirim ke Gudang, tetapi pemakaian sementara BELUM tersimpan.</b> Penyebab: {g.teks} Tekan “Simpan pemakaian lagi” — usulan tidak dikirim ulang dan pemakaian tidak akan tercatat dua kali.</p>
            : langkah === "final" && usulan
            ? <p className="m-0" data-testid="usulan-final"><b>Usulan “{usulan.name}” sudah diputuskan Gudang, jadi pemakaian sementara tidak bisa disimpan lagi.</b> {g.teks} Bahan yang sudah masuk katalog dicatat lewat “Bahan dari Gudang”; bila usulan ditolak, hubungi Gudang atau catat bahan lain. Tidak ada yang tertinggal untuk dilanjutkan.</p>
            : <p className="m-0">{langkah === "usulan" ? "Usulan belum terkirim (tidak ada yang tersimpan). " : ""}{g.teks} {g.jenis === "jaringan" ? "Isian tetap di layar; coba lagi (tidak akan tercatat dua kali)." : ""}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>{usulan ? "Tutup (lanjutkan nanti)" : "Batal"}</Button>
        <Button className="bh-cta min-h-[44px]" data-testid="usulan-kirim" disabled={sibuk || !valid} onClick={kirim}>{sibuk ? "Menyimpan…" : bolehSementara ? (usulan ? "Simpan pemakaian lagi" : usulkanEfektif ? "Catat sementara & usulkan ke Gudang" : "Catat pemakaian sementara") : "Usulkan ke Gudang"}</Button>
      </div>
    </div>
  );
}
