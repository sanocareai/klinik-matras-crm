import React, { useEffect, useState } from "react";
import { AlertTriangle, Clock, History, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import { SUMBER_LABEL, inputWaktuKeIso, isoKeInputWaktu, jamTeks, parseJumlah, sudahDihitung, teksWaktuBaris } from "./opnameLogic.js";

export const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
export const teksSimpan = (b) => (sudahDihitung(b) ? String(b.counted) : "");
const inputCls = "rounded-btn border border-border bg-surface px-2.5 py-2 text-[14px] text-ink outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]";

/** Nilai yang tampil di kolom: draf bila ada, kalau tidak angka tersimpan. KOSONG tetap kosong (tidak pernah diisi dari saldo). */
export const nilaiKolom = (b, draf) => (draf?.teks !== undefined ? draf.teks : teksSimpan(b));

/** Ringkas tiga waktu satu bahan: "Dihitung 19 Okt 10.00 · disimpan 19 Okt 10.40 oleh Nadya", atau "Waktu hitung belum diketahui · …", atau "belum dihitung". */
export const teksPetugas = (b) => teksWaktuBaris(b);

/** Kotak konflik: angka sudah diubah orang lain — pilihan eksplisit, tidak menimpa diam-diam. */
export function BannerKonflik({ konflik, onPakai, onTimpa }) {
  return (
    <div role="alert" className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="konflik-baris">
      <p className="m-0 flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />
        <span><b>Angka ini baru diubah {konflik.oleh?.nama ?? "petugas lain"}</b> ({jamTeks(konflik.savedAt)}): {konflik.counted === null ? "dikosongkan" : konflik.counted}. Angka Anda belum disimpan.</span></p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onPakai} className="max-sm:min-h-11" data-testid="pakai-angka-mereka">Pakai angka mereka</Button>
        <Button size="sm" variant="ghost" onClick={onTimpa} className="max-sm:min-h-11" data-testid="timpa-angka">Timpa dengan angka saya (wajib alasan)</Button>
      </div>
    </div>
  );
}

/** Riwayat satu bahan: perubahan angka (lama → baru) dan perubahan waktu hitung (lama → baru), pelaku, waktu, alasan. */
export function RiwayatBaris({ countId, lineId }) {
  const [d, setD] = useState(null); const [galat, setGalat] = useState("");
  useEffect(() => { api.getRiwayatBarisOpname(countId, lineId).then((r) => setD(r.riwayat)).catch((e) => setGalat(e.message)); }, [countId, lineId]);
  if (galat) return <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>;
  if (!d) return <p className="m-0 flex items-center gap-1 text-[12px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat riwayat…</p>;
  if (!d.length) return <p className="m-0 text-[12px] text-ink3">Belum ada angka tersimpan.</p>;
  return (
    <ol className="m-0 list-none space-y-1 p-0 text-[12px] text-ink2" data-testid="riwayat-baris">
      {d.map((x, i) => x.jenis === "WAKTU"
        ? <li key={i} data-testid="riwayat-waktu"><Clock size={11} className="mr-1 inline" aria-hidden />Waktu hitung: {x.lama ? jamTeks(x.lama) : "belum ada"} → <b className="text-ink">{x.baru ? jamTeks(x.baru) : "tidak diketahui"}</b> ({SUMBER_LABEL[x.sumber] ?? "waktu dikosongkan"}) · {x.oleh ?? "?"} · {jamTeks(x.pada)}{x.alasan ? ` · “${x.alasan}”` : ""}</li>
        : <li key={i}>{x.lama === null ? "—" : x.lama} → <b className="text-ink">{x.baru === null ? "dikosongkan" : x.baru}</b> · {x.oleh ?? "?"} · {jamTeks(x.pada)}{x.alasan ? ` · “${x.alasan}”` : ""}</li>)}
    </ol>
  );
}

/**
 * Waktu pengamatan satu bahan, dengan aturan sederhana untuk petugas:
 *   • belum ada angka & belum dimulai → tombol "Mulai hitung" (tekan TEPAT SEBELUM menghitung; waktu dicap server)
 *   • sudah dimulai/dihitung → "Dihitung sejak …" + "Ubah waktu" (wajib alasan, tercatat)
 *   • sudah ada angka tetapi waktu tidak diketahui → peringatan + "Isi waktu hitung"
 * `b` minimal { id, counted, observedAt, observedSource, revision, excluded }. `onMulai(lineId)` async; `onTersimpan()` dipanggil setelah koreksi waktu tersimpan.
 */
export function PengamatanBaris({ countId, b, bisa, onMulai, onTersimpan, besar = false }) {
  const [buka, setBuka] = useState(false); const [nilai, setNilai] = useState(""); const [alasan, setAlasan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState("");
  if (b.excluded) return null;
  const punyaAngka = sudahDihitung(b); const ada = !!b.observedAt;
  const bukaForm = () => { setNilai(isoKeInputWaktu(b.observedAt ?? new Date().toISOString())); setAlasan(""); setGalat(""); setBuka(true); };
  const simpanWaktu = async () => {
    const iso = inputWaktuKeIso(nilai); if (!iso) { setGalat("Isi tanggal dan jam hitung."); return; }
    if (alasan.trim().length < 3) { setGalat("Alasan wajib diisi (min. 3 karakter)."); return; }
    setSibuk(true); setGalat("");
    try { await api.koreksiWaktuHitungOpname(countId, b.id, { observedAt: iso, alasan: alasan.trim(), revision: b.revision }); setBuka(false); await onTersimpan?.(); } catch (e) { setGalat(e.message || "Gagal menyimpan waktu"); } finally { setSibuk(false); }
  };
  return (
    <div className="space-y-1.5" data-testid="pengamatan-baris">
      {!ada && !punyaAngka && bisa && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size={besar ? "lg" : "sm"} variant="secondary" onClick={() => onMulai?.(b.id)} className={cn("max-sm:min-h-11", besar && "min-h-12 w-full")} data-testid="mulai-bahan"><Clock size={14} /> Mulai hitung</Button>
          <span className="text-[11.5px] text-ink3">Tekan tepat sebelum menghitung barangnya.</span>
        </div>
      )}
      {ada && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink2" data-testid="waktu-pengamatan">
          <Clock size={12} className="text-ink3" aria-hidden /> {punyaAngka ? "Dihitung" : "Sedang dihitung sejak"} <b className="text-ink">{jamTeks(b.observedAt)}</b>
          <span className="text-ink3">({SUMBER_LABEL[b.observedSource] ?? "—"}{b.observedBy?.nama ? ` · ${b.observedBy.nama}` : ""})</span>
          {bisa && !buka && <Button size="sm" variant="ghost" onClick={bukaForm} className="max-sm:min-h-11" data-testid="ubah-waktu">Ubah waktu</Button>}
        </p>
      )}
      {!ada && punyaAngka && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-btn bg-orangebg px-2.5 py-1.5 text-[12px] text-ink" data-testid="waktu-tidak-diketahui">
          <AlertTriangle size={13} className="shrink-0 text-orange" aria-hidden /> <span>Waktu hitung belum diketahui — sistem tidak menebaknya dari waktu simpan.</span>
          {bisa && !buka && <Button size="sm" variant="secondary" onClick={bukaForm} className="max-sm:min-h-11" data-testid="isi-waktu">Isi waktu hitung</Button>}
        </p>
      )}
      {buka && (
        <div className="space-y-2 rounded-btn border border-line bg-inset p-2.5" data-testid="form-waktu">
          <label className="block text-[12px] text-ink2">Kapan barang ini dihitung?
            <input type="datetime-local" value={nilai} onChange={(e) => setNilai(e.target.value)} data-testid="input-waktu" className={cn(inputCls, "mt-1 w-full")} /></label>
          <label className="block text-[12px] text-ink2">Alasan (wajib, tercatat)
            <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. dicatat dari lembar tulis, hitung jam 10.00" data-testid="alasan-waktu" className={cn(inputCls, "mt-1 w-full")} /></label>
          {galat && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-waktu">{galat}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={simpanWaktu} disabled={sibuk} className="max-sm:min-h-11" data-testid="simpan-waktu">{sibuk ? <Loader2 size={14} className="animate-spin" /> : null} Simpan waktu</Button>
            <Button size="sm" variant="ghost" onClick={() => setBuka(false)} className="max-sm:min-h-11">Batal</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pertanyaan "Kapan barang ini dihitung?" saat menyimpan angka yang waktu hitungnya belum ada (atau hitung ulang). Pilihan: baru saja / pilih jam / simpan tanpa waktu. */
export function DialogWaktuHitung({ jumlah, onPilih, onBatal }) {
  const [jam, setJam] = useState(() => isoKeInputWaktu(new Date().toISOString()));
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="judul-waktu-hitung" data-testid="dialog-waktu-hitung">
      <div className="w-full max-w-md space-y-3 rounded-t-card bg-surface p-4 shadow-xl sm:rounded-card max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h2 id="judul-waktu-hitung" className="m-0 text-[16px] font-bold text-ink">Kapan barang ini dihitung?</h2>
        <p className="m-0 text-[12.5px] leading-snug text-ink2">{jumlah} bahan akan disimpan. Waktu hitung dipakai membandingkan dengan saldo sistem PADA SAAT ITU. Sistem tidak menebaknya dari waktu simpan.</p>
        <Button onClick={() => onPilih(new Date().toISOString())} className="min-h-12 w-full" data-testid="waktu-baru-saja">Baru saja dihitung</Button>
        <div className="space-y-1.5 rounded-btn border border-line p-2.5">
          <label className="block text-[12px] text-ink2">Atau pilih jam hitungnya
            <input type="datetime-local" value={jam} onChange={(e) => setJam(e.target.value)} data-testid="pilih-jam-hitung" className={cn(inputCls, "mt-1 w-full")} /></label>
          <Button variant="secondary" onClick={() => { const iso = inputWaktuKeIso(jam); if (iso) onPilih(iso); }} disabled={!inputWaktuKeIso(jam)} className="min-h-11 w-full" data-testid="waktu-pakai-jam">Pakai jam ini</Button>
        </div>
        <Button variant="ghost" onClick={() => onPilih("TANPA")} className="min-h-11 w-full text-[12.5px]" data-testid="waktu-simpan-tanpa">Belum tahu — simpan tanpa waktu</Button>
        <p className="m-0 text-[11.5px] text-ink3">Tanpa waktu hitung, hitungan tidak bisa diserahkan sampai waktunya dilengkapi.</p>
        <Button variant="ghost" onClick={onBatal} className="min-h-11 w-full" data-testid="waktu-batal">Batal</Button>
      </div>
    </div>
  );
}

/** Aksi sekunder satu bahan: riwayat, tandai ragu, keluarkan dari sesi (alasan wajib). */
export function AksiLain({ countId, b, bisa, ragu, onRagu, onKeluar, onKembalikan, ringkas = false }) {
  const [riwayat, setRiwayat] = useState(false); const [keluar, setKeluar] = useState(false); const [alasan, setAlasan] = useState(""); const [buka, setBuka] = useState(!ringkas);
  // Daftar desktop memuat ratusan baris: aksi sekunder dilipat di balik "Lainnya" (satu tombol sebaris dengan petugas); kartu HP menampilkannya langsung.
  const isi = (
    <div className="w-full basis-full space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setRiwayat((v) => !v)} className="max-sm:min-h-11" data-testid="lihat-riwayat"><History size={13} /> Riwayat</Button>
        {bisa && !b.excluded && <label className="inline-flex items-center gap-1.5 rounded-btn px-2 py-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={ragu} onChange={(e) => onRagu(e.target.checked)} data-testid="tandai-ragu" /> Tandai perlu diperiksa</label>}
        {bisa && !b.excluded && <Button size="sm" variant="ghost" onClick={() => setKeluar((v) => !v)} className="text-red max-sm:min-h-11" data-testid="buka-keluarkan">Keluarkan dari sesi</Button>}
        {bisa && b.excluded && <Button size="sm" variant="secondary" onClick={onKembalikan} className="max-sm:min-h-11" data-testid="kembalikan-bahan">Kembalikan ke sesi</Button>}
      </div>
      {riwayat && <RiwayatBaris countId={countId} lineId={b.id} />}
      {keluar && (
        <div className="flex flex-wrap items-center gap-2" data-testid="form-keluarkan">
          <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan (wajib), mis. barang sudah diretur" aria-label="Alasan mengeluarkan bahan" className={cn(inputCls, "min-w-0 flex-1")} />
          <Button size="sm" variant="destructive" disabled={alasan.trim().length < 3} onClick={() => { onKeluar(alasan.trim()); setKeluar(false); setAlasan(""); }} className="max-sm:min-h-11" data-testid="konfirmasi-keluarkan">Keluarkan</Button>
        </div>
      )}
      {b.excluded && <p className="m-0 text-[12px] text-ink3">Dikeluarkan: {b.excludedReason}</p>}
    </div>
  );
  if (!ringkas) return isi;
  return (<><Button size="sm" variant="ghost" onClick={() => setBuka((v) => !v)} className="ml-auto max-sm:min-h-11" data-testid="lainnya" aria-expanded={buka}>{buka ? "Tutup" : "Lainnya"}</Button>{buka && isi}</>);
}

/** Kolom angka: inputMode desktop/HP, kosong ≠ 0, Enter pindah ke bahan berikutnya. */
export function KolomHitung({ b, draf, bisa, onUbah, onEnter, label, large = false, autoFocus = false }) {
  const teks = nilaiKolom(b, draf); const p = parseJumlah(teks);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off" disabled={!bisa} value={teks} autoFocus={autoFocus} placeholder="kosong"
          onChange={(e) => onUbah({ teks: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter?.(); } }} aria-label={label} aria-invalid={!!p.galat} data-testid="kolom-hitung" data-kode={b.kode}
          className={cn(inputCls, large ? "h-14 w-full text-center text-[22px] font-semibold" : "w-28 text-right tabular-nums", p.galat && "border-red")} />
        <span className="text-[12.5px] text-ink3">{satuan(b.satuan)}</span>
      </div>
      {p.galat && <p role="alert" className="m-0 text-[11.5px] text-red">{p.galat}</p>}
    </div>
  );
}

export function LencanaStatus({ b }) {
  if (b.excluded) return <Badge variant="neutral">Dikeluarkan</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {sudahDihitung(b) ? <Badge variant="green" data-testid="status-dihitung">Dihitung</Badge> : b.observedAt ? <Badge variant="accent" data-testid="status-sedang">Sedang dihitung</Badge> : <Badge variant="neutral" data-testid="status-belum">Belum dihitung</Badge>}
      {sudahDihitung(b) && !b.observedAt && <Badge variant="orange" data-testid="status-tanpa-waktu">Tanpa waktu hitung</Badge>}
      {b.perluPeriksa && <Badge variant="orange">Perlu diperiksa</Badge>}
      {b.origin === "TAMBAHAN" && <Badge variant="accent">Ditambahkan</Badge>}
      {b.nonaktif && <Badge variant="neutral">Nonaktif</Badge>}
    </span>
  );
}
