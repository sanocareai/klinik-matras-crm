import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, ArrowRight, Pencil, Undo2, Ban, ClipboardCheck, PackageCheck, XCircle, Truck, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { galatPanel } from "./aksiLogic.js";

const IKON = { maju: ArrowRight, ubah: Pencil, batal: Ban, koreksi: ClipboardCheck };
const IKON_KODE = { KEMBALI_DRAFT: Undo2, SIMPAN_KE_STOK: PackageCheck, TOLAK: XCircle, CATAT_TIBA: PackageCheck, TANDAI_TIBA: PackageCheck, KONFIRMASI_KELUAR: PackageCheck, KIRIM: Truck, TERIMA: PackageCheck, ATUR_LOKASI: Save, BUAT_ULANG_TRANSFER: RotateCcw };

export { galatPanel };

// Aksi yang hanya MEMBUKA formulir/panel (tidak menulis apa pun saat ditekan) — aman dibuka otomatis dari tautan `?aksi=`. Aksi lain hanya disorot supaya pengguna menekannya sendiri.
const AKSI_BUKA_FORMULIR = ["CATAT_TIBA", "KOREKSI_KEDATANGAN", "KOREKSI_PENERIMAAN"];

/**
 * Tombol aksi yang RELEVAN untuk status dokumen (daftar `aksi` dari server) — dipakai ulang oleh menu Gudang lain.
 * Tidak ada tombol Edit/Undo/Hapus umum: hanya aksi yang disebut server untuk status ini. Aksi dengan `panel` membuka isian kecil di tempat (tanpa modal): ubah jadwal, alasan batal/tolak.
 * @param spec  { [kode]: { panel?: { judul, bidang:[{nama,label,tipe,wajib,min,maks,awal}], tombol, peringatan? }, konfirmasi?: string } }
 * @param onJalankan async (kode, nilai) — melempar Error bila gagal (pesan ditampilkan di sini)
 */
export default function AksiDokumen({ aksi = [], spec = {}, onJalankan, sibuk = false, className, ikutiVersi, picu: picuProp = null }) {
  // UX Gudang Tahap 4 — tindakan cepat dari Beranda/pencarian: URL jendela membawa `?aksi=KODE`. Aksi itu HANYA dibuka bila sah untuk status dokumen saat ini dan punya panel isian/konfirmasi
  // (tidak pernah dieksekusi langsung tanpa pengguna menekan tombol akhir); aksi tanpa panel hanya disorot. Server tetap menegakkan izin dan revisi.
  const [sp] = useSearchParams(); const kodeUrl = sp.get("aksi");
  const picu = React.useMemo(() => picuProp ?? (kodeUrl ? { kode: kodeUrl, n: `url:${kodeUrl}`, aman: true } : null), [picuProp, kodeUrl]);
  const [sorot, setSorot] = useState(null); const [buka, setBuka] = useState(null); const [nilai, setNilai] = useState({}); const [galat, setGalat] = useState(""); const [proses, setProses] = useState(false); const [sentuh, setSentuh] = useState(false);
  // Dokumen dimuat ulang → panel ditutup. Pesan galat TIDAK dihapus di sini: pada konflik revisi, halaman dimuat ulang tepat sebelum galat ditampilkan (galat lama dibersihkan oleh aksi berikutnya).
  useEffect(() => { setBuka(null); setSentuh(false); }, [ikutiVersi]);
  // `picu` { kode, n }: kontrol status (dropdown) memilih salah satu aksi sah di atas — dijalankan lewat jalur yang SAMA dengan menekan tombolnya (panel isian, konfirmasi, dan syarat server tetap berlaku).
  const picuTerakhir = React.useRef(null);
  useEffect(() => { if (!picu || picuTerakhir.current === picu.n) return; picuTerakhir.current = picu.n; const a = aksi.find((x) => x.kode === picu.kode); if (!a) return; if (picu.aman && !spec[a.kode]?.panel && !spec[a.kode]?.konfirmasi && !AKSI_BUKA_FORMULIR.includes(a.kode)) { setSorot(a.kode); setTimeout(() => { const el = document.querySelector(`[data-testid="aksi-${a.kode}"]`); el?.scrollIntoView?.({ block: "nearest" }); el?.focus(); }, 0); return; } klikRef.current?.(a); }, [picu]); // eslint-disable-line react-hooks/exhaustive-deps
  const klikRef = React.useRef(null);
  if (!aksi.length && !galat) return null; // tetap terpasang selama ada pesan galat (mis. konflik: dokumen sudah selesai oleh pihak lain)
  const utama = aksi.find((a) => a.jenis === "maju")?.kode;
  const jalan = async (kode, v = {}) => {
    setProses(true); setGalat("");
    try { await onJalankan(kode, v); setBuka(null); setNilai({}); } catch (e) { if (!e?.diam) setGalat(e?.message || "Gagal menjalankan aksi"); /* e.diam: pesan sudah ditampilkan halaman (banner konflik) */ } finally { setProses(false); }
  };
  const klik = (a) => {
    setSorot(null);
    const s = spec[a.kode];
    if (s?.panel) { setBuka(buka === a.kode ? null : a.kode); setGalat(""); setSentuh(false); setNilai(Object.fromEntries((s.panel.bidang ?? []).map((b) => [b.nama, b.awal ?? ""]))); return; }
    if (s?.konfirmasi && !window.confirm(s.konfirmasi)) return;
    jalan(a.kode);
  };
  klikRef.current = klik;
  const panel = buka ? spec[buka]?.panel : null;
  const galatIni = panel ? (panel.galat || galatPanel(panel, nilai)) : "";
  const disabled = sibuk || proses;
  return (
    <div className={className} data-testid="aksi-dokumen">
      <div className="flex flex-wrap items-center gap-2">
        {aksi.map((a) => {
          const Ikon = IKON_KODE[a.kode] ?? IKON[a.jenis] ?? ArrowRight;
          const tipe = a.kode === utama ? "primary" : a.jenis === "batal" ? "ghost" : "secondary";
          return (
            <Button key={a.kode} size="sm" variant={tipe} disabled={disabled} onClick={() => klik(a)} data-testid={`aksi-${a.kode}`} aria-expanded={spec[a.kode]?.panel ? buka === a.kode : undefined}
              className={cn("max-sm:min-h-11", a.jenis === "batal" && "text-red hover:bg-redbg", a.kode === utama && "sm:ml-auto", a.kode === sorot && "ring-2 ring-accent ring-offset-2")} data-sorot={a.kode === sorot ? "ya" : undefined}>
              {disabled && buka !== a.kode && proses ? <Loader2 size={14} className="animate-spin" /> : <Ikon size={14} />} {a.label}
            </Button>
          );
        })}
      </div>
      {panel && (
        <form className="mt-2 space-y-2 rounded-btn border border-border bg-inset p-3" data-testid={`panel-${buka}`} onSubmit={(e) => { e.preventDefault(); if (!galatIni) jalan(buka, nilai); }}>
          <p className="m-0 text-[12.5px] font-semibold text-ink">{panel.judul}</p>
          {panel.peringatan && <p className="m-0 text-[11.5px] leading-snug text-ink2">{panel.peringatan}</p>}
          {panel.ringkasan?.length > 0 && (
            <div data-testid={`ringkasan-${buka}`}>
              <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">{panel.judulRingkasan ?? "Dampak ke stok"}</p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[12px] leading-snug text-ink">{panel.ringkasan.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          )}
          {panel.catatan && <p className="m-0 rounded-btn bg-orangebg px-2.5 py-1.5 text-[11.5px] leading-snug text-ink2" data-testid={`catatan-${buka}`}>{panel.catatan}</p>}
          {(panel.bidang ?? []).map((b) => (
            <label key={b.nama} className="block text-[11.5px] text-ink3">{b.label}{b.wajib ? " *" : ""}
              {b.tipe === "pilih" ? (
                <select value={nilai[b.nama] ?? ""} onChange={(e) => { setSentuh(true); setNilai((n) => ({ ...n, [b.nama]: e.target.value })); }} data-testid={`bidang-${b.nama}`}
                  className="mt-0.5 block w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent max-sm:min-h-11">
                  {(b.opsi ?? []).map((o) => <option key={o.nilai} value={o.nilai}>{o.label}</option>)}
                </select>
              ) : b.tipe === "area" ? (
                <textarea rows={3} value={nilai[b.nama] ?? ""} onChange={(e) => { setSentuh(true); setNilai((n) => ({ ...n, [b.nama]: e.target.value })); }} maxLength={b.maks} data-testid={`bidang-${b.nama}`}
                  className="mt-0.5 block w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent" />
              ) : (
                <input type={b.tipe === "date" ? "date" : "text"} value={nilai[b.nama] ?? ""} onChange={(e) => { setSentuh(true); setNilai((n) => ({ ...n, [b.nama]: e.target.value })); }} maxLength={b.maks} data-testid={`bidang-${b.nama}`}
                  className="mt-0.5 block w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent max-sm:min-h-11" />
              )}
            </label>
          ))}
          {(galat || (galatIni && (panel.galat || sentuh || Object.values(nilai).some((x) => String(x).length)))) && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-aksi">{galat || galatIni}</p>}
          {!galat && galatIni && !panel.galat && !sentuh && !Object.values(nilai).some((x) => String(x).length) && <p className="m-0 text-[11.5px] text-ink3" data-testid="petunjuk-aksi">Lengkapi dulu: {galatIni}</p>}
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
