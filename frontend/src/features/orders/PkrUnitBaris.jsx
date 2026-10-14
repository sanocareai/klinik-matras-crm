import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import PanelIdentitasPkr from "@/features/orders/PanelIdentitasPkr.jsx";
import {
  unitBarisOrder, ringkasUnitTeks, ringkasIndukTeks, rencanaUnitTeks, ukuranSpesifikasiTeks, rapikanUkuran, VARIAN_PRODUKSI_UNIT, varianDeliveryUnit, labelUnit,
} from "@/features/orders/pkrUnitLogic.js";

// REPRESENTASI MULTI-UNIT Order CRM Penjualan Karyawan. Satu PKR = SATU order induk; tiap unit produksi (U1, U2, …) hanya SUB-BARIS di bawahnya —
// bukan order baru, tanpa nominal, tanpa pembayaran. Klik sub-baris membuka Unit 360 (onBuka(unitId)).
// Dipakai di: tabel desktop (diperluas/ditutup), kartu papan/mobile (daftar langsung), dan drawer rincian order.

const stop = (e) => e.stopPropagation();

/** Ringkasan induk satu baris teks: "3 Unit Produksi · Dijadwalkan 0/3 · Sedang diproduksi 0/3 · Siap 3/3 · Terkirim 0/3". */
export function RingkasUnitPkr({ pkr, className = "" }) {
  // Satu baris: "1 item • 3 unit • 3 siap • 0 terkirim" (14 Okt 2026) — rincian per tahap ada di sub-baris unit, tidak diulang di sini.
  const ringkas = ringkasIndukTeks(pkr);
  if (!ringkas) return null;
  return (
    <p className={`m-0 whitespace-normal text-[11px] font-semibold leading-snug text-ink2 ${className}`} data-testid="pkr-unit-ringkas">{ringkas}</p>
  );
}

/** Tombol buka/tutup sub-baris (desktop). `terbuka` + `onToggle` dikendalikan induk. */
export function TombolPerluasUnit({ order, terbuka, onToggle }) {
  const n = unitBarisOrder(order).length;
  if (n === 0) return null;
  const Ikon = terbuka ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={(e) => { stop(e); onToggle(order.id); }}
      aria-expanded={terbuka}
      aria-label={`${terbuka ? "Tutup" : "Buka"} ${n} unit produksi order ${order.orderNumber || ""}`.trim()}
      className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-btn bg-inset px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-ink2 hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      data-testid="pkr-unit-toggle"
    >
      <Ikon size={12} aria-hidden="true" /> {n} unit
    </button>
  );
}

function BadgeProduksi({ u }) {
  return (
    <Badge variant={VARIAN_PRODUKSI_UNIT[u.produksi?.kode] || "neutral"} title={u.produksi?.tahap ? `Tahap: ${u.produksi.tahap}` : undefined}>
      {u.produksi?.label}{u.produksi?.tahap && u.produksi.kode === "IN_PRODUCTION" ? ` · ${u.produksi.tahap}` : ""}
    </Badge>
  );
}

/** Satu unit sebagai kartu (mobile/papan/drawer). */
function KartuUnit({ u, onBuka }) {
  return (
    <button
      type="button"
      onClick={(e) => { stop(e); onBuka?.(u.id); }}
      aria-label={labelUnit(u)}
      className="block w-full min-w-0 rounded-btn bg-inset px-2.5 py-2 text-left hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      data-testid="pkr-unit-baris" data-unit-kode={u.kode}
    >
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-all font-mono text-[11px] font-semibold text-ink">{u.kode}</span>
        <span className="shrink-0 text-[10.5px] font-semibold text-ink3">{u.urutanLabel}</span>
      </span>
      <span className="mt-0.5 block whitespace-normal break-words text-[12px] font-semibold text-ink2">{u.item?.nama}</span>
      <span className="block whitespace-normal break-words text-[11.5px] text-ink3">{ukuranSpesifikasiTeks(u)}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1">
        <BadgeProduksi u={u} />
        <Badge variant={varianDeliveryUnit(u.delivery?.kode)}>{u.delivery?.label}</Badge>
      </span>
      <span className="mt-1 block whitespace-normal text-[11px] text-ink3">
        {rencanaUnitTeks(u.rencana)} · {u.kirim?.label}{u.delivery?.tanggal ? ` · Kirim ${u.delivery.tanggal.slice(8, 10)}/${u.delivery.tanggal.slice(5, 7)}` : ""}
      </span>
    </button>
  );
}

/** Daftar unit sebagai kartu bertumpuk — papan, mobile, dan drawer. */
export function DaftarUnitPkr({ pkr, onBuka, className = "" }) {
  const baris = pkr?.unitBaris || [];
  if (baris.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} data-testid="pkr-unit-daftar">
      <RingkasUnitPkr pkr={pkr} />
      {baris.map((u) => <KartuUnit key={u.id} u={u} onBuka={onBuka} />)}
    </div>
  );
}

const KOLOM = "grid grid-cols-[minmax(0,10rem)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)] gap-x-3";

/** Blok sub-baris desktop (isi <td colSpan> di bawah baris induk). */
export function SubBarisUnitPkr({ pkr, onBuka }) {
  const baris = pkr?.unitBaris || [];
  if (baris.length === 0) return null;
  return (
    <div className="space-y-2 py-1" data-testid="pkr-unit-subbaris" onClick={stop}>
      <PanelIdentitasPkr pkr={pkr} />
      <div role="table" aria-label="Unit produksi order" className="min-w-[760px]">
        <div role="row" className={`${KOLOM} px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink3`}>
          <span role="columnheader">Unit</span><span role="columnheader">Item</span><span role="columnheader">Ukuran &amp; spesifikasi</span>
          <span role="columnheader">Produksi</span><span role="columnheader">Rencana &amp; PIC</span><span role="columnheader">Delivery</span>
        </div>
        {baris.map((u) => (
          <button
            key={u.id} type="button" role="row"
            onClick={(e) => { stop(e); onBuka?.(u.id); }}
            aria-label={labelUnit(u)}
            className={`${KOLOM} w-full items-start rounded-btn px-2 py-1.5 text-left text-[12px] text-ink2 hover:bg-hovertint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
            data-testid="pkr-unit-baris" data-unit-kode={u.kode}
          >
            <span role="cell" className="min-w-0">
              <span className="block break-all font-mono text-[11px] font-semibold text-ink">{u.kode}</span>
              <span className="block text-[10.5px] text-ink3">{u.urutanLabel}</span>
            </span>
            <span role="cell" className="min-w-0 whitespace-normal break-words font-semibold text-ink">{u.item?.nama}</span>
            <span role="cell" className="min-w-0 whitespace-normal break-words">{ukuranSpesifikasiTeks({ ...u, ukuran: rapikanUkuran(u.ukuran) })}</span>
            <span role="cell" className="min-w-0"><BadgeProduksi u={u} /></span>
            <span role="cell" className="min-w-0 whitespace-normal text-ink3">{rencanaUnitTeks(u.rencana)}</span>
            <span role="cell" className="min-w-0 space-y-0.5">
              <Badge variant={varianDeliveryUnit(u.delivery?.kode)}>{u.delivery?.label}</Badge>
              <span className="block text-[10.5px] text-ink3">{u.kirim?.label}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
