import React, { useEffect, useState } from "react";
import { AlertTriangle, HelpCircle, Hourglass, Package, Recycle } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import CatatBahanBaru from "@/features/production/bahan/CatatBahanBaru.jsx";
import BahanBelumAda from "@/features/production/bahan/BahanBelumAda.jsx";
import FormKomponenLama from "@/features/production/bahan/FormKomponenLama.jsx";
import KomponenLamaDaftar from "@/features/production/bahan/KomponenLamaDaftar.jsx";
import PemakaianSementaraDaftar from "@/features/production/bahan/PemakaianSementaraDaftar.jsx";
import RiwayatBahanBaru from "@/features/production/bahan/RiwayatBahanBaru.jsx";
import "@/features/production/bahan/bahan.css";
import { DAMPAK_SEMENTARA, JUDUL_AKTUAL, KARTU_SUMBER, SATUAN_KOMPONEN as SATUAN_LIST, SUMBER_SEMENTARA, asalKomponen } from "@/features/production/bahan/bahanModel.js";

// PEMAKAIAN AKTUAL — satu komponen untuk drawer Order Produksi DAN tab Bahan Ruang Kerja Unit (sebelumnya drawer punya salinan lama tanpa "Bahan belum ada").
// TIGA sumber SELALU tampil sebagai kartu (tanpa menggulir daftar bahan): Bahan dari Gudang · Bahan belum ada di katalog · Komponen lama dari kasur ini.
// Memilih kartu membuka formulirnya langsung. Tidak ada jalur yang memaksa membuat stok / Material Issue fiktif: "belum ada di katalog" = pemakaian sementara + usulan bahan (alur resmi, perlu rekonsiliasi Gudang).
function KartuSumber({ aktifKey, kunci, ikon: Ikon, disabled, alasan, onPilih }) {
  const k = KARTU_SUMBER[kunci]; const pilih = aktifKey === kunci;
  return (
    <button type="button" role="radio" aria-checked={pilih} aria-disabled={disabled || undefined} disabled={disabled} title={alasan || undefined} data-testid={`sumber-${kunci}`} onClick={() => onPilih(pilih ? null : kunci)}
      className={cn("flex min-h-[72px] w-full min-w-0 flex-1 items-start gap-3 rounded-card border px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50", pilih ? "border-accent bg-accentbg" : "border-line hover:bg-hovertint")}>
      <Ikon size={18} className={cn("mt-0.5 shrink-0", pilih ? "bh-b-accent" : "text-ink2")} aria-hidden />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{k.label}</span>
        <span className={cn("mt-0.5 block text-[12px] font-medium", k.badge === "orange" ? "bh-b-orange" : "bh-b-accent")} data-testid={`sumber-${kunci}-dampak`}>{k.ringkas}</span>
        {alasan && disabled && <span className="mt-0.5 block text-[11.5px] text-ink3">{alasan}</span>}
      </span>
    </button>
  );
}

// Usulan yang SUDAH terkirim tetapi pemakaian sementaranya belum tersimpan (gagal di antara dua langkah): disimpan per unit di sessionStorage (selamat dari refresh) beserta Idempotency-Key.
const kunciTertinggal = (unitId) => `bahan-usulan-tertinggal:${unitId}`;
const bacaTertinggal = (unitId) => { try { const t = sessionStorage.getItem(kunciTertinggal(unitId)); return t ? JSON.parse(t) : null; } catch { return null; } };
const tulisTertinggal = (unitId, v) => { try { if (v) sessionStorage.setItem(kunciTertinggal(unitId), JSON.stringify(v)); else sessionStorage.removeItem(kunciTertinggal(unitId)); } catch { /* penyimpanan tidak tersedia: banner tetap hidup selama komponen ada */ } };

export default function PemakaianAktualBagian({ unitId, data, izin, aktif, onDone, rencanaEdit = false, onMulai = null, tanpaJudul = false }) {
  const kodeUnit = data.unit.unitCode; const boleh = !!izin.pemakaianAktual && aktif;
  const bolehBelumAda = boleh && (!!izin.catatPemakaianSementara || !!izin.usulBahan);
  const [mode, setMode] = useState(null); // null | "gudang" | "belum" | "lama"
  const [tertinggal, setTertinggalState] = useState(() => bacaTertinggal(unitId));
  const setTertinggal = (v) => { setTertinggalState(v); tulisTertinggal(unitId, v); };
  // Pemakaian sementara bertaut ke usulan itu sudah ada di server (mis. respons hilang padahal tersimpan, atau dicatat dari perangkat lain) → tidak ada lagi yang tertinggal.
  useEffect(() => { if (tertinggal && (data.pemakaianSementara?.items ?? []).some((i) => i.proposalId === tertinggal.usulan?.id)) setTertinggal(null); }, [data.pemakaianSementara, tertinggal?.usulan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [awalCari, setAwalCari] = useState(""); const [awalBelum, setAwalBelum] = useState({ nama: "", satuan: "PCS", alasan: "" });
  const kl = data.komponenLama ?? { items: [], dibatalkan: [] };
  const sementara = data.pemakaianSementara ?? { items: [], total: { perluRekonsiliasi: 0 } };
  const adaBaru = (data.pemakaianAktual?.baris ?? []).length > 0; const adaLama = kl.items.length + kl.dibatalkan.length > 0; const adaSementara = sementara.items.length > 0;
  const pilih = (k) => { setMode(k); setAwalCari(""); setAwalBelum({ nama: "", satuan: "PCS", alasan: "" }); if (k) onMulai?.(k); };
  const lanjutkanTertinggal = () => { setAwalCari(""); setAwalBelum({ nama: "", satuan: "PCS", alasan: "", dariTertinggal: true }); setMode("belum"); onMulai?.("belum"); };
  const tutup = () => setMode(null);
  const selesaiKomponen = async () => { setMode(null); await onDone(); };

  return (
    <section aria-labelledby={tanpaJudul ? undefined : "aktual-judul"} aria-label={tanpaJudul ? JUDUL_AKTUAL : undefined} className="min-w-0 space-y-4" data-testid="sec-aktual">
      {!tanpaJudul && <h3 id="aktual-judul" className="m-0 text-[16px] font-semibold text-ink">{JUDUL_AKTUAL}</h3>}

      {boleh && (
        <div role="radiogroup" aria-label="Sumber pemakaian bahan" className="flex flex-col gap-2 md:flex-row" data-testid="aktual-sumber-tombol">
          <KartuSumber aktifKey={mode} kunci="gudang" ikon={Package} disabled={rencanaEdit} alasan={rencanaEdit ? "Selesaikan atau batalkan penyusunan rencana dulu" : null} onPilih={pilih} />
          <KartuSumber aktifKey={mode} kunci="belum" ikon={HelpCircle} disabled={rencanaEdit || !bolehBelumAda} alasan={rencanaEdit ? "Selesaikan atau batalkan penyusunan rencana dulu" : !bolehBelumAda ? "Akun Anda tidak boleh mencatat pemakaian sementara atau mengusulkan bahan" : null} onPilih={pilih} />
          <KartuSumber aktifKey={mode} kunci="lama" ikon={Recycle} disabled={rencanaEdit} alasan={rencanaEdit ? "Selesaikan atau batalkan penyusunan rencana dulu" : null} onPilih={pilih} />
        </div>
      )}
      {tertinggal && mode !== "belum" && (
        <div role="alert" data-testid="usulan-tertinggal" className="space-y-2 rounded-card border border-orange px-4 py-3">
          <p className="m-0 flex items-start gap-2 text-[13px] text-ink"><AlertTriangle size={16} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span><b>Ada yang belum selesai:</b> usulan bahan “{tertinggal.usulan?.name}” <b>sudah terkirim ke Gudang</b> ({tertinggal.usulan?.statusLabel}), tetapi pemakaian sementaranya <b>belum tersimpan</b> di unit ini. Lanjutkan agar pemakaiannya tercatat — usulan tidak akan dikirim ulang.</span></p>
          <div className="flex flex-wrap gap-2">
            {boleh && <Button className="min-h-[44px]" data-testid="usulan-tertinggal-lanjut" onClick={lanjutkanTertinggal}>Lanjutkan mencatat pemakaian</Button>}
            <Button variant="neutral" className="min-h-[44px]" data-testid="usulan-tertinggal-lewati" onClick={() => setTertinggal(null)}>Hanya usulan, tidak mencatat pemakaian</Button>
          </div>
        </div>
      )}
      {boleh && !mode && <p className="m-0 text-[12.5px] text-ink2" data-testid="aktual-petunjuk">Pilih sumber bahan yang dipakai. Tidak perlu rencana bahan lebih dulu.</p>}
      {!izin.pemakaianAktual && <p className="m-0 text-[12.5px] text-ink3" data-testid="aktual-hanya-lihat">Akun Anda hanya bisa melihat pemakaian bahan.</p>}
      {izin.pemakaianAktual && !aktif && <p className="m-0 text-[12.5px] text-ink3">Unit sudah selesai/dibatalkan; pemakaian tidak dicatat lagi.</p>}

      {boleh && mode && (
        <div className="space-y-3 rounded-card border border-line px-4 py-4" data-testid="panel-catat-aktual" data-mode={mode}>
          {mode === "lama" && <p className="m-0 text-[12.5px] text-ink2" data-testid="mode-teks">{KARTU_SUMBER.lama.teks} {asalKomponen(kodeUnit)}.</p>}
          {mode === "gudang" && <CatatBahanBaru key={`gudang-${awalCari}`} onTertinggal={setTertinggal} data={data} unitId={unitId} izin={izin} awalCariAwal={awalCari} onDone={onDone} onTutup={tutup} onPakaiSementara={(b) => { setAwalBelum({ nama: "", satuan: SATUAN_LIST.includes(b.satuan) ? b.satuan : "PCS", alasan: "" }); setMode("belum"); }} />}
          {mode === "belum" && <BahanBelumAda key={`belum-${awalBelum.nama}-${awalBelum.dariTertinggal ? "lanjut" : "baru"}`} awalNama={awalBelum.nama} awalSatuan={awalBelum.satuan} alasanAwal={awalBelum.alasan} tertinggalAwal={awalBelum.dariTertinggal ? tertinggal : null} onTertinggal={setTertinggal} unitId={unitId} kodeUnit={kodeUnit} izin={izin} onTutup={tutup} onDone={onDone} onGunakanKatalog={(k) => { setAwalCari(k.nama); setMode("gudang"); }} />}
          {mode === "lama" && <FormKomponenLama key="lama" unitId={unitId} kodeUnit={kodeUnit} meta={{ fotoMaks: 3 }} onSelesai={selesaiKomponen} onBatal={tutup} />}
        </div>
      )}

      <div className="space-y-2" data-testid="sec-bahan-baru">
        <h4 className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{KARTU_SUMBER.gudang.label} <Badge variant="orange" className="bh-b-orange" title={KARTU_SUMBER.gudang.teks}>{KARTU_SUMBER.gudang.ringkas}</Badge></h4>
        {adaBaru ? <RiwayatBahanBaru unitId={unitId} data={data} bolehUbah={!!izin.pemakaianAktual} aktif={aktif} onDone={onDone} />
          : <p className="m-0 rounded-btn bg-inset px-3 py-2.5 text-[13px] text-ink" data-testid="bahan-baru-kosong">Belum ada pemakaian bahan dari Gudang. {boleh ? "Pilih “Bahan dari Gudang” di atas — tidak perlu rencana lebih dulu." : ""}</p>}
      </div>

      <div className="space-y-2" data-testid="sec-pemakaian-sementara">
        <h4 className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink"><Hourglass size={14} className="text-ink3" aria-hidden />{KARTU_SUMBER.belum.label} <Badge variant="orange" className="bh-b-orange" title={SUMBER_SEMENTARA.dampak}>{sementara.total.perluRekonsiliasi > 0 ? `${sementara.total.perluRekonsiliasi} perlu rekonsiliasi Gudang` : KARTU_SUMBER.belum.ringkas}</Badge></h4>
        {adaSementara ? (
          <>
            <p className="m-0 text-[12px] text-ink3">{DAMPAK_SEMENTARA}</p>
            <PemakaianSementaraDaftar data={sementara} bolehCatat={!!izin.catatPemakaianSementara} bolehGudang={!!izin.putuskanUsulan} aktif={aktif} onDone={onDone} />
          </>
        ) : <p className="m-0 rounded-btn bg-inset px-3 py-2.5 text-[13px] text-ink" data-testid="sementara-kosong">Belum ada pemakaian bahan yang belum ada di katalog. {bolehBelumAda ? "Pilih “Bahan belum ada di katalog” untuk mencatatnya sekarang." : ""}</p>}
      </div>

      <div className="space-y-2" data-testid="sec-komponen-lama">
        <h4 className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{KARTU_SUMBER.lama.label} <Badge variant="accent" className="bh-b-accent" title={KARTU_SUMBER.lama.teks}>{KARTU_SUMBER.lama.ringkas}</Badge></h4>
        {adaLama ? <KomponenLamaDaftar unitId={unitId} kodeUnit={kodeUnit} data={kl} bolehUbah={!!izin.pemakaianAktual} aktif={aktif} meta={{ fotoMaks: 3 }} onDone={onDone} />
          : <p className="m-0 rounded-btn bg-inset px-3 py-2.5 text-[13px] text-ink" data-testid="komponen-lama-kosong">Belum ada komponen lama yang dipakai kembali atau dilepas. {boleh ? "Pilih “Komponen lama dari kasur ini” di atas." : ""}</p>}
      </div>
    </section>
  );
}
