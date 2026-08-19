import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, X, RefreshCw, Download, LayoutGrid, List as ListIcon,
  AlertTriangle, Clock, MessageSquare, Package,
} from "lucide-react";
import { api } from "../api.js";
import {
  formatRupiah, formatRupiahShort,
  ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES,
  PIPELINE_STAGES, STAGE_LABELS, stageVariant,
} from "../utils/format.js";
import { formatTanggalPendek } from "../utils/formatDate.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { badgeVariants } from "@/components/ui/badge.jsx";
import Avatar from "../components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { isAdminUser } from "@/lib/roles.js";
import OrderTimelineDrawer from "../features/orders/OrderTimelineDrawer.jsx";

// D-025 (revisi 19 Agustus 2026): order yang sudah LUNAS dikunci dari
// SALES/role lain — cuma admin yang bisa mengedit lagi (backend menegakkan
// ini di routes/orders.js, guardOrderLocked()). Pemicunya SEMPAT status
// DELIVERED, diubah setelah tes pilot: order yang sudah terkirim tapi
// BELUM lunas (COD belum ditagih, dst) ternyata tetap butuh diedit sales.
// Helper ini cuma untuk UI: nonaktifkan kontrol yang akan ditolak, supaya
// sales tidak klik lalu kaget oleh error, bukan sumber kebenaran otorisasi.
function currentUser() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}
import DateRangePicker from "../components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "../lib/dateRange.js";
import PageErrorBoundary from "../components/PageErrorBoundary.jsx";

// ═══ HALAMAN ORDER ════════════════════════════════════════════════════════
// Kenapa halaman TERSENDIRI, bukan tab di Pelanggan:
// tabel Pelanggan berisi 1.297 pelanggan sementara hanya ~68 punya order, jadi
// order yang sedang dikerjakan tenggelam di antara ribuan lead dingin — dan
// 1 pelanggan dengan 3 order tidak bisa dibaca dalam satu baris pelanggan.
// Di sini 1 BARIS = 1 ORDER, sehingga pertanyaan operasional dasar ("mana yang
// sedang diproses?", "mana yang mandek?") bisa dijawab sekali lihat.
//
// Alur kerja produksi (BUKAN alfabet) — urutan ini yang membuat papan terbaca
// sebagai antrean, bukan daftar acak.
const ALUR = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED"];
const SEMUA_STATUS = [...ALUR, "CANCELLED"];

const STATUS_TONE = {
  PENDING:    { chip: "bg-orangebg text-orange", dot: "bg-orange" },
  PICKUP:     { chip: "bg-accentbg text-accent", dot: "bg-accent" },
  PROCESSING: { chip: "bg-accentbg text-accent", dot: "bg-accent" },
  READY:      { chip: "bg-accentbg text-accent", dot: "bg-accent" },
  DELIVERED:  { chip: "bg-greenbg text-green",   dot: "bg-green" },
  CANCELLED:  { chip: "bg-redbg text-red",       dot: "bg-red" },
};

const KATEGORI_LABELS = { LAYANAN: "Layanan", SEWA: "Sewa", BARU: "Baru" };

// Ambang "mandek": order yang tertahan di satu status kerja terlalu lama.
// DELIVERED/CANCELLED dikecualikan — itu status AKHIR, lama di sana normal.
const MANDEK_HARI = 7;
const isMandek = (o) =>
  !["DELIVERED", "CANCELLED"].includes(o.status) && (o.daysInStatus || 0) >= MANDEK_HARI;

// Dropdown status berwarna sesuai STATUS_TONE — dipakai di board (OrderCard)
// & tabel, supaya status BISA diubah langsung di halaman Order, tanpa harus
// buka percakapan customer dulu (sebelumnya satu-satunya jalur ubah status
// ada di drawer profil pelanggan / chat). stopPropagation supaya klik select
// tidak ikut memicu aksi lain di kartu/baris (mis. buka timeline).
//
// Integrasi Fase 1 (D-006): Order.status sekarang DIHITUNG OTOMATIS dari
// status unit di Bengkel (weakest-link). Memilih status di sini TETAP
// berfungsi — tapi sekarang berarti OVERRIDE MANUAL (mengunci, tidak lagi
// ikut hitungan otomatis) sampai dilepas dari drawer profil pelanggan >
// tab Order. Kunci 🔒 menandai order yang sedang di-override.
function StatusSelect({ order, onChange, className }) {
  const tone = STATUS_TONE[order.status] || { chip: "bg-inset text-ink2" };
  return (
    <select
      value={order.status}
      onChange={(e) => onChange(order, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      title={order.statusLocked ? "Status di-override manual — ikut hitungan otomatis lagi lewat drawer profil pelanggan" : "Status dihitung otomatis dari unit"}
      aria-label={`Ubah status order ${order.orderNumber || ""}`}
      className={cn(
        "cursor-pointer appearance-none rounded-chip border-0 py-0.5 pl-2 pr-1 text-[10px] font-semibold uppercase",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        tone.chip, className
      )}
    >
      {SEMUA_STATUS.map((s) => (
        <option key={s} value={s}>
          {order.statusLocked && s === order.status ? "🔒 " : ""}{ORDER_STATUS_LABELS[s] || s}
        </option>
      ))}
    </select>
  );
}

// Dropdown TAHAP PIPELINE customer, langsung dari halaman Order — sebelumnya
// sales yang sedang mengecek/mengubah status ORDER (StatusSelect di atas)
// harus pindah dulu ke halaman Pelanggan/Pipeline kalau juga perlu update
// tahap pipeline-nya (mis. tandai "Paid" setelah order lunas & terkirim).
// Warna chip pakai badgeVariants yang SAMA dengan Badge pipeline di
// Pelanggan/Pipeline (stageVariant), supaya tidak ada skema warna kedua.
function PipelineStageSelect({ order, onChange, className }) {
  return (
    <select
      value={order.pipelineStage || "NEW"}
      onChange={(e) => onChange(order, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Ubah tahap pipeline untuk ${order.customerName || "pelanggan"}`}
      className={cn(
        badgeVariants({ variant: stageVariant(order.pipelineStage) }),
        "cursor-pointer appearance-none border-0 py-0.5 pl-2 pr-1 text-[10px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className
      )}
    >
      {PIPELINE_STAGES.map(({ value, label }) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}

// FITUR (tambahan): status Pembayaran (Belum Bayar/DP/Lunas) SEBELUMNYA cuma
// badge statis di halaman ini — satu-satunya jalur mengubahnya adalah masuk
// dulu ke drawer profil pelanggan (Customer 360 > tab Order), lalu balik lagi
// ke halaman ini untuk lihat hasilnya (yang tidak auto-refresh, jadi terasa
// seperti "sudah diganti tapi tidak berubah"). Sekarang bisa diedit langsung
// di sini, pola SAMA dengan StatusSelect/PipelineStageSelect di atas —
// refetch penuh via `load()` setelah berhasil, jadi badge yang sama langsung
// menampilkan nilai baru, bukan menunggu navigasi ulang.
const PAYMENT_TONE = {
  BELUM_BAYAR: "bg-redbg text-red",
  DP:          "bg-orangebg text-orange",
  LUNAS:       "bg-greenbg text-green",
};
function PaymentStatusSelect({ order, onChange, className, locked }) {
  return (
    <select
      value={order.paymentStatus || "BELUM_BAYAR"}
      onChange={(e) => onChange(order, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      disabled={locked}
      aria-label={`Ubah status pembayaran untuk ${order.customerName || "pelanggan"}`}
      title={locked ? "Order sudah LUNAS — cuma admin yang bisa ubah pembayaran" : undefined}
      className={cn(
        "appearance-none rounded-chip border-0 py-0.5 pl-2 pr-1 text-[10px] font-semibold",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        PAYMENT_TONE[order.paymentStatus || "BELUM_BAYAR"],
        className
      )}
    >
      {PAYMENT_STATUSES.map((s) => (
        <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s] || s}</option>
      ))}
    </select>
  );
}

function OrderCard({ order, onOpenChat, onOpenTimeline, onStatusChange, onStageChange, onPaymentChange, paymentLocked }) {
  const mandek = isMandek(order);
  const nama = order.customerName || order.customerPhone || "Tanpa nama";
  return (
    <div className="rounded-xl bg-surface p-2.5 shadow-card transition-shadow duration-150 hover:shadow-popover">
      <div className="flex items-start gap-2">
        <Avatar name={nama} src={order.profilePictureUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink">{nama}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink3">
            {order.orderNumber || "tanpa ID"}
          </p>
        </div>
        <PaymentStatusSelect order={order} onChange={onPaymentChange} className="shrink-0" locked={paymentLocked} />
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <StatusSelect order={order} onChange={onStatusChange} className="flex-1" />
        <PipelineStageSelect order={order} onChange={onStageChange} className="flex-1" />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold tabular-nums text-ink">
          {formatRupiah(order.value || 0)}
        </span>
        <span className="shrink-0 rounded-chip bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-ink2">
          {KATEGORI_LABELS[order.category] || order.category}
        </span>
      </div>

      <p className={cn("mt-1.5 flex items-center gap-1 text-[11px]", mandek ? "font-semibold text-orange" : "text-ink3")}>
        {mandek ? <AlertTriangle size={11} className="shrink-0" /> : <Clock size={11} className="shrink-0" />}
        {order.daysInStatus === 0 ? "Masuk hari ini" : `${order.daysInStatus} hari di status ini`}
        {order.daysInStatusPerkiraan && <span title="Riwayat status belum terekam untuk order ini — dihitung dari terakhir diubah">*</span>}
      </p>

      {order.hasComplaint && (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red">
          <AlertTriangle size={11} className="shrink-0" /> Ada komplain
        </p>
      )}

      <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
        {/* BUG YANG DIPERBAIKI: nama sales sebelumnya text-ink3 (opacity 40%,
            dipakai untuk placeholder/data kosong) — nama sales itu DATA
            SUNGGUHAN, bukan "kosong", jadi kontrasnya dinaikkan ke text-ink2
            + medium weight supaya kebaca jelas, bukan pudar seperti "—". */}
        <span className={cn("min-w-0 flex-1 truncate text-[11px]", order.assignedSales ? "font-medium text-ink2" : "text-ink3")}>
          {order.assignedSales?.name || "Belum ada sales"}
        </span>
        <button
          type="button" onClick={() => onOpenTimeline(order)}
          title="Lihat riwayat status order"
          className="rounded-md p-1 text-ink3 transition-colors hover:bg-hovertint hover:text-ink2"
        >
          <Clock size={13} />
        </button>
        <button
          type="button" onClick={() => onOpenChat(order)}
          title={order.conversationId ? "Buka chat customer" : "Customer belum pernah chat"}
          disabled={!order.conversationId}
          className="rounded-md p-1 text-ink3 transition-colors hover:bg-hovertint hover:text-accent disabled:opacity-40"
        >
          <MessageSquare size={13} />
        </button>
      </div>
    </div>
  );
}

export default function Orders() {
  const navigate = useNavigate();
  // D-025: cuma untuk menonaktifkan kontrol pembayaran di UI kalau order
  // sudah DELIVERED — backend (guardOrderLocked di routes/orders.js) yang
  // benar-benar menegakkan kuncinya.
  const isAdmin = useMemo(() => isAdminUser(currentUser()), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState(() => localStorage.getItem("orders-view") || "board");
  const [cari, setCari]       = useState("");
  const [debounced, setDebounced] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fBayar, setFBayar]   = useState("");
  const [hanyaMandek, setHanyaMandek] = useState(false);
  const [timelineOrder, setTimelineOrder] = useState(null);
  // Filter tanggal order DIBUAT (Order.createdAt) — default "Hari ini",
  // konsisten dengan Dashboard & Pipeline.
  const [range, setRange] = useState(() => makeRange("today"));

  // Debounce pencarian — tiap ketikan tidak boleh jadi satu request.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(cari.trim()), 300);
    return () => clearTimeout(t);
  }, [cari]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getOrders({
        search: debounced || undefined,
        category: fKategori || undefined,
        paymentStatus: fBayar || undefined,
        ...toApiParams(range),
      });
      setData(res);
    } catch (e) {
      console.error("Gagal muat order:", e);
      setData({ items: [], perStatus: [] });
    } finally {
      setLoading(false);
    }
  }, [debounced, fKategori, fBayar, range]);

  useEffect(() => { load(); }, [load]);

  // Deep-link `?id=` (dipakai NotificationDrawer/Notifications — SALES_ORDER,
  // lihat features/notifications/notificationTypes.js). Dibongkar begitu
  // datanya ada, bukan sebelumnya: order-nya belum tentu ada di `data.items`
  // sampai fetch pertama selesai. `id` DIBUANG dari URL setelah dipakai —
  // tanpa itu, refresh manual akan membuka timeline yang sama lagi, dan me-
  // reload data yang sudah difilter dari notifikasi lama terasa aneh.
  useEffect(() => {
    const id = searchParams.get("id");
    if (!id || !data?.items) return;
    const order = data.items.find((o) => o.id === id);
    if (order) setTimelineOrder(order);
    setSearchParams((prev) => { prev.delete("id"); return prev; }, { replace: true });
  }, [searchParams, data, setSearchParams]);

  function gantiView(v) {
    setView(v);
    localStorage.setItem("orders-view", v);
  }

  const items = useMemo(() => {
    let list = data?.items || [];
    if (hanyaMandek) list = list.filter(isMandek);
    return list;
  }, [data, hanyaMandek]);

  const perStatus = useMemo(() => {
    const map = {};
    for (const s of SEMUA_STATUS) map[s] = { count: 0, value: 0 };
    for (const o of items) {
      if (!map[o.status]) map[o.status] = { count: 0, value: 0 };
      map[o.status].count++;
      map[o.status].value += o.value || 0;
    }
    return map;
  }, [items]);

  const totalMandek = items.filter(isMandek).length;
  const totalNilai  = items.reduce((s, o) => s + (o.value || 0), 0);
  const belumLunas  = items.filter((o) => o.paymentStatus !== "LUNAS" && o.status !== "CANCELLED")
                           .reduce((s, o) => s + (o.value || 0), 0);
  const adaFilter = !!(debounced || fKategori || fBayar || hanyaMandek);

  function bukaChat(order) {
    if (order.conversationId) navigate(`/inbox?conv=${order.conversationId}`);
  }

  // Ubah status LANGSUNG dari halaman Order (board & tabel) — sebelumnya
  // harus lewat drawer profil pelanggan/percakapan dulu. Refetch penuh
  // (bukan patch optimis di state lokal) supaya kolom board pindah dengan
  // benar dan daysInStatus/mandek/perStatus ikut dihitung ulang server.
  async function handleStatusChange(order, newStatus) {
    if (newStatus === order.status) return;
    try {
      await api.updateOrder(order.id, { status: newStatus });
      load();
    } catch (err) {
      alert("Gagal ubah status: " + err.message);
    }
  }

  // Ubah TAHAP PIPELINE customer langsung dari sini (bukan status order —
  // 2 hal beda, lihat PipelineStageSelect) — endpoint SAMA yang dipakai
  // Pelanggan/Pipeline (PATCH /customers/:id), pipelineStage cuma "menumpang"
  // di baris order karena didenormalisasi ke respons GET /orders.
  async function handleStageChange(order, newStage) {
    if (newStage === order.pipelineStage || !order.customerId) return;
    try {
      await api.updateCustomer(order.customerId, { pipelineStage: newStage });
      load();
    } catch (err) {
      alert("Gagal ubah tahap pipeline: " + err.message);
    }
  }

  // Ubah status PEMBAYARAN order langsung dari sini — endpoint SAMA yang
  // dipakai OrderSection.jsx (drawer profil pelanggan), PATCH /orders/:id.
  async function handlePaymentChange(order, newPayment) {
    if (newPayment === (order.paymentStatus || "BELUM_BAYAR")) return;
    try {
      await api.updateOrder(order.id, { paymentStatus: newPayment });
      load();
    } catch (err) {
      alert("Gagal ubah status pembayaran: " + err.message);
    }
  }

  async function handleExport() {
    const { exportToExcel } = await import("../utils/export.js");
    exportToExcel(
      items.map((o) => ({
        "ID Order": o.orderNumber || "",
        Pelanggan: o.customerName || "",
        "No HP": o.customerPhone || "",
        Kota: o.customerCity || "",
        Kategori: KATEGORI_LABELS[o.category] || o.category,
        Status: ORDER_STATUS_LABELS[o.status] || o.status,
        "Hari di Status": o.daysInStatus ?? "",
        Mandek: isMandek(o) ? "Ya" : "",
        Pembayaran: PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus,
        // Angka dibiarkan NUMBER supaya bisa di-SUM di Excel (lihat catatan
        // di utils/exportLaporan.js soal uang sebagai teks).
        Nilai: o.value || 0,
        Komplain: o.hasComplaint ? "Ya" : "",
        "Sales Person": o.assignedSales?.name || "",
        Dibuat: o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "",
      })),
      "order-" + new Date().toISOString().slice(0, 10)
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Order"
        subtitle={
          loading ? "Memuat…"
            : totalMandek > 0
              ? `${items.length} order · ${totalMandek} mandek ≥${MANDEK_HARI} hari di status yang sama`
              : `${items.length} order · ${formatRupiah(totalNilai)}`
        }
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                type="search" value={cari} onChange={(e) => setCari(e.target.value)}
                placeholder="Cari ID order, nama, nomor…"
                aria-label="Cari order"
                className="h-8 w-52 rounded-lg bg-surface pl-8 pr-7 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              {cari && (
                <button type="button" onClick={() => setCari("")} aria-label="Hapus pencarian"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink3 hover:text-ink">
                  <X size={13} />
                </button>
              )}
            </div>
            <select
              value={fKategori} onChange={(e) => setFKategori(e.target.value)}
              aria-label="Filter kategori"
              className="h-8 rounded-lg bg-surface px-2 text-[13px] text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <option value="">Semua Kategori</option>
              {Object.entries(KATEGORI_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select
              value={fBayar} onChange={(e) => setFBayar(e.target.value)}
              aria-label="Filter status pembayaran"
              className="h-8 rounded-lg bg-surface px-2 text-[13px] text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <option value="">Semua Pembayaran</option>
              {Object.entries(PAYMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Button
              variant={hanyaMandek ? "primary" : "ghost"} size="sm"
              onClick={() => setHanyaMandek((v) => !v)}
              title={`Hanya order yang tertahan ≥${MANDEK_HARI} hari di status yang sama`}
            >
              <AlertTriangle size={14} /> Mandek
            </Button>
            <Button variant="ghost" size="sm" onClick={() => gantiView(view === "board" ? "table" : "board")}>
              {view === "board" ? <ListIcon size={14} /> : <LayoutGrid size={14} />}
              {view === "board" ? "Tabel" : "Papan"}
            </Button>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExport} disabled={items.length === 0}>
              <Download size={14} /> Export
            </Button>
          </>
        }
      />

      <PageBody>
       <PageErrorBoundary label="Orders">
        {/* Ringkasan uang — piutang ditonjolkan karena itu angka yang paling
            sering dicari dan paling mudah hilang dari pandangan. */}
        {!loading && items.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { l: "Total order", v: items.length.toLocaleString("id-ID") },
              { l: "Nilai order", v: formatRupiah(totalNilai) },
              { l: "Belum lunas", v: formatRupiah(belumLunas) },
              { l: "Mandek", v: totalMandek.toLocaleString("id-ID"), tone: totalMandek > 0 ? "text-orange" : undefined },
            ].map((k) => (
              <div key={k.l} className="rounded-2xl bg-surface p-3.5 shadow-card">
                <p className="text-[11px] font-medium text-ink3">{k.l}</p>
                <p className={cn("mt-1 text-[17px] font-bold tabular-nums", k.tone || "text-ink")}>{k.v}</p>
              </div>
            ))}
          </div>
        )}

        {adaFilter && !loading && (
          <p className="mb-3 text-xs text-ink3">
            {items.length.toLocaleString("id-ID")} order cocok dengan filter ·{" "}
            <button type="button"
              onClick={() => { setCari(""); setFKategori(""); setFBayar(""); setHanyaMandek(false); }}
              className="font-semibold text-accent hover:underline">
              Reset filter
            </button>
          </p>
        )}

        {data?.truncated && (
          <p className="mb-3 text-[11px] text-ink3">
            Menampilkan {items.length} order terbaru (dibatasi demi kecepatan). Pakai
            pencarian atau filter untuk mempersempit.
          </p>
        )}

        {loading ? (
          <div className="flex gap-3 overflow-hidden">
            {ALUR.map((s) => (
              <div key={s} className="flex w-64 shrink-0 flex-col gap-2 rounded-2xl bg-inset/80 p-2.5">
                <Skeleton className="h-5 w-24" />
                {[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface py-16 text-center shadow-card">
            <Package className="text-ink3" size={28} />
            <p className="text-sm font-semibold text-ink2">
              {adaFilter ? "Tidak ada order yang cocok" : "Belum ada order"}
            </p>
            <p className="max-w-md text-xs text-ink3">
              {adaFilter
                ? "Coba ubah kata pencarian atau reset filter."
                : "Order dibuat dari profil pelanggan — buka Pelanggan, pilih pelanggan, lalu tambah order."}
            </p>
          </div>
        ) : view === "board" ? (
          // Papan per status kerja + scroll horizontal, tiap kolom punya scroll
          // vertikal sendiri (pelajaran dari Pipeline: satu kolom panjang tidak
          // boleh menentukan panjang halaman).
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {SEMUA_STATUS.filter((s) => s !== "CANCELLED" || perStatus[s].count > 0).map((status) => {
              const kolom = items.filter((o) => o.status === status);
              const mandekKolom = kolom.filter(isMandek).length;
              return (
                <div key={status} className="flex w-[272px] shrink-0 flex-col rounded-2xl bg-inset/80 p-2.5">
                  <div className="flex items-center gap-2 px-0.5">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_TONE[status]?.dot || "bg-ink3")} />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink2">
                      {ORDER_STATUS_LABELS[status] || status}
                    </span>
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink2">
                      {kolom.length}
                    </span>
                  </div>
                  <div className="mb-2 mt-1 flex items-baseline justify-between gap-2 px-0.5">
                    <span className="text-[13px] font-bold tabular-nums text-ink">
                      {formatRupiahShort(perStatus[status].value)}
                    </span>
                    {mandekKolom > 0 && (
                      <span className="shrink-0 text-[10px] font-semibold text-orange">
                        {mandekKolom} mandek
                      </span>
                    )}
                  </div>
                  <div className="flex max-h-[calc(100vh-420px)] min-h-24 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                    {kolom.map((o) => (
                      <OrderCard key={o.id} order={o} onOpenChat={bukaChat} onOpenTimeline={setTimelineOrder} onStatusChange={handleStatusChange} onStageChange={handleStageChange} onPaymentChange={handlePaymentChange} paymentLocked={o.paymentStatus === "LUNAS" && !isAdmin} />
                    ))}
                    {kolom.length === 0 && (
                      <div className="flex min-h-16 items-center justify-center rounded-xl border-dashed border-line px-2 py-3 text-center text-[11px] text-ink3">
                        Kosong
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["ID Order", "Pelanggan", "Kategori", "Status", "Pipeline", "Lama", "Pembayaran", "Nilai", "Sales", "Dibuat", ""].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const mandek = isMandek(o);
                  return (
                    <tr key={o.id} className="border-b border-line last:border-0 hover:bg-hovertint">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-ink2">
                        {o.orderNumber || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={o.customerName || o.customerPhone || "?"} src={o.profilePictureUrl} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-ink">
                              {o.customerName || "Tanpa nama"}
                            </p>
                            <p className="truncate text-[11px] tabular-nums text-ink3">{o.customerPhone || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink2">
                        {KATEGORI_LABELS[o.category] || o.category}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <StatusSelect order={o} onChange={handleStatusChange} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <PipelineStageSelect order={o} onChange={handleStageChange} />
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-2.5 tabular-nums", mandek ? "font-semibold text-orange" : "text-ink2")}>
                        {o.daysInStatus}h{o.daysInStatusPerkiraan ? "*" : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <PaymentStatusSelect order={o} onChange={handlePaymentChange} locked={o.paymentStatus === "LUNAS" && !isAdmin} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-ink">
                        {formatRupiah(o.value || 0)}
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-2.5", o.assignedSales ? "font-medium text-ink2" : "text-ink3")}>
                        {o.assignedSales?.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-ink3">
                        {o.createdAt ? formatTanggalPendek(o.createdAt) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setTimelineOrder(o)} title="Riwayat status"
                            className="rounded-md p-1 text-ink3 hover:bg-hovertint hover:text-ink2">
                            <Clock size={14} />
                          </button>
                          <button type="button" onClick={() => bukaChat(o)} disabled={!o.conversationId}
                            title={o.conversationId ? "Buka chat" : "Belum pernah chat"}
                            className="rounded-md p-1 text-ink3 hover:bg-hovertint hover:text-accent disabled:opacity-40">
                            <MessageSquare size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && items.some((o) => o.daysInStatusPerkiraan) && (
          <p className="mt-3 text-[11px] leading-relaxed text-ink3">
            <strong>*</strong> Riwayat status baru mulai direkam sistem, jadi untuk
            order lama “lama di status” dihitung dari kapan order terakhir diubah —
            bisa lebih pendek dari kenyataan. Order yang statusnya berubah setelah
            ini akan punya riwayat yang tepat.
          </p>
        )}
       </PageErrorBoundary>
      </PageBody>

      <OrderTimelineDrawer
        order={timelineOrder}
        onClose={() => setTimelineOrder(null)}
        onOpenChat={bukaChat}
        onPaymentRecorded={load}
      />
    </PageContainer>
  );
}
