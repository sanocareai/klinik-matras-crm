import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { IkBatal, IkCentang, IkEdit, IkKembali, IkMuatUlang, IkPanah, IkSimpan, IkTerima, IkTruk, IkKoreksi } from "@/components/gudangIcons.jsx";
import { GudField, PilihGud, TanggalGud } from "@/features/warehouse/form/GudKontrol.jsx";
import { cn } from "@/lib/utils.js";
import { galatPanel } from "./aksiLogic.js";

// Ikon aksi: satu keluarga SVG garis Gudang (components/gudangIcons.jsx).
const IKON = { maju: IkPanah, ubah: IkEdit, batal: IkBatal, koreksi: IkKoreksi };
const IKON_KODE = { KEMBALI_DRAFT: IkKembali, SIMPAN_KE_STOK: IkCentang, TOLAK: IkBatal, CATAT_TIBA: IkTerima, TANDAI_TIBA: IkTerima, KONFIRMASI_KELUAR: IkCentang, KIRIM: IkTruk, TERIMA: IkTerima, ATUR_LOKASI: IkSimpan, BUAT_ULANG_TRANSFER: IkMuatUlang };

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
  const [sorot, setSorot] = useState(null); const [buka, setBuka] = useState(null); const [nilai, setNilai] = useState({}); const [galat, setGalat] = useState(""); const [proses, setProses] = useState(false); const [sentuh, setSentuh] = useState(false); const [tanya, setTanya] = useState(null); const kunciJalan = React.useRef(false);
  // Dokumen dimuat ulang → panel ditutup. Pesan galat TIDAK dihapus di sini: pada konflik revisi, halaman dimuat ulang tepat sebelum galat ditampilkan (galat lama dibersihkan oleh aksi berikutnya).
  useEffect(() => { setBuka(null); setSentuh(false); setTanya(null); }, [ikutiVersi]);
  // `picu` { kode, n }: kontrol status (dropdown) memilih salah satu aksi sah di atas — dijalankan lewat jalur yang SAMA dengan menekan tombolnya (panel isian, konfirmasi, dan syarat server tetap berlaku).
  const picuTerakhir = React.useRef(null);
  useEffect(() => { if (!picu || picuTerakhir.current === picu.n) return; picuTerakhir.current = picu.n; const a = aksi.find((x) => x.kode === picu.kode); if (!a) return; if (picu.aman && !spec[a.kode]?.panel && !spec[a.kode]?.konfirmasi && !AKSI_BUKA_FORMULIR.includes(a.kode)) { setSorot(a.kode); setTimeout(() => { const el = document.querySelector(`[data-testid="aksi-${a.kode}"]`); el?.scrollIntoView?.({ block: "nearest" }); el?.focus(); }, 0); return; } klikRef.current?.(a); }, [picu]); // eslint-disable-line react-hooks/exhaustive-deps
  const klikRef = React.useRef(null);
  if (!aksi.length && !galat) return null; // tetap terpasang selama ada pesan galat (mis. konflik: dokumen sudah selesai oleh pihak lain)
  const utama = aksi.find((a) => a.jenis === "maju")?.kode;
  // Kunci SINKRON (ref): klik ganda sebelum React sempat menonaktifkan tombol tetap hanya menjalankan satu permintaan. Isian TIDAK dihapus saat gagal.
  const jalan = async (kode, v = {}) => {
    if (kunciJalan.current) return; kunciJalan.current = true;
    setProses(true); setGalat("");
    try { await onJalankan(kode, v); setBuka(null); setNilai({}); setTanya(null); } catch (e) { if (!e?.diam) setGalat(e?.message || "Gagal menjalankan aksi"); /* e.diam: pesan sudah ditampilkan halaman (banner konflik) */ } finally { kunciJalan.current = false; setProses(false); }
  };
  const klik = (a) => {
    setSorot(null);
    const s = spec[a.kode];
    if (s?.panel) { setBuka(buka === a.kode ? null : a.kode); setGalat(""); setSentuh(false); setNilai(Object.fromEntries((s.panel.bidang ?? []).map((b) => [b.nama, b.awal ?? ""]))); return; }
    if (s?.konfirmasi) { setGalat(""); setBuka(null); setTanya(tanya === a.kode ? null : a.kode); return; } // konfirmasi di dalam aplikasi, bukan kotak dialog peramban
    jalan(a.kode);
  };
  klikRef.current = klik;
  const panel = buka ? spec[buka]?.panel : null;
  const galatIni = panel ? (panel.galat || galatPanel(panel, nilai)) : "";
  const disabled = sibuk || proses;
  return (
    <div className={cn("gud-aksi", className)} data-testid="aksi-dokumen">
      <div className="gud-aksi-baris">
        {aksi.map((a) => {
          const Ikon = IKON_KODE[a.kode] ?? IKON[a.jenis] ?? IkPanah;
          const utamaIni = a.kode === utama;
          return (
            <button key={a.kode} type="button" disabled={disabled} onClick={() => klik(a)} data-testid={`aksi-${a.kode}`} aria-expanded={spec[a.kode]?.panel ? buka === a.kode : undefined}
              data-utama={utamaIni ? "ya" : undefined} data-jenis={a.jenis} data-sorot={a.kode === sorot ? "ya" : undefined}
              className={cn("gud-tombol max-sm:min-h-11", utamaIni && "gud-tombol-utama", a.jenis === "batal" && "gud-tombol-awas")}>
              {proses && buka !== a.kode ? <Loader2 size={15} className="animate-spin" /> : <Ikon size={16} />} {a.label}
            </button>
          );
        })}
      </div>
      {tanya && spec[tanya]?.konfirmasi && (
        <div className="gud-panel-aksi" role="alertdialog" aria-label="Konfirmasi" data-testid={`konfirmasi-${tanya}`}>
          <p className="gud-info" data-nada="awas">{spec[tanya].konfirmasi}</p>
          <div className="gud-form-aksi">
            <button type="button" className="gud-tombol" onClick={() => setTanya(null)}>Batal</button>
            <button type="button" className="gud-tombol gud-tombol-utama" disabled={disabled} onClick={() => jalan(tanya)} data-testid={`ya-${tanya}`}>{proses ? <Loader2 size={14} className="animate-spin" /> : null} Ya, lanjutkan</button>
          </div>
        </div>
      )}
      {panel && (
        <form className="gud-panel-aksi gud-form" noValidate data-testid={`panel-${buka}`} onSubmit={(e) => { e.preventDefault(); if (!galatIni) jalan(buka, nilai); }}>
          <p className="gud-form-seksi">{panel.judul}</p>
          {panel.peringatan && <p className="gud-info">{panel.peringatan}</p>}
          {panel.ringkasan?.length > 0 && (
            <div className="gud-info" data-testid={`ringkasan-${buka}`}>
              <p className="gud-f-label m-0">{panel.judulRingkasan ?? "Dampak ke stok"}</p>
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0">{panel.ringkasan.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          )}
          {panel.catatan && <p className="gud-info" data-nada="awas" data-testid={`catatan-${buka}`}>{panel.catatan}</p>}
          {(panel.bidang ?? []).map((b) => {
            const ubah = (v) => { setSentuh(true); setNilai((n) => ({ ...n, [b.nama]: v })); };
            const id = `aksi-${buka}-${b.nama}`;
            const kosongWajib = b.wajib && String(nilai[b.nama] ?? "").trim() === "";
            const galatBidang = sentuh && galatIni && kosongWajib ? galatIni : "";
            return (
              <GudField key={b.nama} label={b.label} htmlFor={id} wajib={b.wajib} galat={galatBidang}>
                {b.tipe === "pilih" ? (
                  <PilihGud id={id} value={nilai[b.nama] ?? ""} onChange={ubah} opsi={(b.opsi ?? []).map((o) => ({ nilai: String(o.nilai), label: o.label }))} data-testid={`bidang-${b.nama}`} invalid={!!galatBidang} />
                ) : b.tipe === "area" ? (
                  <textarea id={id} rows={3} value={nilai[b.nama] ?? ""} onChange={(e) => ubah(e.target.value)} maxLength={b.maks} data-testid={`bidang-${b.nama}`} aria-invalid={!!galatBidang || undefined} className="gud-f-teks gud-f-area" />
                ) : b.tipe === "date" ? (
                  <TanggalGud id={id} value={nilai[b.nama] ?? ""} onChange={ubah} data-testid={`bidang-${b.nama}`} invalid={!!galatBidang} />
                ) : (
                  <input id={id} type="text" value={nilai[b.nama] ?? ""} onChange={(e) => ubah(e.target.value)} maxLength={b.maks} data-testid={`bidang-${b.nama}`} aria-invalid={!!galatBidang || undefined} className="gud-f-teks" />
                )}
              </GudField>
            );
          })}
          {(galat || (galatIni && (panel.galat || (sentuh && !(panel.bidang ?? []).some((b) => b.wajib && String(nilai[b.nama] ?? "").trim() === "")) || (!sentuh && Object.values(nilai).some((x) => String(x).length))))) && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-aksi">{galat || galatIni}</p>}
          {!galat && galatIni && !panel.galat && !sentuh && !Object.values(nilai).some((x) => String(x).length) && <p className="gud-f-hint" data-testid="petunjuk-aksi">Lengkapi dulu: {galatIni}</p>}
          <div className="gud-form-aksi">
            <button type="button" className="gud-tombol max-sm:min-h-11" onClick={() => setBuka(null)}>Batal</button>
            <button type="submit" disabled={!!galatIni || disabled} data-testid={`kirim-${buka}`} className="gud-tombol gud-tombol-utama max-sm:min-h-11">{proses ? <Loader2 size={14} className="animate-spin" /> : null} {panel.tombol}</button>
          </div>
        </form>
      )}
      {!panel && !tanya && galat && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-aksi">{galat}</p>}
    </div>
  );
}
