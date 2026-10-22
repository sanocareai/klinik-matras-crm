import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { friendlyError } from "@/features/production/experience.js";
import BahanTab from "@/features/production/bahan/BahanTab.jsx";
import RingkasanUnit, { penjelasanTertahan as penjelasanTertahanBaru } from "@/features/production/workspace/RingkasanUnit.jsx";
import { SUMBER } from "@/features/production/bahan/bahanModel.js";
import { Kosong, Riwayat, StatusTarget } from "@/features/production/OrderProduksiPanel.jsx";
import DokumentasiSection from "@/features/production/workspace/DokumentasiSection.jsx";
import { EmpatStatus } from "@/features/production/workspace/StatusMarkers.jsx";
import { BAGIAN } from "@/features/production/workspace/workListModel.js";

// RUANG KERJA UNIT — menggantikan modal panjang. Header ringkas yang tetap terlihat (kode, pelanggan, empat status terpisah), lalu bagian Ringkasan · Pekerjaan · Bahan · Dokumentasi · Riwayat
// (satu bagian per tab; tab tersimpan di URL). Yang relevan dulu; detail Sales, seluruh timestamp, dan data lanjutan dibuka lewat "Detail lanjutan". Di desktop memakai dua kolom, di HP satu kolom
// tanpa scroll mendatar. Isi bagian memakai komponen yang SAMA dengan panel Order Produksi (satu sumber perilaku): status kerja manual, status order, target, rencana bahan, pemakaian aktual.

const aktifUnit = (s) => !["CANCELLED", "DELIVERED"].includes(s);

/** Alasan jujur bila tindakan utama tidak punya tombol di sini (tidak ada tombol yang pasti gagal). */
export const penjelasanTertahan = (data) => penjelasanTertahanBaru(data);

/** Dua sumber pemakaian di Riwayat: label dan total TERPISAH (tidak dijumlahkan). */
function RingkasanPemakaian({ data }) {
  const baru = data.pemakaianAktual?.baris ?? []; const kl = data.komponenLama?.total;
  if (!baru.length && !(kl && (kl.pemakaianKembali.jumlahItem + kl.dilepasTidakDipakai.jumlahItem) > 0)) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="riwayat-dua-sumber">
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="riwayat-total-baru"><b className="text-ink">{SUMBER.BARU.label}</b><br />{baru.length} catatan · {(data.pemakaianAktual?.total ?? []).length} bahan · {SUMBER.BARU.ringkas.toLowerCase()}</p>
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="riwayat-total-lama"><b className="text-ink">{SUMBER.LAMA.label}</b><br />{kl ? `${kl.pemakaianKembali.jumlahItem} dipakai kembali · ${kl.dilepasTidakDipakai.jumlahItem} dilepas tanpa dipakai · ` : ""}{SUMBER.LAMA.ringkas.toLowerCase()}</p>
    </div>
  );
}

export default function UnitWorkspace({ unitId, bagian, onBagian, onKembali, onChanged }) {
  const [data, setData] = useState(null); const [ruang, setRuang] = useState(null); const [error, setError] = useState(null); const [memuat, setMemuat] = useState(false);
  const [notice, setNotice] = useState(""); const reqRef = useRef(0); const judulRef = useRef(null);

  const muat = useCallback(async () => {
    const id = ++reqRef.current; setMemuat(true); setError(null);
    try {
      const [d, r] = await Promise.all([api.getUnitAdopsi(unitId), api.getUnitRuangKerja(unitId)]);
      if (id === reqRef.current) { setData(d); setRuang(r); }
    } catch (e) { if (id === reqRef.current) setError(e); } finally { if (id === reqRef.current) setMemuat(false); }
  }, [unitId]);
  useEffect(() => { setData(null); setRuang(null); muat(); }, [unitId, muat]);
  useEffect(() => { if (data && judulRef.current) judulRef.current.focus?.({ preventScroll: true }); }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps

  const sesudahUbah = useCallback(async () => { await muat(); onChanged?.(); }, [muat, onChanged]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const u = data?.unit; const ad = data?.adopsi; const izin = data?.izin || {}; const aktif = !!u && aktifUnit(u.status);
  const orderSales = ruang?.order?.statusOrder;

  // navigasi tab dengan panah (WAI-ARIA tabs)
  const onKeyTab = (e) => {
    const i = BAGIAN.findIndex((b) => b.key === bagian); let n = null;
    if (e.key === "ArrowRight") n = (i + 1) % BAGIAN.length; else if (e.key === "ArrowLeft") n = (i - 1 + BAGIAN.length) % BAGIAN.length; else if (e.key === "Home") n = 0; else if (e.key === "End") n = BAGIAN.length - 1;
    if (n != null) { e.preventDefault(); onBagian(BAGIAN[n].key); requestAnimationFrame(() => document.getElementById(`tab-${BAGIAN[n].key}`)?.focus()); }
  };

  return (
    <div className="space-y-4" data-testid="ruang-kerja-unit">
      {/* header ringkas yang tetap terlihat */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8" data-testid="ruang-header">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" variant="neutral" size="sm" className="min-h-[44px] gap-1.5 px-2" onClick={onKembali} data-testid="kembali-daftar"><ArrowLeft size={16} aria-hidden /> Daftar kerja</Button>
          <div className="min-w-0 flex-1">
            <h1 ref={judulRef} tabIndex={-1} className="m-0 truncate text-[18px] font-bold text-ink outline-none" data-testid="ruang-judul">{u ? u.unitCode : "Memuat unit…"}</h1>
            {u && <p className="m-0 truncate text-[12.5px] text-ink3">{[u.order?.customer?.name, u.order?.orderNumber, (ruang?.order?.layanan || []).join(" + ")].filter(Boolean).join(" · ")}</p>}
          </div>
          <Button type="button" variant="neutral" size="sm" className="min-h-[44px]" onClick={muat} disabled={memuat} aria-label="Muat ulang ruang kerja"><RefreshCw size={14} className={memuat ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /></Button>
        </div>
        {u && <EmpatStatus className="mt-2" statusOrder={orderSales} posisi={ad.posisi} kerja={ad.kerja} alurMeja={ruang?.alurMeja ? { ...ruang.alurMeja, meja: ad.meja } : null} />}
        <div role="tablist" aria-label="Bagian ruang kerja" className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1" onKeyDown={onKeyTab} data-testid="ruang-tab">
          {BAGIAN.map((b) => (
            <button key={b.key} id={`tab-${b.key}`} type="button" role="tab" aria-selected={bagian === b.key} aria-controls={`panel-${b.key}`} tabIndex={bagian === b.key ? 0 : -1} data-testid={`tab-${b.key}`} onClick={() => onBagian(b.key)}
              className={cn("min-h-[44px] shrink-0 rounded-btn px-4 text-[13.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent/50", bagian === b.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint")}>{b.label}</button>
          ))}
        </div>
      </header>

      {notice && <p role="status" className="m-0 rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</p>}
      {error && (
        <div role="alert" data-testid="ruang-galat" className="rounded-btn bg-redbg px-3 py-3 text-[13px] text-red">
          <p className="m-0 font-medium">{error.pesan || (error.status === 404 ? "Unit tidak ditemukan atau sudah dihapus." : error.message || "Ruang kerja gagal dimuat.")}</p>
          <Button variant="secondary" size="sm" className="mt-2 min-h-[44px]" onClick={muat}>Coba lagi</Button>
        </div>
      )}
      {!data && !error && <div className="space-y-3" aria-label="Memuat unit" data-testid="ruang-memuat"><div className="h-24 animate-pulse rounded-card bg-inset motion-reduce:animate-none" /><div className="h-48 animate-pulse rounded-card bg-inset motion-reduce:animate-none" /></div>}

      {data && ruang && (
        <div id={`panel-${bagian}`} role="tabpanel" aria-labelledby={`tab-${bagian}`} tabIndex={0} className="outline-none" data-testid={`panel-${bagian}`}>
          {bagian === "ringkasan" && <RingkasanUnit data={data} ruang={ruang} aktif={aktif} onDone={sesudahUbah} onBagian={onBagian} />}
          {bagian === "pekerjaan" && <div className="max-w-[1100px]"><StatusTarget data={data} aktif={aktif} onDone={sesudahUbah} /></div>}
          {bagian === "bahan" && <BahanTab unitId={unitId} data={data} izin={izin} aktif={aktif} onDone={sesudahUbah} onReload={muat} />}
          {bagian === "dokumentasi" && <div className="max-w-[1100px]"><DokumentasiSection unitId={unitId} ruang={ruang} unit={u} onDone={sesudahUbah} onKeBagian={onBagian} /></div>}
          {bagian === "riwayat" && <div className="max-w-[820px] space-y-4"><RingkasanPemakaian data={data} />{data.riwayat?.length ? <Riwayat daftar={data.riwayat} /> : <Kosong>Belum ada riwayat untuk unit ini.</Kosong>}</div>}
        </div>
      )}
    </div>
  );
}
