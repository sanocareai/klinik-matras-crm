import React, { useState } from "react";
import { AlertTriangle, History, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import { jamTeks, parseJumlah, sudahDihitung } from "./opnameLogic.js";

export const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
export const teksSimpan = (b) => (sudahDihitung(b) ? String(b.counted) : "");
const inputCls = "rounded-btn border border-border bg-surface px-2.5 py-2 text-[14px] text-ink outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]";

/** Nilai yang tampil di kolom: draf bila ada, kalau tidak angka tersimpan. KOSONG tetap kosong (tidak pernah diisi dari saldo). */
export const nilaiKolom = (b, draf) => (draf?.teks !== undefined ? draf.teks : teksSimpan(b));

/** Ringkas siapa/kapan menghitung: "Nadya · 19 Okt 10.15" atau "belum dihitung". */
export const teksPetugas = (b) => (sudahDihitung(b) ? `${b.countedBy?.nama ?? "petugas"} · ${jamTeks(b.countedAt)}` : "belum dihitung");

/** Kotak konflik: angka sudah diubah orang lain — pilihan eksplisit, tidak menimpa diam-diam. */
export function BannerKonflik({ konflik, onPakai, onTimpa }) {
  return (
    <div role="alert" className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink" data-testid="konflik-baris">
      <p className="m-0 flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />
        <span><b>Angka ini baru diubah {konflik.oleh?.nama ?? "petugas lain"}</b> ({jamTeks(konflik.countedAt)}): {konflik.counted === null ? "dikosongkan" : konflik.counted}. Angka Anda belum disimpan.</span></p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onPakai} className="max-sm:min-h-11" data-testid="pakai-angka-mereka">Pakai angka mereka</Button>
        <Button size="sm" variant="ghost" onClick={onTimpa} className="max-sm:min-h-11" data-testid="timpa-angka">Timpa dengan angka saya (wajib alasan)</Button>
      </div>
    </div>
  );
}

/** Riwayat angka satu bahan: lama → baru, pelaku, waktu, alasan. */
export function RiwayatBaris({ countId, lineId }) {
  const [d, setD] = useState(null); const [galat, setGalat] = useState("");
  React.useEffect(() => { api.getRiwayatBarisOpname(countId, lineId).then((r) => setD(r.riwayat)).catch((e) => setGalat(e.message)); }, [countId, lineId]);
  if (galat) return <p role="alert" className="m-0 text-[12px] text-red">{galat}</p>;
  if (!d) return <p className="m-0 flex items-center gap-1 text-[12px] text-ink3"><Loader2 size={12} className="animate-spin" /> Memuat riwayat…</p>;
  if (!d.length) return <p className="m-0 text-[12px] text-ink3">Belum ada angka tersimpan.</p>;
  return <ol className="m-0 list-none space-y-1 p-0 text-[12px] text-ink2" data-testid="riwayat-baris">{d.map((x, i) => <li key={i}>{x.lama === null ? "—" : x.lama} → <b className="text-ink">{x.baru === null ? "dikosongkan" : x.baru}</b> · {x.oleh ?? "?"} · {jamTeks(x.pada)}{x.alasan ? ` · “${x.alasan}”` : ""}</li>)}</ol>;
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
      {sudahDihitung(b) ? <Badge variant="green" data-testid="status-dihitung">Dihitung</Badge> : <Badge variant="neutral" data-testid="status-belum">Belum dihitung</Badge>}
      {b.perluPeriksa && <Badge variant="orange">Perlu diperiksa</Badge>}
      {b.origin === "TAMBAHAN" && <Badge variant="accent">Ditambahkan</Badge>}
      {b.nonaktif && <Badge variant="neutral">Nonaktif</Badge>}
    </span>
  );
}
