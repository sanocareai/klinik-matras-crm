import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { TEKS, STATUS_KOREKSI, KEADAAN_SALDO_UI, bacaJumlah, periksaAlasan, fmt, tanda, teksSaldoSebelum, niatKoreksi } from "./koreksiSaldoLogic.js";

// KOREKSI SALDO PER BAHAN: isi JUMLAH FISIK yang benar + alasan -> PRATINJAU dari server (saldo sebelum/sesudah, selisih, dampak, izin) -> ajukan ke Penyesuaian Stok resmi.
// Stok TIDAK berubah di sini: baru berubah setelah disetujui orang lain dan diposting. Satu Idempotency-Key per "niat" (bahan+jumlah+alasan): klik ganda = satu pengajuan.
// Saldo yang dilihat di pratinjau dikirim ulang; bila saldo sudah bergeser, server menolak (SALDO_BERGESER) dan pratinjau dimuat ulang — pengguna harus mengonfirmasi lagi.
export default function KoreksiSaldoModal({ open, onClose, bahan, onDiajukan }) {
  const [jumlah, setJumlah] = useState(""); const [alasan, setAlasan] = useState("");
  const [galatKolom, setGalatKolom] = useState({}); const [galat, setGalat] = useState(""); const [info, setInfo] = useState("");
  const [pra, setPra] = useState(null); const [sibuk, setSibuk] = useState(false); const [hasil, setHasil] = useState(null);
  const kirimRef = useRef(false); const kunci = useRef({ niat: null, nilai: null });

  const kunciUntuk = (niat) => {
    if (kunci.current.niat !== niat) kunci.current = { niat, nilai: `koreksi-saldo-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}` };
    return kunci.current.nilai;
  };
  const ubah = (set) => (e) => { set(e.target.value); setPra(null); setInfo(""); };

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
      if (err.code === "SALDO_BERGESER") { await lihatPratinjau({ pesan: "Saldo bahan berubah sejak pratinjau sebelumnya. Pratinjau sudah dimuat ulang dari saldo terbaru — periksa lagi sebelum mengajukan." }); }
      else setGalat(err.message);
    } finally { kirimRef.current = false; setSibuk(false); }
  };

  if (hasil) {
    const st = STATUS_KOREKSI[hasil.status] ?? { teks: hasil.statusTeks, varian: "neutral" };
    return (
      <Modal portalToBody open={open} onOpenChange={(o) => (o ? null : onClose())} title="Koreksi saldo diajukan" description={`${bahan.kode} — ${bahan.nama}`} className="sm:w-[520px]"
        footer={<><Link to={`/warehouse/adjustments/stock/${hasil.id}`} className="inline-flex h-9 items-center rounded-btn px-3 text-[13px] font-medium text-accent hover:bg-hovertint max-sm:min-h-11" data-testid="buka-penyesuaian">Buka {hasil.nomor}</Link><Button size="sm" onClick={onClose} data-testid="tutup-hasil">Selesai</Button></>}>
        <div className="space-y-3" data-testid="hasil-koreksi">
          <p className="flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2.5 text-[13px] text-green"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />{hasil.ulang ? "Pengajuan ini sudah tercatat sebelumnya (klik ganda tidak membuat dua)." : "Pengajuan tercatat."}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="text-ink3">Nomor</dt><dd className="text-right font-semibold text-ink" data-testid="hasil-nomor">{hasil.nomor}</dd>
            <dt className="text-ink3">Status</dt><dd className="text-right"><Badge variant={st.varian} data-testid="hasil-status">{hasil.statusTeks ?? st.teks}</Badge></dd>
            <dt className="text-ink3">Jumlah fisik</dt><dd className="text-right font-semibold text-ink">{fmt(hasil.jumlahFisik)} {String(hasil.satuan ?? "").toLowerCase()}</dd>
            <dt className="text-ink3">Selisih terhadap saldo {fmt(hasil.saldoDilihat)}</dt><dd className="text-right font-semibold text-ink">{tanda(hasil.selisih)}</dd>
          </dl>
          <p className="rounded-btn bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2" data-testid="hasil-stok-belum-berubah"><b>Stok belum berubah.</b> Owner atau Finance (orang lain, bukan pengaju) perlu menyetujui di Penyesuaian Stok, lalu Gudang memposting. Bila saldo bergeser sebelum itu, sistem menolak dan koreksi perlu diajukan ulang.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal portalToBody open={open} onOpenChange={(o) => (o ? null : onClose())} title="Koreksi saldo" description={`${bahan.kode} — ${bahan.nama}`} className="sm:w-[520px]"
      footer={pra ? (
        <>
          <Button variant="neutral" size="sm" onClick={() => setPra(null)} disabled={sibuk} className="max-sm:min-h-11">Ubah isian</Button>
          <Button size="sm" onClick={ajukan} disabled={sibuk || !pra.dapatDiajukan} className="max-sm:min-h-11" data-testid="ajukan-koreksi">{sibuk && <Loader2 size={14} className="animate-spin" />}Ajukan koreksi</Button>
        </>
      ) : (
        <>
          <Button variant="neutral" size="sm" onClick={onClose} className="max-sm:min-h-11">Batal</Button>
          <Button size="sm" onClick={() => lihatPratinjau()} disabled={sibuk} className="max-sm:min-h-11" data-testid="lihat-pratinjau-koreksi">{sibuk && <Loader2 size={14} className="animate-spin" />}Lihat pratinjau</Button>
        </>
      )}>
      <div className="space-y-3" data-testid="modal-koreksi-saldo">
        <p className="rounded-btn bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2" data-testid="catatan-jalur">{TEKS.jalur}</p>
        {info && <p role="status" className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] text-ink2" data-testid="info-bergeser"><TriangleAlert size={13} className="mt-0.5 shrink-0 text-orange" aria-hidden />{info}</p>}
        {!pra && (
          <>
            <Field label={`Jumlah fisik yang benar (${String(bahan.satuan ?? "").toLowerCase()})`} htmlFor="ks-jumlah" required error={galatKolom.jumlah} hint={TEKS.fisikBantuan}>
              <Input id="ks-jumlah" inputMode="decimal" autoComplete="off" value={jumlah} onChange={ubah(setJumlah)} error={!!galatKolom.jumlah} placeholder="mis. 7 atau 0" data-testid="input-jumlah-fisik" />
            </Field>
            <Field label="Alasan" htmlFor="ks-alasan" required error={galatKolom.alasan} hint="Wajib; tercatat bersama pelaku, mis. “Hitung fisik 26 Okt: sisa 7 kg”.">
              <textarea id="ks-alasan" rows={2} value={alasan} onChange={ubah(setAlasan)} maxLength={500} className="w-full rounded-lg bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" data-testid="input-alasan-koreksi" />
            </Field>
          </>
        )}
        {pra && <Pratinjau pra={pra} bahan={bahan} alasan={alasan} />}
        {galat && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12px] text-red" data-testid="galat-koreksi">{galat}</p>}
      </div>
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
        <dt className="text-ink3">Keadaan sekarang</dt><dd className="text-right"><Badge variant={kb?.varian ?? "neutral"} className="h-auto whitespace-normal text-left leading-tight" data-testid="pra-keadaan">{kb?.singkat ?? pra.keadaanSaldo}</Badge></dd>
      </dl>
      <p className="text-[11.5px] leading-relaxed text-ink3" data-testid="pra-catatan">{pra.dampakStok.catatan} Alasan: “{String(alasan).trim()}”.</p>
      {pra.peringatan.map((w, i) => <div key={i} className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12px] text-ink2" data-testid="pra-peringatan"><TriangleAlert size={13} className="mt-0.5 shrink-0 text-orange" aria-hidden />{w}</div>)}
      {pra.pengajuanAktif && <p className="rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange" data-testid="pra-aktif">Sudah ada koreksi saldo {pra.pengajuanAktif.nomor} ({pra.pengajuanAktif.statusTeks}). Selesaikan atau batalkan dulu.</p>}
      {!pra.dapatDiajukan && !pra.pengajuanAktif && pra.alasanTidakDapat && <p className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="pra-tidak-dapat">{pra.alasanTidakDapat}.</p>}
      <details className="text-[11.5px] text-ink2" data-testid="pra-dampak-data">
        <summary className="cursor-pointer list-none font-semibold text-ink3 max-sm:flex max-sm:min-h-11 max-sm:items-center">Apa yang ditulis dan tidak disentuh</summary>
        <div className="mt-1.5 space-y-1">
          <div><b className="text-ink">Saat diajukan:</b><ul className="m-0 list-disc pl-4">{pra.dampakData.ditulisSaatAjukan.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <div><b className="text-ink">Saat diposting (setelah disetujui orang lain):</b><ul className="m-0 list-disc pl-4">{pra.dampakData.ditulisSaatPosting.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <div><b className="text-ink">Tidak disentuh:</b><ul className="m-0 list-disc pl-4">{pra.dampakData.tidakDisentuh.map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
      </details>
      <p className="text-[11.5px] leading-relaxed text-ink3" data-testid="pra-izin">{pra.izin.teks}</p>
    </div>
  );
}
