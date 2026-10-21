import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpenText, Camera, ChevronDown, Clock3, Package, RefreshCw, Search, Target } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { friendlyError } from "@/features/production/experience.js";
import { EmpatStatus, Penanda } from "@/features/production/workspace/StatusMarkers.jsx";
import { FILTERS, SORTS, badgeTarget, bagianUntukAksi, nadaPerhatian, ringkasanKerja, ringkasanPosisi } from "@/features/production/workspace/workListModel.js";

// DAFTAR KERJA (tampilan awal Status Produksi): satu baris ringkas per ORDER; baris dibuka seperti dropdown card berisi unit + SATU tindakan berikutnya + pintasan.
// Dropdown cukup untuk tindakan cepat; konten panjang dibuka di Ruang Kerja Unit. Pencarian/filter/urutan/order terbuka tersimpan di URL (tahan refresh & tombol kembali).
// Animasi buka/tutup ringan dan dimatikan oleh prefers-reduced-motion (kelas motion-reduce).

const GRID = "lg:grid lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1.5fr)_minmax(0,1.7fr)_minmax(0,1.5fr)_88px_minmax(0,1fr)_minmax(0,1.9fr)_24px] lg:items-center lg:gap-x-4";
const PINTASAN = [
  { bagian: "pekerjaan", label: "Target & PIC", Ikon: Target }, { bagian: "bahan", label: "Bahan", Ikon: Package },
  { bagian: "dokumentasi", label: "Dokumentasi", Ikon: Camera }, { bagian: "riwayat", label: "Riwayat", Ikon: BookOpenText },
];

function Perhatian({ p, kecil = false }) {
  if (!p) return <span className="text-[12.5px] text-ink3">Tidak ada</span>;
  return (
    <span className={cn("inline-flex items-start gap-1.5 text-[12.5px] leading-snug", p.level >= 3 ? "text-red" : p.level === 2 ? "text-orange" : "text-ink2")} data-perhatian={p.kode}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /><span className={cn(kecil && "line-clamp-2")}>{p.teks}</span>
    </span>
  );
}

function TargetBadge({ iso, selesai }) {
  const b = badgeTarget(iso, { selesai });
  return <Badge variant={b.nada}>{b.teks}</Badge>;
}

function BarisUnit({ unit, onBuka }) {
  const utama = unit.status === "DELIVERED" || unit.status === "CANCELLED";
  return (
    <li className={cn("rounded-btn bg-surface px-3 py-3", utama && "opacity-70")} data-testid="unit-baris" data-unit-code={unit.unitCode}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-[150px] flex-1">
          <p className="m-0 text-[13.5px] font-semibold text-ink">{unit.unitCode}{utama && <span className="ml-2 text-[11.5px] font-medium text-ink3">{unit.statusUnit}</span>}</p>
          <p className="m-0 text-[12px] text-ink3">{[unit.merk, unit.ukuran].filter(Boolean).join(" · ") || "—"}</p>
          <div className="mt-1.5"><EmpatStatus posisi={unit.posisi} kerja={unit.kerja} alurMeja={utama ? undefined : unit.alurMeja} padat /></div>
          {unit.anomali && <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[12px] text-orange" data-testid="unit-anomali"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />{unit.anomali.teks}</p>}
        </div>
        <div className="flex min-w-[140px] flex-col gap-1 text-[12.5px] text-ink2">
          <span className="flex items-center gap-1.5"><Clock3 size={13} className="text-ink3" aria-hidden /> <TargetBadge iso={unit.targetSelesai?.at} selesai={utama} /></span>
          <span className="text-ink3">PIC: <b className="font-medium text-ink2">{unit.pic?.nama || "belum ada"}</b></span>
          {unit.jadwal && <span className="text-ink3" data-testid="unit-jadwal">Jadwal: <b className="font-medium text-ink2">{String(unit.jadwal.tanggal).slice(8)}/{String(unit.jadwal.tanggal).slice(5, 7)}{unit.jadwal.meja ? ` · ${String(unit.jadwal.meja).replace("TABLE_", "Meja ")}` : ""}</b> <span className="text-[11px]">({unit.jadwal.sumber === "V2" ? "V2" : "Rencana Admin"})</span></span>}
        </div>
        {unit.perhatian && <div className="min-w-[160px] max-w-[260px] flex-1"><Perhatian p={unit.perhatian} /></div>}
      </div>
      {!utama && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={`Pintasan ${unit.unitCode}`}>
          {PINTASAN.map(({ bagian, label, Ikon }) => (
            <Button key={bagian} type="button" variant="neutral" size="sm" className="min-h-[44px] gap-1.5 bg-inset px-3" data-testid={`pintasan-${bagian}`} onClick={() => onBuka(unit.id, bagian)}><Ikon size={14} aria-hidden /> {label}</Button>
          ))}
          <Button type="button" variant="tertiary" size="sm" className="ml-auto min-h-[44px]" data-testid="buka-ruang-kerja" onClick={() => onBuka(unit.id, "ringkasan")}>Buka ruang kerja <ArrowRight size={14} aria-hidden /></Button>
        </div>
      )}
    </li>
  );
}

function BarisOrder({ order, terbuka, onToggle, onBuka, riwayat }) {
  const idPanel = useId(); const r = order.ringkas; const tindakan = r.tindakan;
  const aksiBisaDibuka = tindakan && !["NONE", "WAIT"].includes(tindakan.aksi) && r.unitUtamaId;
  const unitUtama = order.units.find((u) => u.id === r.unitUtamaId);
  return (
    <li className={cn("rounded-card bg-surface transition-shadow motion-reduce:transition-none", terbuka ? "shadow-card ring-1 ring-accent/20" : "hover:shadow-card")} data-testid="order-baris" data-order-id={order.orderId} data-order-number={order.orderNumber} data-terbuka={terbuka ? "1" : "0"}>
      <button type="button" aria-expanded={terbuka} aria-controls={idPanel} onClick={() => onToggle(order.orderId)}
        className={cn("w-full rounded-card px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50", GRID)} data-testid="order-kepala">
        <span className="flex min-w-0 items-start gap-2">
          <ChevronDown size={16} className={cn("mt-0.5 shrink-0 text-ink3 transition-transform motion-reduce:transition-none lg:hidden", terbuka && "rotate-180")} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-ink">{order.pelanggan.nama || "Tanpa nama"}</span>
            <span className="block truncate text-[12px] text-ink3">{order.orderNumber}</span>
          </span>
        </span>
        <span className="mt-1 block min-w-0 lg:mt-0">
          <span className="block truncate text-[13px] text-ink2" title={order.layanan.join(", ")}>{order.layanan.join(" + ") || "Layanan belum tercatat"}</span>
          <span className="block text-[12px] text-ink3">{order.ringkas.jumlahUnit} unit{order.ringkas.jumlahAktif !== order.ringkas.jumlahUnit ? ` · ${order.ringkas.jumlahAktif} aktif` : ""}</span>
        </span>
        <span className="mt-1.5 block min-w-0 text-[12.5px] text-ink2 lg:mt-0" data-testid="kolom-posisi"><span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink3 lg:hidden">Posisi</span>{ringkasanPosisi(r.posisi)}</span>
        <span className="mt-0.5 block min-w-0 text-[12.5px] text-ink2 lg:mt-0" data-testid="kolom-kerja"><span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink3 lg:hidden">Kerja</span>{ringkasanKerja(r.kerja)}</span>
        <span className="mt-1.5 block lg:mt-0" data-testid="kolom-target"><TargetBadge iso={r.targetTerdekat} selesai={riwayat} /></span>
        <span className="mt-0.5 block truncate text-[12.5px] text-ink2 lg:mt-0" data-testid="kolom-pic" title={r.pic.join(", ")}>{r.pic.length ? r.pic.join(", ") : <span className="text-ink3">PIC belum ada</span>}</span>
        <span className="mt-1.5 block lg:mt-0" data-testid="kolom-perhatian"><Perhatian p={r.perhatian} kecil /></span>
        <ChevronDown size={16} className={cn("hidden shrink-0 text-ink3 transition-transform motion-reduce:transition-none lg:block", terbuka && "rotate-180")} aria-hidden />
      </button>

      {terbuka && (
        <div id={idPanel} role="region" aria-label={`Rincian order ${order.orderNumber}`} className="space-y-3 px-4 pb-4 pt-1 motion-safe:animate-[fadein_.15s_ease-out]" data-testid="order-rincian">
          <div className="flex flex-wrap items-center gap-2">
            <Penanda jenis="order" nilai={order.statusOrder.label} nada={order.statusOrder.mentah === "PICKUP" || order.statusOrder.mentah === "PENDING" ? "orange" : order.statusOrder.key === "DIPROSES" ? "accent" : order.statusOrder.key === "SIAP_KIRIM" || order.statusOrder.key === "TERKIRIM" ? "green" : "neutral"} terkunci={order.statusOrder.terkunci} />
            {order.statusOrder.terkunci && <span className="text-[12px] text-ink3">Status order dikunci manual — dibaca dari Sales apa adanya.</span>}
          </div>
          {!riwayat && tindakan && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-inset px-4 py-3" data-testid="order-tindakan">
              <div className="min-w-[200px] flex-1">
                <p className="m-0 text-[11px] font-medium uppercase tracking-[0.05em] text-ink3">Tindakan berikutnya{unitUtama && order.units.filter((u) => u.status !== "DELIVERED" && u.status !== "CANCELLED").length > 1 ? ` · ${unitUtama.unitCode}` : ""}</p>
                <p className="m-0 text-[14.5px] font-semibold text-ink" data-testid="tindakan-label">{tindakan.label}</p>
                <p className="m-0 text-[12.5px] text-ink3">{[tindakan.aktor && tindakan.aktor !== "—" ? `Oleh ${tindakan.aktor}` : null, tindakan.detail].filter(Boolean).join(" · ")}</p>
              </div>
              {aksiBisaDibuka && <Button type="button" className="min-h-[44px]" data-testid="tindakan-buka" onClick={() => onBuka(r.unitUtamaId, ["BELUM_DITERIMA", "ORDER_MASIH_PENGAMBILAN"].includes(r.perhatian?.kode) ? "ringkasan" : bagianUntukAksi(tindakan.aksi))}>{tindakan.aksi === "CONFIRM_ARRIVAL" ? "Lihat unit" : "Kerjakan"} <ArrowRight size={15} aria-hidden /></Button>}
            </div>
          )}
          <ul className="m-0 list-none space-y-2 p-0 [&>li]:bg-inset" aria-label="Unit dalam order">
            {order.units.map((u) => <BarisUnit key={u.id} unit={u} onBuka={onBuka} />)}
          </ul>
        </div>
      )}
    </li>
  );
}

export default function StatusWorkList({ keadaan, onUbah, onBukaUnit, onMuat }) {
  const [data, setData] = useState({ orders: [], counts: null, filterCounts: null, total: 0, hasMore: false, page: 1 });
  const [memuat, setMemuat] = useState(true); const [lagi, setLagi] = useState(false); const [galat, setGalat] = useState("");
  const [cari, setCari] = useState(keadaan.q); const reqRef = useRef(0);
  const { scope, q, filter, sort, buka } = keadaan;

  useEffect(() => { setCari(q); }, [q]);
  useEffect(() => { if (cari === q) return undefined; const t = setTimeout(() => onUbah({ q: cari }, { ganti: true }), 300); return () => clearTimeout(t); }, [cari]); // eslint-disable-line react-hooks/exhaustive-deps

  const muat = useCallback(async (halaman = 1, { tambah = false } = {}) => {
    const id = ++reqRef.current; if (tambah) setLagi(true); else { setMemuat(true); } setGalat("");
    try {
      const d = await api.getProductionWorkList({ scope, q: q || undefined, filter: scope === "aktif" ? filter : undefined, sort: scope === "aktif" ? sort : undefined, page: halaman, pageSize: 25 });
      if (id !== reqRef.current) return;
      setData((prev) => ({ ...d, orders: tambah ? [...prev.orders, ...d.orders.filter((o) => !prev.orders.some((x) => x.orderId === o.orderId))] : d.orders }));
      onMuat?.(d);
    } catch (e) { if (id === reqRef.current) setGalat(friendlyError(e)); } finally { if (id === reqRef.current) { setMemuat(false); setLagi(false); } }
  }, [scope, q, filter, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { muat(1); }, [muat]);

  const counts = data.counts; const fc = data.filterCounts;
  const toggle = (orderId) => onUbah({ buka: buka === orderId ? null : orderId }, { ganti: true });

  return (
    <div className="space-y-4" data-testid="daftar-kerja">
      {/* Antrean: Aktif | Riwayat */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Antrean" className="flex rounded-btn bg-inset p-0.5">
          {[["aktif", "Aktif", counts?.aktif], ["riwayat", "Riwayat", counts?.riwayat]].map(([k, l, n]) => (
            <button key={k} type="button" role="tab" aria-selected={scope === k} data-testid={`antrean-${k}`} onClick={() => onUbah({ scope: k, buka: null, filter: "SEMUA" })}
              className={cn("flex min-h-[40px] items-center gap-2 rounded-btn px-3.5 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent/40", scope === k ? "bg-surface text-accent shadow-sm" : "text-ink3")}>{l}{n != null && <span className="rounded-chip bg-inset px-1.5 text-[11px] tabular-nums text-ink2">{n}</span>}</button>
          ))}
        </div>
        <label className="relative min-w-[220px] flex-1 sm:max-w-[420px]">
          <span className="sr-only">Cari pelanggan, nomor order, kode unit, atau layanan</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari pelanggan, order, kode unit, layanan…" data-testid="daftar-cari"
            className="h-11 w-full rounded-btn border border-line bg-surface pl-9 pr-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
        </label>
        {scope === "aktif" && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink3"><span>Urutkan</span>
            <select value={sort} onChange={(e) => onUbah({ sort: e.target.value }, { ganti: true })} data-testid="daftar-urut" className="h-11 rounded-btn border border-line bg-surface px-3 text-[13.5px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select></label>
        )}
        <Button type="button" variant="neutral" size="sm" className="ml-auto min-h-[40px]" onClick={() => muat(1)} disabled={memuat}><RefreshCw size={14} className={memuat ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /> Muat ulang</Button>
      </div>

      {scope === "aktif" && (
        <div role="group" aria-label="Filter cepat" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" data-testid="filter-cepat">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} data-testid={`filter-${f.key}`} onClick={() => onUbah({ filter: f.key, buka: null }, { ganti: true })}
              className={cn("flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border px-3 text-[12.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent/40", filter === f.key ? "border-accent bg-accentbg text-accent" : "border-line bg-surface text-ink2 hover:bg-hovertint")}>
              {f.label}{fc && <span className="rounded-chip bg-inset px-1.5 text-[11px] tabular-nums text-ink2">{fc[f.key] ?? 0}</span>}
            </button>
          ))}
        </div>
      )}

      {galat && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{galat} <button type="button" className="ml-2 font-semibold underline" onClick={() => muat(1)}>Coba lagi</button></div>}

      {/* kepala kolom (desktop) */}
      <div className={cn("hidden px-4 text-[11px] font-medium uppercase tracking-[0.05em] text-ink3", GRID)} aria-hidden>
        <span>Pelanggan · order</span><span>Pekerjaan</span><span>Posisi fisik</span><span>Status kerja</span><span>Target</span><span>PIC</span><span>Perhatian utama</span><span />
      </div>

      {memuat && !data.orders.length ? (
        <div className="space-y-2" aria-label="Memuat daftar kerja">{[1, 2, 3, 4].map((n) => <Card key={n} className="h-[68px] animate-pulse bg-inset motion-reduce:animate-none" />)}</div>
      ) : data.orders.length === 0 ? (
        <Card className="p-0"><EmptyState icon={Search} title={q || filter !== "SEMUA" ? "Tidak ada order yang cocok" : scope === "riwayat" ? "Belum ada order selesai" : "Tidak ada order aktif"}
          description={q || filter !== "SEMUA" ? "Ubah kata kunci atau filter. Order yang sudah terkirim ada di Riwayat." : scope === "riwayat" ? "Order yang seluruh unitnya sudah terkirim akan tampil di sini." : "Order baru akan muncul setelah ada unit yang perlu dikerjakan."}
          action={(q || filter !== "SEMUA") ? <Button type="button" variant="secondary" size="sm" className="min-h-[44px]" onClick={() => onUbah({ q: "", filter: "SEMUA" }, { ganti: true })}>Hapus pencarian dan filter</Button> : null} /></Card>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0" data-testid="daftar-order" aria-busy={memuat}>
          {data.orders.map((o) => <BarisOrder key={o.orderId} order={o} terbuka={buka === o.orderId} onToggle={toggle} onBuka={onBukaUnit} riwayat={scope === "riwayat"} />)}
        </ul>
      )}

      {data.orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ink3" data-testid="daftar-jumlah">
          <span>Menampilkan <b className="text-ink">{data.orders.length}</b> dari <b className="text-ink">{data.total}</b> order</span>
          {data.hasMore && <Button type="button" variant="secondary" size="sm" className="min-h-[44px]" data-testid="daftar-lagi" disabled={lagi} onClick={() => muat(data.page + 1, { tambah: true })}>{lagi ? "Memuat…" : "Muat lebih banyak"}</Button>}
        </div>
      )}
    </div>
  );
}

export { Perhatian, TargetBadge, nadaPerhatian };
