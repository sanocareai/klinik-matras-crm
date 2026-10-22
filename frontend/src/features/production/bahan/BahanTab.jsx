import React, { useState } from "react";
import { ChevronDown, ClipboardList, Package, Recycle } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import MaterialPlanEditor from "@/features/production/MaterialPlanEditor.jsx";
import CatatBahanBaru from "@/features/production/bahan/CatatBahanBaru.jsx";
import FormKomponenLama from "@/features/production/bahan/FormKomponenLama.jsx";
import KomponenLamaDaftar from "@/features/production/bahan/KomponenLamaDaftar.jsx";
import RiwayatBahanBaru from "@/features/production/bahan/RiwayatBahanBaru.jsx";
import "@/features/production/bahan/bahan.css";
import { JUDUL_AKTUAL, JUDUL_RENCANA, SUMBER, asalKomponen } from "@/features/production/bahan/bahanModel.js";

// TAB BAHAN — tindakan utama = "Catat pemakaian aktual" (tanpa wajib Rencana). Dua sumber dipilih sederhana dan dipisah:
//   Bahan baru dari Gudang (jalur stok resmi, mengurangi stok tepat sekali) · Komponen lama dari unit ini (milik pelanggan, tidak memengaruhi stok).
// Rencana = opsional, di sisi, terlipat; tidak pernah mengurangi stok. Hanya SATU katalog yang tampil pada satu waktu (mencatat aktual ATAU menyusun rencana).
function KartuSumber({ aktifKey, kunci, ikon: Ikon, judul, teks, onPilih }) {
  const pilih = aktifKey === kunci;
  return (
    <button type="button" role="radio" aria-checked={pilih} data-testid={`sumber-${kunci}`} onClick={() => onPilih(kunci)}
      className={cn("flex min-h-[64px] flex-1 items-start gap-3 rounded-card border px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50", pilih ? "border-accent bg-accentbg" : "border-line hover:bg-hovertint")}>
      <Ikon size={18} className={cn("mt-0.5 shrink-0", pilih ? "bh-b-accent" : "text-ink2")} aria-hidden />
      <span className="min-w-0"><span className="block text-[14px] font-semibold text-ink">{judul}</span><span className="block text-[12px] text-ink">{teks}</span></span>
    </button>
  );
}

export default function BahanTab({ unitId, data, izin, aktif, onDone, onReload }) {
  const kodeUnit = data.unit.unitCode; const boleh = !!izin.pemakaianAktual && aktif;
  const [mode, setMode] = useState(null); // null | "baru" | "lama"
  const [sumber, setSumber] = useState("baru"); const [rencanaBuka, setRencanaBuka] = useState(false); const [rencanaEdit, setRencanaEdit] = useState(false);
  const rencana = data.rencanaBahan?.plan ?? null; const kl = data.komponenLama ?? { items: [], dibatalkan: [] };
  const tutup = () => setMode(null);
  const selesaiKomponen = async () => { setMode(null); await onDone(); };
  const adaBaru = (data.pemakaianAktual?.baris ?? []).length > 0; const adaLama = kl.items.length + kl.dibatalkan.length > 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-testid="bagian-bahan">
      {/* ── UTAMA: pemakaian aktual */}
      <section aria-labelledby="aktual-judul" className="min-w-0 space-y-4" data-testid="sec-aktual">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="aktual-judul" className="m-0 text-[16px] font-semibold text-ink">{JUDUL_AKTUAL}</h3>
        </div>
        {boleh && !mode && (
          <Button className="bh-cta min-h-[48px] w-full sm:w-auto" data-testid="aktual-buka" disabled={rencanaEdit} title={rencanaEdit ? "Selesaikan atau batalkan penyusunan rencana dulu" : undefined} onClick={() => { setMode(sumber); setRencanaBuka(false); }}>Catat pemakaian aktual</Button>
        )}
        {!izin.pemakaianAktual && <p className="m-0 text-[12.5px] text-ink3" data-testid="aktual-hanya-lihat">Akun Anda hanya bisa melihat pemakaian bahan.</p>}
        {izin.pemakaianAktual && !aktif && <p className="m-0 text-[12.5px] text-ink3">Unit sudah selesai/dibatalkan; pemakaian tidak dicatat lagi.</p>}

        {mode && (
          <div className="space-y-4 rounded-card border border-line px-4 py-4" data-testid="panel-catat-aktual">
            <div role="radiogroup" aria-label="Sumber pemakaian" className="flex flex-col gap-2 sm:flex-row">
              <KartuSumber aktifKey={mode} kunci="baru" ikon={Package} judul={SUMBER.BARU.label} teks="Lewat Material Issue/pergerakan stok resmi. Mengurangi stok tepat sekali." onPilih={(k) => { setMode(k); setSumber(k); }} />
              <KartuSumber aktifKey={mode} kunci="lama" ikon={Recycle} judul={SUMBER.LAMA.label} teks={`${asalKomponen(kodeUnit)}. Tidak memengaruhi stok.`} onPilih={(k) => { setMode(k); setSumber(k); }} />
            </div>
            {mode === "baru" && <CatatBahanBaru key="baru" data={data} unitId={unitId} onDone={onDone} onTutup={tutup} />}
            {mode === "lama" && <FormKomponenLama key="lama" unitId={unitId} kodeUnit={kodeUnit} meta={{ fotoMaks: 3 }} onSelesai={selesaiKomponen} onBatal={tutup} />}
          </div>
        )}

        <div className="space-y-2" data-testid="sec-bahan-baru">
          <h4 className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{SUMBER.BARU.label} <Badge variant="orange" className="bh-b-orange" title={SUMBER.BARU.dampak}>{SUMBER.BARU.ringkas}</Badge></h4>
          {adaBaru ? <RiwayatBahanBaru unitId={unitId} data={data} bolehUbah={!!izin.pemakaianAktual} aktif={aktif} onDone={onDone} />
            : <p className="m-0 rounded-btn bg-inset px-3 py-2.5 text-[13px] text-ink" data-testid="bahan-baru-kosong">Belum ada pemakaian bahan baru. {boleh ? "Tekan “Catat pemakaian aktual” — tidak perlu rencana lebih dulu." : ""}</p>}
        </div>

        <div className="space-y-2" data-testid="sec-komponen-lama">
          <h4 className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{SUMBER.LAMA.label} <Badge variant="accent" className="bh-b-accent" title={SUMBER.LAMA.dampak}>{SUMBER.LAMA.ringkas}</Badge></h4>
          {adaLama ? <KomponenLamaDaftar unitId={unitId} kodeUnit={kodeUnit} data={kl} bolehUbah={!!izin.pemakaianAktual} aktif={aktif} meta={{ fotoMaks: 3 }} onDone={onDone} />
            : <p className="m-0 rounded-btn bg-inset px-3 py-2.5 text-[13px] text-ink" data-testid="komponen-lama-kosong">Belum ada komponen lama yang dipakai kembali atau dilepas. {boleh ? "Pilih “Komponen lama dari unit ini” saat mencatat." : ""}</p>}
        </div>
      </section>

      {/* ── OPSIONAL: rencana (terlipat) */}
      <aside className="min-w-0" data-testid="sec-rencana">
        <div className="rounded-card border border-line">
          <button type="button" aria-expanded={rencanaBuka} aria-controls="rencana-isi" data-testid="rencana-toggle" onClick={() => { if (rencanaBuka) setRencanaEdit(false); setRencanaBuka((v) => !v); }} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <ClipboardList size={17} className="shrink-0 text-ink3" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-ink">{JUDUL_RENCANA}</span>
              <span className="block text-[12px] text-ink2">{rencana ? `${rencana.lines.length} bahan · revisi ${rencana.revision}` : "Belum ada rencana. Tidak wajib untuk mencatat pemakaian."}</span></span>
            <ChevronDown size={16} className={cn("shrink-0 text-ink3 transition-transform", rencanaBuka && "rotate-180")} aria-hidden />
          </button>
          {rencanaBuka && (
            <div id="rencana-isi" className="border-t border-line px-4 py-4">
              <MaterialPlanEditor unitId={unitId} rencana={data.rencanaBahan} bolehUbah={!!izin.rencanaBahan && !mode} unitAktif={aktif} onSaved={() => onDone()} onReload={onReload} judul="Rencana bahan" badgeTeks="belum mengurangi stok" onEditChange={setRencanaEdit} />
              {rencana && boleh && !mode && <p className="m-0 mt-3 text-[12px] text-ink3">Saat mencatat pemakaian, pilih “Gunakan sebagai isian awal” untuk memakai sisa rencana ini sebagai titik mulai.</p>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
