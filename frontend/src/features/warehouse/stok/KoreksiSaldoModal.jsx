import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { AngkaGud, GudField } from "@/features/warehouse/form/GudKontrol.jsx";
import { IkAwas, IkCentang, IkMuatUlang } from "@/components/gudangIcons.jsx";
import { TEKS, STATUS_KOREKSI, KEADAAN_SALDO_UI, bacaJumlah, periksaAlasan, fmt, tanda, teksSaldoSebelum, niatKoreksi } from "./koreksiSaldoLogic.js";

// KOREKSI SALDO PER BAHAN (redesain Gudang, 3 Nov 2026): isi JUMLAH FISIK yang benar + alasan -> PRATINJAU dari server (saldo sebelum/sesudah, selisih, dampak, izin) -> ajukan ke Penyesuaian Stok resmi.
// Pengaju biasa: stok TIDAK berubah di sini, baru berubah setelah disetujui orang lain dan diposting. Admin/Owner: server langsung memposting saat disimpan (pra.langsung). Satu Idempotency-Key per "niat" (bahan+jumlah+alasan): klik ganda = satu pengajuan (kunci sinkron lewat ref).
// Saldo yang dilihat di pratinjau dikirim ulang; bila saldo sudah bergeser, server menolak (SALDO_BERGESER) dan pratinjau dimuat ulang — pengguna harus mengonfirmasi lagi.
export default function KoreksiSaldoModal({ open, onClose, bahan, onDiajukan, langsung = false }) {
  const [jumlah, setJumlah] = useState(""); const [alasan, setAlasan] = useState("");
  const [galatKolom, setGalatKolom] = useState({}); const [galat, setGalat] = useState(""); const [info, setInfo] = useState("");
  const [pra, setPra] = useState(null); const [sibuk, setSibuk] = useState(false); const [hasil, setHasil] = useState(null);
  const kirimRef = useRef(false); const kunci = useRef({ niat: null, nilai: null });

  const kunciUntuk = (niat) => {
    if (kunci.current.niat !== niat) kunci.current = { niat, nilai: `koreksi-saldo-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}` };
    return kunci.current.nilai;
  };
  const ubah = (set) => (v) => { set(typeof v === "string" ? v : v.target.value); setPra(null); setInfo(""); };

  const periksa = () => {
    const e = {}; const j = bacaJumlah(jumlah); if (j.galat) e.jumlah = j.galat;
    const a = periksaAlasan(alasan); if (a) e.alasan = a;
    setGalatKolom(e); return { e, fisik: j.nilai };
  };
  const lihatPratinjau = async ({ pesan = "" } = {}) => {
    const { e, fisik } = periksa(); setGalat(""); setInfo(pesan);
    if (Object.keys(e).length) return;
    setSibuk(true);
    try { setPra(await api.pratinjauKoreksiSaldo({ materialId: bahan.id, jumlahFisik: fisik })); }
    catch (err) { setPra(null); setGalat(err.message); }
    finally { setSibuk(false); }
  };
  const ajukan = async () => {
    if (kirimRef.current || !pra) return;
    const { e, fisik } = periksa(); if (Object.keys(e).length) return;
    kirimRef.current = true; setSibuk(true); setGalat("");
    try {
      const body = { materialId: bahan.id, jumlahFisik: fisik, saldoDilihat: pra.saldoDilihat, alasan: alasan.trim() };
      const r = await api.ajukanKoreksiSaldo(body, kunciUntuk(niatKoreksi({ materialId: bahan.id, jumlahFisik: fisik, alasan })));
      setHasil(r); onDiajukan?.(r);
    } catch (err) {
      if (err.code === "SALDO_BERGESER") { await lihatPratinjau({ pesan: "Saldo bahan berubah sejak pratinjau sebelumnya. Pratinjau sudah dimuat ulang dari saldo terbaru — periksa lagi sebelum menyimpan." }); }
      else setGalat(err.message);
    } finally { kirimRef.current = false; setSibuk(false); }
  };

  if (hasil) {
    const st = STATUS_KOREKSI[hasil.status] ?? { teks: hasil.statusTeks, varian: "neutral" };
    return (
      <Modal portalToBody dialogBilaTempel open={open} onOpenChange={(o) => (o ? null : onClose())} title={hasil.langsung ? "Saldo sudah dikoreksi" : "Koreksi saldo diajukan"} description={`${bahan.kode} — ${bahan.nama}`} className="sm:w-[760px] gud-modal"
        footer={<><Link to={`/warehouse/adjustments/stock/${hasil.id}`} className="gud-tombol" data-testid="buka-penyesuaian">Buka {hasil.nomor}</Link><button type="button" className="gud-tombol gud-tombol-utama" onClick={onClose} data-testid="tutup-hasil">Selesai</button></>}>
        <div className="gud-form" data-testid="hasil-koreksi">
          <p className="gud-info" data-nada="ok"><IkCentang size={16} aria-hidden /> {hasil.ulang ? "Koreksi ini sudah tercatat sebelumnya (klik ganda tidak membuat dua)." : hasil.langsung ? "Koreksi tersimpan." : "Pengajuan tercatat."}</p>
          <dl className="gud-dl">
            <div className="gud-dl-baris"><dt>Nomor</dt><dd data-testid="hasil-nomor">{hasil.nomor}</dd></div>
            <div className="gud-dl-baris"><dt>Status</dt><dd><span className="gud-pill" data-warna={st.varian} data-testid="hasil-status">{hasil.statusTeks ?? st.teks}</span></dd></div>
            <div className="gud-dl-baris"><dt>Jumlah fisik</dt><dd>{fmt(hasil.jumlahFisik)} {String(hasil.satuan ?? "").toLowerCase()}</dd></div>
            <div className="gud-dl-baris"><dt>Selisih terhadap saldo {fmt(hasil.saldoDilihat)}</dt><dd>{tanda(hasil.selisih)}</dd></div>
          </dl>
          {hasil.langsung
            ? <p className="gud-info" data-testid="hasil-stok-berubah"><b>Saldo sudah berubah menjadi {fmt(hasil.jumlahFisik)} {String(hasil.satuan ?? "").toLowerCase()}.</b> Bila keliru, koreksi lagi dengan jumlah yang benar.</p>
            : <p className="gud-info" data-testid="hasil-stok-belum-berubah"><b>Stok belum berubah.</b> Owner atau Finance (orang lain, bukan pengaju) perlu menyetujui di Penyesuaian Stok, lalu Gudang memposting. Bila saldo bergeser sebelum itu, sistem menolak dan koreksi perlu diajukan ulang.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal portalToBody dialogBilaTempel open={open} onOpenChange={(o) => (o ? null : onClose())} title="Koreksi saldo" description={`${bahan.kode} — ${bahan.nama}`} className="sm:w-[760px] gud-modal"
      footer={pra ? (
        <>
          <button type="button" className="gud-tombol" onClick={() => setPra(null)} disabled={sibuk}>Ubah isian</button>
          <button type="button" className="gud-tombol gud-tombol-utama" onClick={ajukan} disabled={sibuk || !pra.dapatDiajukan} data-testid="ajukan-koreksi">{sibuk && <IkMuatUlang size={14} className="animate-spin" />}{pra.langsung ? "Simpan koreksi" : "Ajukan koreksi"}</button>
        </>
      ) : (
        <>
          <button type="button" className="gud-tombol" onClick={onClose}>Batal</button>
          <button type="button" className="gud-tombol gud-tombol-utama" onClick={() => lihatPratinjau()} disabled={sibuk} data-testid="lihat-pratinjau-koreksi">{sibuk && <IkMuatUlang size={14} className="animate-spin" />}Lihat pratinjau</button>
        </>
      )}>
      <form className="gud-form" data-testid="modal-koreksi-saldo" noValidate onSubmit={(e) => { e.preventDefault(); if (!pra) lihatPratinjau(); }}>
        <div className="gud-info" data-testid="catatan-jalur"><p className="m-0">{langsung ? TEKS.jalurLangsung : TEKS.jalur}</p><p className="m-0" data-testid="catatan-tidak-disentuh">{TEKS.tidakDisentuh}</p></div>
        {info && <p role="status" className="gud-info" data-nada="awas" data-testid="info-bergeser"><IkAwas size={16} aria-hidden /> <span>{info}</span></p>}
        {!pra && (
          <div className="gud-form-dua">
            <div className="gud-f-seksi"><h3 className="gud-f-bagian-judul">1. Hitungan fisik</h3>
            <GudField label={`Jumlah fisik yang benar (${String(bahan.satuan ?? "").toLowerCase()})`} htmlFor="ks-jumlah" wajib galat={galatKolom.jumlah} hint={TEKS.fisikBantuan}>
              <AngkaGud id="ks-jumlah" value={jumlah} onChange={ubah(setJumlah)} invalid={!!galatKolom.jumlah} placeholder="mis. 7 atau 0" satuan={String(bahan.satuan ?? "").toLowerCase()} data-testid="input-jumlah-fisik" autoFocus />
            </GudField>
            </div>
            <div className="gud-f-seksi"><h3 className="gud-f-bagian-judul">2. Alasan</h3>
            <GudField label="Alasan" htmlFor="ks-alasan" wajib galat={galatKolom.alasan} hint="Wajib; tercatat bersama pelaku, mis. “Hitung fisik 26 Okt: sisa 7 kg”.">
              <textarea id="ks-alasan" rows={3} value={alasan} onChange={ubah(setAlasan)} maxLength={500} aria-invalid={!!galatKolom.alasan || undefined} className="gud-f-teks gud-f-area" data-testid="input-alasan-koreksi" />
            </GudField>
            </div>
          </div>
        )}
        {pra && <Pratinjau pra={pra} bahan={bahan} alasan={alasan} />}
        {galat && <p role="alert" className="gud-info" data-nada="galat" data-testid="galat-koreksi">{galat}</p>}
      </form>
    </Modal>
  );
}

function Pratinjau({ pra, bahan, alasan }) {
  const u = String(bahan.satuan ?? "").toLowerCase(); const kb = KEADAAN_SALDO_UI[pra.keadaanSaldo];
  const warna = pra.arah === "NAIK" ? "text-green" : pra.arah === "TURUN" ? "text-red" : "text-ink2";
  return (
    <div className="space-y-3" data-testid="pratinjau-koreksi">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-btn border border-line px-3 py-2.5 text-[12.5px]">
        <dt className="text-ink3">Saldo di catatan sekarang</dt><dd className="text-right font-semibold tabular-nums text-ink" data-testid="pra-saldo-sebelum">{teksSaldoSebelum(pra)} {pra.saldoSebelum !== null && u}</dd>
        <dt className="text-ink3">Jumlah fisik yang Anda nyatakan</dt><dd className="text-right font-semibold tabular-nums text-ink" data-testid="pra-jumlah-fisik">{fmt(pra.jumlahFisik)} {u}</dd>
        <dt className="font-semibold text-ink2">Selisih</dt><dd className={`text-right text-[14px] font-extrabold tabular-nums ${warna}`} data-testid="pra-selisih" data-arah={pra.arah}>{pra.arah === "TANPA_SELISIH" ? "tidak ada selisih" : `${tanda(pra.selisih)} ${u}`}</dd>
        <dt className="text-ink3">Tersedia (setelah dikurangi pesanan)</dt><dd className="text-right tabular-nums text-ink2" data-testid="pra-tersedia">{fmt(pra.dampakStok.tersedia.sebelum)} → {fmt(pra.dampakStok.tersedia.sesudah)}</dd>
        {pra.dampakStok.dipesan > 0 && <><dt className="text-ink3">Sudah dipesan</dt><dd className="text-right tabular-nums text-ink2">{fmt(pra.dampakStok.dipesan)} {u}</dd></>}
        <dt className="text-ink3">Keadaan sekarang</dt><dd className="text-right"><span className="gud-pill" data-warna={kb?.varian ?? "neutral"} className="h-auto whitespace-normal text-left leading-tight" data-testid="pra-keadaan">{kb?.singkat ?? pra.keadaanSaldo}</span></dd>
      </dl>
      <p className="text-[11.5px] leading-relaxed text-ink3" data-testid="pra-catatan">{pra.dampakStok.catatan} Alasan: “{String(alasan).trim()}”.</p>
      {pra.peringatan.map((w, i) => <div key={i} className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] text-ink2" data-testid="pra-peringatan"><IkAwas size={16} aria-hidden />{w}</div>)}
      {pra.pengajuanAktif && <p className="rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange" data-testid="pra-aktif">Sudah ada koreksi saldo {pra.pengajuanAktif.nomor} ({pra.pengajuanAktif.statusTeks}). Selesaikan atau batalkan dulu.</p>}
      {!pra.dapatDiajukan && !pra.pengajuanAktif && pra.alasanTidakDapat && <p className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="pra-tidak-dapat">{pra.alasanTidakDapat}.</p>}
      <details className="text-[11.5px] text-ink2" data-testid="pra-dampak-data">
        <summary className="cursor-pointer list-none font-semibold text-ink3 max-sm:flex max-sm:min-h-11 max-sm:items-center">Apa yang ditulis dan tidak disentuh</summary>
        <div className="mt-1.5 space-y-1">
          <div><b className="text-ink">{pra.langsung ? "Saat disimpan:" : "Saat diajukan:"}</b><ul className="m-0 list-disc pl-4">{pra.dampakData.ditulisSaatAjukan.map((x) => <li key={x}>{x}</li>)}</ul></div>
          {pra.dampakData.ditulisSaatPosting.length > 0 && <div><b className="text-ink">Saat diposting (setelah disetujui orang lain):</b><ul className="m-0 list-disc pl-4">{pra.dampakData.ditulisSaatPosting.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          <div><b className="text-ink">Tidak disentuh:</b><ul className="m-0 list-disc pl-4">{pra.dampakData.tidakDisentuh.map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      </details>
      <p className="text-[11.5px] leading-relaxed text-ink3" data-testid="pra-izin">{pra.izin.teks}</p>
    </div>
  );
}
