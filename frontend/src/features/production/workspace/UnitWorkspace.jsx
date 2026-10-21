import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Info, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { friendlyError } from "@/features/production/experience.js";
import { unitDetailPath } from "@/lib/legacyProductionRoutes.js";
import MaterialPlanEditor from "@/features/production/MaterialPlanEditor.jsx";
import { Bagian, Kosong, KartuPenerimaan, PemakaianAktual, Riwayat, StatusTarget, TindakanUtama } from "@/features/production/OrderProduksiPanel.jsx";
import DokumentasiSection from "@/features/production/workspace/DokumentasiSection.jsx";
import { EmpatStatus } from "@/features/production/workspace/StatusMarkers.jsx";
import { BAGIAN, badgeTarget, teksTahapMeja } from "@/features/production/workspace/workListModel.js";
import { formatTanggal } from "@/utils/formatDate.js";
import { waktuWib } from "@/features/production/orderProduksiModel.js";

// RUANG KERJA UNIT — menggantikan modal panjang. Header ringkas yang tetap terlihat (kode, pelanggan, empat status terpisah), lalu bagian Ringkasan · Pekerjaan · Bahan · Dokumentasi · Riwayat
// (satu bagian per tab; tab tersimpan di URL). Yang relevan dulu; detail Sales, seluruh timestamp, dan data lanjutan dibuka lewat "Detail lanjutan". Di desktop memakai dua kolom, di HP satu kolom
// tanpa scroll mendatar. Isi bagian memakai komponen yang SAMA dengan panel Order Produksi (satu sumber perilaku): status kerja manual, status order, target, rencana bahan, pemakaian aktual.

const aktifUnit = (s) => !["CANCELLED", "DELIVERED"].includes(s);

/** Alasan jujur + jalur bila tindakan utama tidak punya tombol di sini (tidak ada tombol yang pasti gagal). */
export function penjelasanTertahan(data, ruang) {
  const t = data?.adopsi?.tindakan; if (!t) return null;
  if (t.aksi === "WAIT") return { teks: `Menunggu ${t.aktor && t.aktor !== "—" ? t.aktor : "pihak lain"}${t.detail ? ` — ${t.detail}` : ""}. Tidak ada yang perlu dikerjakan Admin sekarang.`, jalur: null };
  return null;
}

function Fakta({ label, children }) {
  return <div className="min-w-0"><dt className="m-0 text-[11px] font-medium uppercase tracking-[0.05em] text-ink3">{label}</dt><dd className="m-0 mt-0.5 text-[13.5px] text-ink">{children}</dd></div>;
}

function Ringkasan({ data, ruang, aktif, onDone }) {
  const { adopsi: ad, unit: u } = data; const meja = teksTahapMeja(ruang?.alurMeja); const target = badgeTarget(ad.targetSelesai?.at);
  const tahan = penjelasanTertahan(data, ruang);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" data-testid="bagian-ringkasan">
      <div className="space-y-4">
        <TindakanUtama data={data} aktif={aktif} onDone={onDone} onBukaUnit360={() => {}} />
        <KartuPenerimaan data={data} aktif={aktif} onDone={onDone} />
        {tahan && (
          <p role="note" data-testid="tindakan-tertahan" className="m-0 flex items-start gap-2 rounded-btn bg-inset px-4 py-3 text-[13px] text-ink2"><Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden /><span>{tahan.teks}{tahan.jalur && <> <Link to={tahan.jalur.to} className="font-semibold text-accent underline">{tahan.jalur.label}</Link></>}</span></p>
        )}
      </div>
      <div className="space-y-4">
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 rounded-card bg-inset px-4 py-4" data-testid="fakta-utama">
          <Fakta label="Layanan Sales">{ruang?.order?.layanan?.join(" + ") || "belum tercatat"}</Fakta>
          <Fakta label="Kasur">{[u.merk, u.ukuran].filter(Boolean).join(" · ") || "—"}</Fakta>
          <Fakta label="Target selesai"><Badge variant={target.nada}>{target.teks}</Badge></Fakta>
          <Fakta label="PIC · meja">{ad.pic?.nama || "Belum ada"}{ad.meja ? ` · ${String(ad.meja).replace("TABLE_", "Meja ")}` : ""}</Fakta>
          <Fakta label="Tahap Meja">{meja.teks}</Fakta>
          <Fakta label="Bahan">{ad.aktualBahanAda ? "Pemakaian tercatat" : ad.rencanaBahanAda ? "Ada rencana, belum dipakai" : "Belum direncanakan"}</Fakta>
        </dl>
        <details className="group rounded-card border border-line px-4 py-3" data-testid="detail-lanjutan">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[13.5px] font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Detail lanjutan: Sales, waktu, dan data lain</summary>
          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fakta label="Status order (Sales)">{ruang?.order?.statusOrder?.label}{ruang?.order?.statusOrder?.terkunci ? " · dikunci manual" : ""}</Fakta>
            <Fakta label="Kode status tersimpan">{ruang?.order?.statusOrder?.mentah} / {u.status}</Fakta>
            <Fakta label="Pelanggan">{u.order?.customer?.name || "—"}</Fakta>
            <Fakta label="Order">{u.order?.orderNumber} · {u.order?.jumlahUnit} unit</Fakta>
            <Fakta label="Target di unit">{u.productionDueAt ? formatTanggal(u.productionDueAt) : "belum diisi"}</Fakta>
            <Fakta label="Terakhir diubah">{waktuWib(u.updatedAt)}</Fakta>
            <Fakta label="Prioritas">{u.priority || "—"}</Fakta>
            <Fakta label="Posisi (detail)">{ad.posisi?.detail || data.receivedBasisLabel || "—"}</Fakta>
          </dl>
          {u.order?.unitLain?.length > 0 && <p className="m-0 mt-3 text-[12.5px] text-ink3">Unit lain di order ini: {u.order.unitLain.map((x) => x.unitCode).join(", ")}.</p>}
          <p className="m-0 mt-3"><Link to={unitDetailPath(u.id)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent underline">Buka Unit 360 (tahap, QC, biaya) <ExternalLink size={12} aria-hidden /></Link></p>
        </details>
      </div>
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
          {bagian === "ringkasan" && <Ringkasan data={data} ruang={ruang} aktif={aktif} onDone={sesudahUbah} />}
          {bagian === "pekerjaan" && <div className="max-w-[1100px]"><StatusTarget data={data} aktif={aktif} onDone={sesudahUbah} /></div>}
          {bagian === "bahan" && (
            <div className="grid gap-6 xl:grid-cols-2" data-testid="bagian-bahan">
              <div><MaterialPlanEditor unitId={unitId} rencana={data.rencanaBahan} bolehUbah={!!izin.rencanaBahan} unitAktif={aktif} onSaved={() => sesudahUbah()} onReload={muat} /></div>
              <Bagian id="sec-aktual" judul="Pemakaian aktual" aksi={<Badge variant="orange" title="Setiap catatan di sini mengurangi stok Gudang tepat sekali.">Aktual · mengurangi stok</Badge>}>
                <PemakaianAktual data={data} aktif={aktif} bolehCatat={!!izin.pemakaianAktual} onDone={sesudahUbah} />
              </Bagian>
            </div>
          )}
          {bagian === "dokumentasi" && <div className="max-w-[1100px]"><DokumentasiSection unitId={unitId} ruang={ruang} unit={u} onDone={sesudahUbah} onKeBagian={onBagian} /></div>}
          {bagian === "riwayat" && <div className="max-w-[820px]">{data.riwayat?.length ? <Riwayat daftar={data.riwayat} /> : <Kosong>Belum ada riwayat untuk unit ini.</Kosong>}</div>}
        </div>
      )}
    </div>
  );
}
