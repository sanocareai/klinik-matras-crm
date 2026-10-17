import React, { useEffect, useState } from "react";
import { Loader2, ArrowRight, Pencil, Undo2, Ban, ClipboardCheck, PackageCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { galatPanel } from "./aksiLogic.js";

const IKON = { maju: ArrowRight, ubah: Pencil, batal: Ban, koreksi: ClipboardCheck };
const IKON_KODE = { KEMBALI_DRAFT: Undo2, SIMPAN_KE_STOK: PackageCheck, TOLAK: XCircle, CATAT_TIBA: PackageCheck, TANDAI_TIBA: PackageCheck };

export { galatPanel };

/**
 * Tombol aksi yang RELEVAN untuk status dokumen (daftar `aksi` dari server) — dipakai ulang oleh menu Gudang lain.
 * Tidak ada tombol Edit/Undo/Hapus umum: hanya aksi yang disebut server untuk status ini. Aksi dengan `panel` membuka isian kecil di tempat (tanpa modal): ubah jadwal, alasan batal/tolak.
 * @param spec  { [kode]: { panel?: { judul, bidang:[{nama,label,tipe,wajib,min,maks,awal}], tombol, peringatan? }, konfirmasi?: string } }
 * @param onJalankan async (kode, nilai) — melempar Error bila gagal (pesan ditampilkan di sini)
 */
export default function AksiDokumen({ aksi = [], spec = {}, onJalankan, sibuk = false, className, ikutiVersi }) {
  const [buka, setBuka] = useState(null); const [nilai, setNilai] = useState({}); const [galat, setGalat] = useState(""); const [proses, setProses] = useState(false);
  useEffect(() => { setBuka(null); setGalat(""); }, [ikutiVersi]);
  if (!aksi.length) return null;
  const utama = aksi.find((a) => a.jenis === "maju")?.kode;
  const jalan = async (kode, v = {}) => {
    setProses(true); setGalat("");
    try { await onJalankan(kode, v); setBuka(null); setNilai({}); } catch (e) { setGalat(e?.message || "Gagal menjalankan aksi"); } finally { setProses(false); }
  };
  const klik = (a) => {
    const s = spec[a.kode];
    if (s?.panel) { setBuka(buka === a.kode ? null : a.kode); setGalat(""); setNilai(Object.fromEntries((s.panel.bidang ?? []).map((b) => [b.nama, b.awal ?? ""]))); return; }
    if (s?.konfirmasi && !window.confirm(s.konfirmasi)) return;
    jalan(a.kode);
  };
  const panel = buka ? spec[buka]?.panel : null;
  const galatIni = panel ? galatPanel(panel, nilai) : "";
  const disabled = sibuk || proses;
  return (
    <div className={className} data-testid="aksi-dokumen">
      <div className="flex flex-wrap items-center gap-2">
        {aksi.map((a) => {
          const Ikon = IKON_KODE[a.kode] ?? IKON[a.jenis] ?? ArrowRight;
          const tipe = a.kode === utama ? "primary" : a.jenis === "batal" ? "ghost" : "secondary";
          return (
            <Button key={a.kode} size="sm" variant={tipe} disabled={disabled} onClick={() => klik(a)} data-testid={`aksi-${a.kode}`} aria-expanded={spec[a.kode]?.panel ? buka === a.kode : undefined}
              className={cn("max-sm:min-h-11", a.jenis === "batal" && "text-red hover:bg-redbg", a.kode === utama && "sm:ml-auto")}>
              {disabled && buka !== a.kode && proses ? <Loader2 size={14} className="animate-spin" /> : <Ikon size={14} />} {a.label}
            </Button>
          );
        })}
      </div>
      {panel && (
        <form className="mt-2 space-y-2 rounded-btn border border-border bg-inset p-3" data-testid={`panel-${buka}`} onSubmit={(e) => { e.preventDefault(); if (!galatIni) jalan(buka, nilai); }}>
          <p className="m-0 text-[12.5px] font-semibold text-ink">{panel.judul}</p>
          {panel.peringatan && <p className="m-0 text-[11.5px] leading-snug text-ink2">{panel.peringatan}</p>}
          {(panel.bidang ?? []).map((b) => (
            <label key={b.nama} className="block text-[11.5px] text-ink3">{b.label}{b.wajib ? " *" : ""}
              <input type={b.tipe === "date" ? "date" : "text"} value={nilai[b.nama] ?? ""} onChange={(e) => setNilai((n) => ({ ...n, [b.nama]: e.target.value }))} maxLength={b.maks} data-testid={`bidang-${b.nama}`}
                className="mt-0.5 block w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent max-sm:min-h-11" />
            </label>
          ))}
          {(galat || (galatIni && Object.values(nilai).some((x) => String(x).length))) && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-aksi">{galat || galatIni}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(null)} className="max-sm:min-h-11">Batal</Button>
            <Button type="submit" size="sm" disabled={!!galatIni || disabled} data-testid={`kirim-${buka}`} className="max-sm:min-h-11">{proses ? <Loader2 size={14} className="animate-spin" /> : null} {panel.tombol}</Button>
          </div>
        </form>
      )}
      {!panel && galat && <p role="alert" className="mt-2 text-[12px] text-red" data-testid="galat-aksi">{galat}</p>}
    </div>
  );
}
