import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Hourglass } from "lucide-react";
import { api } from "@/api.js";
import { toApiParams } from "@/lib/dateRange.js";
import { formatRupiah, ORDER_STATUS_LABELS, orderStatusVariant, PAYMENT_STATUS_LABELS, paymentStatusVariant } from "@/utils/format.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";

// ═══ PIPELINE BERBASIS ORDER (30 September 2026, permintaan owner) ═════════
// Papan Pipeline biasa mengelompokkan PELANGGAN menurut stage penjualan
// (New/Prospek/Transaksi/Reviewed/Spam). Papan ini mengelompokkan ORDER
// menurut status pengerjaannya. READ-ONLY: status order dihitung otomatis dari
// progres unit (bengkel/armada), jadi tidak ada drag & drop di sini.
const KATEGORI = { LAYANAN: "Layanan", BARU: "Kasur Baru", SEWA: "Sewa" };
const BATCH = 20;
const STALE_MENUNGGU_HARI = 14;

// dot = warna titik kolom; inOmset = dihitung omset atau tidak.
const KOLOM = {
  PENDING:      { dot: "bg-orange", inOmset: false, info: "Order sudah diinput tapi belum pasti dikerjakan — misalnya customer sudah fix tapi minta dikerjakan 2 minggu lagi. BELUM dihitung omset. Kalau sudah pasti, ubah statusnya supaya nilainya masuk omset." },
  PICKUP:       { dot: "bg-accent", inOmset: true, info: "Kasur sedang dijemput dari customer untuk dikerjakan (tahap awal proses layanan)." },
  PROCESSING:   { dot: "bg-accent", inOmset: true, info: "Sedang dikerjakan di workshop/bengkel." },
  READY:        { dot: "bg-accent", inOmset: true, info: "Pengerjaan selesai, siap diantar ke customer." },
  SHIPPING:     { dot: "bg-green", inOmset: true, info: "Sedang di jalan, diantar driver ke customer." },
  DELIVERED:    { dot: "bg-green", inOmset: true, info: "Sudah sampai ke customer." },
  SEWA_DIKIRIM: { dot: "bg-accent", inOmset: true, info: "Order sewa: kasur sewa sedang/sudah dikirim ke penyewa." },
  SEWA_DIAMBIL: { dot: "bg-green", inOmset: true, info: "Order sewa: masa sewa selesai dan kasur diambil kembali." },
  CANCELLED:    { dot: "bg-inset", inOmset: false, info: "Order dibatalkan. Tidak dihitung omset." },
};

function OrderCard({ o, onOpen }) {
  const lamaMenunggu = o.status === "PENDING" && o.daysSince >= STALE_MENUNGGU_HARI;
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      aria-label={`Buka chat ${o.customerName || o.customerPhone}`}
      className="cursor-pointer rounded-xl bg-surface p-2.5 shadow-card transition-shadow hover:shadow-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-ink">{o.customerName || o.customerPhone || "—"}</p>
        <span className="shrink-0 text-[13px] font-bold tabular-nums text-ink">{formatRupiah(o.value)}</span>
      </div>
      <p className="mt-0.5 truncate text-[11px] tabular-nums text-ink3">
        {o.orderNumber} · {KATEGORI[o.category] || o.category}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={paymentStatusVariant(o.paymentStatus)}>{PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus}</Badge>
        {o.assignedSalesName && <span className="truncate text-[11px] text-ink3">{o.assignedSalesName}</span>}
        {lamaMenunggu && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-orange" title={`Menunggu ${o.daysSince} hari tanpa perubahan`}>
            <Hourglass size={10} /> {o.daysSince} hari
          </span>
        )}
      </div>
    </div>
  );
}

export default function OrderPipelineBoard({ range, cari, filterSales }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState({});

  useEffect(() => {
    if ((!!range?.from) !== (!!range?.to)) return;
    let batal = false;
    setData(null); setError(null);
    api.getPipelineOrderBoard(toApiParams(range))
      .then((d) => { if (!batal) setData(d); })
      .catch((e) => { if (!batal) setError(e.message || "Gagal memuat"); });
    return () => { batal = true; };
  }, [range?.from, range?.to]);

  const kolom = useMemo(() => {
    if (!data) return [];
    const q = (cari || "").trim().toLowerCase();
    return data.statuses.map((st) => {
      let list = data.board[st] || [];
      if (filterSales) list = list.filter((o) => o.assignedSalesId === filterSales);
      if (q) {
        list = list.filter((o) =>
          (o.customerName || "").toLowerCase().includes(q) ||
          (o.customerPhone || "").includes(q) ||
          (o.orderNumber || "").toLowerCase().includes(q));
      }
      return { st, list, total: list.reduce((n, o) => n + o.value, 0) };
    // Kolom sewa hanya tampil kalau ada isinya — bagian besar pengguna tidak punya order sewa.
    }).filter((k) => !k.st.startsWith("SEWA_") || k.list.length > 0);
  }, [data, cari, filterSales]);

  function buka(o) {
    if (o.conversationId) navigate(`/inbox?conv=${o.conversationId}`);
    else navigate(`/customers?id=${o.customerId}`);
  }

  if (error) return <p className="text-sm text-ink3">Pipeline order gagal dimuat: {error}</p>;
  if (!data) {
    return (
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex w-64 shrink-0 flex-col gap-2 rounded-2xl bg-inset/80 p-2.5">
            <Skeleton className="h-5 w-24" />
            {[0, 1].map((j) => <Skeleton key={j} className="h-20 rounded-xl" />)}
          </div>
        ))}
      </div>
    );
  }

  const pasti = kolom.filter((k) => KOLOM[k.st]?.inOmset).reduce((n, k) => n + k.total, 0);
  const menunggu = kolom.find((k) => k.st === "PENDING")?.total || 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-ink3">
        Papan ini mengelompokkan <strong className="text-ink2">order</strong> menurut status pengerjaannya, bukan menurut jenis pelanggan.
        Status berubah otomatis mengikuti progres bengkel dan pengiriman, jadi kartu tidak bisa digeser.
        Nilai order pasti <strong className="text-ink2">{formatRupiah(pasti)}</strong>
        {menunggu > 0 && <> · Menunggu <strong className="text-ink2">{formatRupiah(menunggu)}</strong> (belum masuk omset)</>}.
      </p>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {kolom.map(({ st, list, total }) => {
          const meta = KOLOM[st] || { dot: "bg-ink3", inOmset: true, info: "" };
          const lim = limit[st] || BATCH;
          const tampil = list.slice(0, lim);
          const sisa = list.length - tampil.length;
          return (
            <div key={st} className="flex min-w-[264px] max-w-[360px] flex-1 flex-col rounded-2xl bg-inset/80 p-2.5">
              <div className="flex items-center gap-2 px-0.5">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)} />
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs font-bold text-ink2">
                  {ORDER_STATUS_LABELS[st] || st}
                  {meta.info && <InfoTooltip text={meta.info} />}
                </span>
                <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink2">
                  {list.length.toLocaleString("id-ID")}
                </span>
              </div>
              <div className="mb-2 mt-1 flex items-baseline justify-between gap-2 px-0.5">
                <span className={cn("text-[13px] font-bold tabular-nums", meta.inOmset ? "text-ink" : "text-ink3")}>
                  {formatRupiah(total)}
                </span>
                {!meta.inOmset && <span className="shrink-0 text-[10px] font-semibold text-ink3">tidak masuk omset</span>}
              </div>
              <div className="flex max-h-[calc(100vh-330px)] min-h-24 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {tampil.map((o) => <OrderCard key={o.id} o={o} onOpen={() => buka(o)} />)}
                {sisa > 0 && (
                  <button
                    type="button"
                    onClick={() => setLimit((p) => ({ ...p, [st]: lim + BATCH * 2 }))}
                    className="rounded-xl bg-surface px-2 py-2 text-[11px] font-semibold text-accent transition-colors hover:bg-accentbg"
                  >
                    Muat {Math.min(sisa, BATCH * 2)} lagi · sisa {sisa.toLocaleString("id-ID")}
                  </button>
                )}
                {list.length === 0 && (
                  <div className="flex min-h-16 items-center justify-center rounded-xl px-2 py-3 text-center text-[11px] text-ink3">Kosong</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
