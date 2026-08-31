import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, X, RefreshCw, Download, LayoutGrid, List as ListIcon,
  AlertTriangle, Clock, MessageSquare, Package, Tag, Wallet, UserRound, Percent, GitBranch, Loader2, Truck,
} from "lucide-react";
import { api } from "../api.js";
import { Card } from "@/components/ui/card.jsx";
import {
  formatRupiah, formatRupiahShort,
  ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES,
  PIPELINE_STAGES, STAGE_LABELS, stageVariant,
  HEALTH_LABELS, HEALTH_COMPLAINT_LABELS, parseOrderNotes,
  PRODUCT_LINE_LABELS, PRODUCT_TYPE_LABELS, PRICE_ITEM_KIND_LABELS,
} from "../utils/format.js";
import { formatTanggalPendek } from "../utils/formatDate.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { badgeVariants } from "@/components/ui/badge.jsx";
import { TH } from "@/components/ui/table.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { BadgeDropdown } from "@/components/ui/badge-dropdown.jsx";
import Avatar from "../components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { isAdminUser, rolesOf } from "@/lib/roles.js";
import OrderTimelineDrawer from "../features/orders/OrderTimelineDrawer.jsx";
import { JOB_STATUS_REAL } from "../features/armada/jobStatus.js";

// D-025 (revisi 19 Agustus 2026): order yang sudah LUNAS dikunci dari role
// lain (backend menegakkan ini di routes/orders.js, guardOrderLocked()).
// Pemicunya SEMPAT status DELIVERED, diubah setelah tes pilot: order yang
// sudah terkirim tapi BELUM lunas (COD belum ditagih, dst) ternyata tetap
// butuh diedit sales. Revisi 26 Agustus 2026: SALES ikut diizinkan
// mengedit, tidak lagi admin-only — cermin persis guardOrderLocked().
// Helper ini cuma untuk UI: nonaktifkan kontrol yang akan ditolak, supaya
// user tidak klik lalu kaget oleh error, bukan sumber kebenaran otorisasi.
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

// D-030 (20 Agustus 2026) — filter Kategori/Pembayaran/Sales/Promo dulu
// semuanya <select> abu-abu identik, tidak bisa dipindai sekilas mana
// yang lagi aktif. Ikon berwarna khas per filter + tint background begitu
// filter itu DIPILIH (bukan "Semua...") — biar "on point" tapi tidak
// bertabrakan makna dengan warna status/pembayaran per baris di tabel.
const FILTER_TONE = {
  status:     { icon: Package,    hex: "#0891b2" },
  kategori:   { icon: Tag,        hex: "#7c3aed" },
  pembayaran: { icon: Wallet,     hex: "#16a34a" },
  sales:      { icon: UserRound,  hex: "#2563eb" },
  promo:      { icon: Percent,    hex: "#db2777" },
  pipeline:   { icon: GitBranch,  hex: "#ea580c" },
};
// ── Pengaturan Grup WA Order (D-032) — ADMIN only, sekali setup ──────────
// Sengaja MINIMAL (satu dropdown + tombol simpan), pola SAMA PERSIS dengan
// DriverGroupSettings di Armada.jsx — konfigurasi sekali di awal, bukan aksi
// rutin harian.
function SalesGroupSettings() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState(null);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || groups) return;
    Promise.all([api.getGroupConversations(), api.getSalesGroup()]).then(([gs, cur]) => {
      setGroups(gs);
      setCurrent(cur.group);
      setSelected(cur.group?.id || "");
    });
  }, [open, groups]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.setSalesGroup(selected);
      setCurrent(r.group);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-3 text-xs text-ink2 hover:text-accent hover:underline">
        Grup WhatsApp Order: {current?.groupName || "belum diatur"} — atur
      </button>
    );
  }

  return (
    <Card className="mb-4 p-3">
      <p className="mb-2 text-xs font-semibold text-ink">Grup WhatsApp Order</p>
      <p className="mb-2 text-[11px] text-ink2">
        Tombol "Kirim ke Grup WA" di rincian pesanan mengirim ringkasan order ke grup ini.
      </p>
      {!groups ? (
        <Loader2 className="h-4 w-4 animate-spin text-ink2" />
      ) : (
        <div className="flex gap-2">
          <select
            value={selected} onChange={(e) => setSelected(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-border px-2 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="">Pilih grup…</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.groupName || g.id}</option>)}
          </select>
          <Button className="h-9 text-xs" disabled={busy || !selected} onClick={save}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Simpan"}
          </Button>
          <button onClick={() => setOpen(false)} className="text-ink2 hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
      )}
    </Card>
  );
}

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
  return (
    <BadgeDropdown
      value={order.status}
      onChange={(v) => onChange(order, v)}
      options={SEMUA_STATUS.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] || s }))}
      getChipClass={(v) => (STATUS_TONE[v] || { chip: "bg-inset text-ink2" }).chip}
      locked={!!order.statusLocked}
      lockedTitle="Status di-override manual — ikut hitungan otomatis lagi lewat drawer profil pelanggan"
      title="Status dihitung otomatis dari unit"
      ariaLabel={`Ubah status order ${order.orderNumber || ""}`}
      triggerClassName={className}
    />
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
    <BadgeDropdown
      value={order.pipelineStage || "NEW"}
      onChange={(v) => onChange(order, v)}
      options={PIPELINE_STAGES}
      getChipClass={(v) => badgeVariants({ variant: stageVariant(v) })}
      ariaLabel={`Ubah tahap pipeline untuk ${order.customerName || "pelanggan"}`}
      triggerClassName={className}
    />
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
    <BadgeDropdown
      value={order.paymentStatus || "BELUM_BAYAR"}
      onChange={(v) => onChange(order, v)}
      options={PAYMENT_STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS_LABELS[s] || s }))}
      getChipClass={(v) => PAYMENT_TONE[v]}
      disabled={locked}
      title={locked ? "Order sudah LUNAS — cuma admin/sales yang bisa ubah pembayaran" : undefined}
      ariaLabel={`Ubah status pembayaran untuk ${order.customerName || "pelanggan"}`}
      triggerClassName={className}
    />
  );
}

function OrderCard({ order, onOpenChat, onOpenTimeline, onStatusChange, onStageChange, onPaymentChange, paymentLocked }) {
  const mandek = isMandek(order);
  const nama = order.customerName || order.customerPhone || "Tanpa nama";
  // D-030 (revisi 20 Agustus 2026): SELURUH kartu bisa diklik untuk buka
  // rincian pesanan (dulu cuma ikon jam kecil di pojok, gampang kelewat —
  // pola sekarang mengikuti kebiasaan tracking paket marketplace: klik
  // order apa pun langsung masuk detail). Kontrol interaktif di dalam kartu
  // (select status/pipeline/pembayaran, tombol chat) sudah/perlu
  // stopPropagation supaya tidak ikut memicu buka drawer saat dipakai.
  return (
    <div
      onClick={() => onOpenTimeline(order)}
      className="cursor-pointer rounded-xl bg-surface p-2.5 shadow-card transition-shadow duration-150 hover:shadow-popover"
    >
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

      {/* BUG YANG DIPERBAIKI (26 Agustus 2026): dua select ini dulu SEJAJAR
          (flex-1 + flex-1), memaksa lebar SAMA RATA berapa pun panjang
          labelnya — di kartu selebar 272px itu cuma ~123px per select. Label
          pipeline sudah lebih panjang dari label status ("Scheduled /
          Transaksi", "Already Reviewed") dan native <select> TIDAK
          menampilkan ellipsis atau tooltip saat teksnya kepotong, jadi
          teksnya benar-benar hilang tanpa jejak. Ditumpuk VERTIKAL supaya
          tiap select dapat lebar PENUH kartu (~246px) — aman untuk label
          sepanjang apa pun yang realistis, tidak perlu hitung ulang kalau
          ada label baru lagi nanti. */}
      <div className="mt-2 flex flex-col gap-1.5">
        <StatusSelect order={order} onChange={onStatusChange} className="w-full" />
        <PipelineStageSelect order={order} onChange={onStageChange} className="w-full" />
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

      {/* Status Delivery — D-036 (30 Agustus 2026). Sales lihat progres
          pengambilan/pengiriman TANPA pindah ke Delivery & Fulfillment —
          job PICKUP dan DELIVERY beda tahap, jadi ditampilkan terpisah
          kalau dua-duanya ada (order LAYANAN yang sudah selesai diambil
          DAN sudah masuk antrean kirim, misalnya). */}
      {(order.pickupJob || order.deliveryJob) && (
        <div className="mt-1 flex flex-col gap-0.5">
          {[order.pickupJob && { ...order.pickupJob, label: "Ambil" }, order.deliveryJob && { ...order.deliveryJob, label: "Kirim" }]
            .filter(Boolean)
            .map((j, i) => (
              <p key={i} className="flex items-center gap-1 truncate text-[11px] text-ink3">
                <Truck size={11} className="shrink-0" />
                {j.label}: {JOB_STATUS_REAL[j.status]?.label || j.status}
                {j.scheduledDate ? ` · ${formatTanggalPendek(j.scheduledDate)}` : ""}
                {j.driverName ? ` · ${j.driverName}` : ""}
              </p>
            ))}
        </div>
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
          type="button" onClick={(e) => { e.stopPropagation(); onOpenTimeline(order); }}
          title="Lihat rincian pesanan"
          className="rounded-md p-1 text-ink3 transition-colors hover:bg-hovertint hover:text-ink2"
        >
          <Clock size={13} />
        </button>
        <button
          type="button" onClick={(e) => { e.stopPropagation(); onOpenChat(order); }}
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
  // sudah LUNAS — backend (guardOrderLocked di routes/orders.js) yang
  // benar-benar menegakkan kuncinya. `isAdmin` dipakai TERPISAH di bawah
  // untuk gerbang admin-only lain (SalesGroupSettings) yang TIDAK ikut
  // longgar ke SALES — jangan disatukan dengan canEditLunas.
  const isAdmin = useMemo(() => isAdminUser(currentUser()), []);
  // REVISI 26 Agustus 2026 (permintaan owner): SALES ikut diizinkan
  // mengedit order LUNAS, bukan cuma admin — cermin persis perubahan
  // guardOrderLocked() di backend.
  const canEditLunas = useMemo(() => {
    const roles = rolesOf(currentUser());
    return isAdmin || roles.includes("SALES");
  }, [isAdmin]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState(() => localStorage.getItem("orders-view") || "board");
  const [cari, setCari]       = useState("");
  const [debounced, setDebounced] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fBayar, setFBayar]   = useState("");
  const [fSales, setFSales]   = useState("");
  const [fPromo, setFPromo]   = useState("");
  const [fPipeline, setFPipeline] = useState("");
  const [promos, setPromos]   = useState([]);
  const [hanyaMandek, setHanyaMandek] = useState(false);
  const [timelineOrder, setTimelineOrder] = useState(null);
  // Filter tanggal order DIBUAT (Order.createdAt) — default "Hari ini",
  // konsisten dengan Dashboard & Pipeline.
  const [range, setRange] = useState(() => makeRange("today"));
  // Sort tabel — HANYA berlaku di view="table" (papan Kanban dikelompokkan
  // per status, "urutkan" tidak berarti apa-apa di situ). Klik pertama =
  // asc, klik lagi di kolom yang sama = flip, sama seperti Customers.jsx.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [users, setUsers]     = useState([]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  useEffect(() => { api.getUsers().then(setUsers).catch(() => {}); }, []);
  // Dropdown filter promo — SEMUA promo (bukan cuma yang aktif), supaya
  // order lama yang pakai kampanye yang sudah berakhir tetap bisa difilter.
  useEffect(() => { api.getPromos().then(setPromos).catch(() => {}); }, []);

  // Sales atau admin yang PERNAH pegang lead (D-010: role tambahan lewat
  // Pengguna & Peran ikut dihitung, bukan cuma field `role` legacy) — pola
  // SAMA dengan Customers.jsx & Pipeline.jsx supaya daftar sales di seluruh
  // CRM selalu konsisten.
  const salesUsers = useMemo(() => users.filter((u) => rolesOf(u).includes("SALES")), [users]);

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
        status: fStatus || undefined,
        category: fKategori || undefined,
        paymentStatus: fBayar || undefined,
        salesId: fSales || undefined,
        promoId: fPromo || undefined,
        pipelineStage: fPipeline || undefined,
        ...toApiParams(range),
      });
      setData(res);
    } catch (e) {
      console.error("Gagal muat order:", e);
      setData({ items: [], perStatus: [] });
    } finally {
      setLoading(false);
    }
  }, [debounced, fStatus, fKategori, fBayar, fSales, fPromo, fPipeline, range]);

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

  // Nilai per kolom untuk sort — SEMUA client-side (order sudah di-load
  // penuh ke `data.items`, sama seperti filter `hanyaMandek` yang sudah ada
  // di sini). String dibandingkan case-insensitive, tanggal lewat epoch.
  const SORT_GETTERS = {
    orderNumber:  (o) => o.orderNumber || "",
    customerName: (o) => o.customerName || o.customerPhone || "",
    category:     (o) => KATEGORI_LABELS[o.category] || o.category || "",
    status:       (o) => ORDER_STATUS_LABELS[o.status] || o.status || "",
    pipelineStage:(o) => STAGE_LABELS[o.pipelineStage] || o.pipelineStage || "",
    daysInStatus: (o) => o.daysInStatus || 0,
    paymentStatus:(o) => PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus || "",
    value:        (o) => o.value || 0,
    assignedSales:(o) => o.assignedSales?.name || "",
    promo:        (o) => o.promo?.name || "",
    createdAt:    (o) => o.createdAt ? new Date(o.createdAt).getTime() : 0,
  };

  const items = useMemo(() => {
    let list = data?.items || [];
    if (hanyaMandek) list = list.filter(isMandek);
    if (sortKey && SORT_GETTERS[sortKey]) {
      const get = SORT_GETTERS[sortKey];
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const va = get(a), vb = get(b);
        if (typeof va === "string") return va.localeCompare(vb, "id") * dir;
        return (va - vb) * dir;
      });
    }
    return list;
  }, [data, hanyaMandek, sortKey, sortDir]);

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
  // BUG YANG DIPERBAIKI (26 Agustus 2026, dilaporkan owner: "165 di Order
  // vs 160 di Dashboard, padahal dua-duanya 'bulan ini'"): kartu ringkasan
  // di sini menghitung dari SEMUA `items`, termasuk yang sudah CANCELLED —
  // sementara Dashboard ("Total Orders") dan hampir semua tabel lain di
  // app ini (Sales Report, Ringkasan) SUDAH LAMA konsisten mengecualikan
  // CANCELLED. Bahkan "Belum lunas" DI BARIS INI SENDIRI sudah benar
  // (filter `status !== "CANCELLED"` inline), jadi sebelumnya TIDAK
  // konsisten sesama kartu di baris yang sama. `itemsAktif` sekarang jadi
  // SATU basis bersama untuk semua kartu ringkasan — daftar/papan order
  // itu sendiri (`items`) TIDAK berubah, order CANCELLED tetap kelihatan
  // & bisa dibuka di tab statusnya, cuma tidak ikut membesarkan angka
  // ringkasan yang mengaku "total".
  const itemsAktif = useMemo(() => items.filter((o) => o.status !== "CANCELLED"), [items]);
  // BUG YANG DIPERBAIKI (30 Agustus 2026, ditemukan lewat pertanyaan owner
  // "kenapa beda dengan Laporan Sales/Ringkasan?"): `itemsAktif` berasal
  // dari `items`, yang DIPOTONG `limit` backend (default 200) — begitu
  // order aktif bulan itu lebih dari 200, "Total order"/"Nilai
  // order"/"Belum lunas" DIAM-DIAM undercount (di production Agustus 2026:
  // 195 order/Rp467jt di sini vs 213 order/Rp511,7jt yang BENAR di Laporan,
  // selisih 18 order tertua bulan itu yang kepotong). `data.summary` dari
  // backend adalah agregat SQL langsung (SUM/COUNT), TIDAK kena `limit`
  // sama sekali — dipakai di sini, `itemsAktif` cuma fallback kalau API
  // lama (belum ada field ini) atau belum sempat dimuat.
  const totalOrderAktif = data?.summary?.totalOrderAktif ?? itemsAktif.length;
  const totalNilai  = data?.summary?.nilaiOrderAktif ?? itemsAktif.reduce((s, o) => s + (o.value || 0), 0);
  const belumLunas  = data?.summary?.belumLunas ?? itemsAktif.filter((o) => o.paymentStatus !== "LUNAS")
                           .reduce((s, o) => s + (o.value || 0), 0);
  // Total Pelanggan & Repeat Order (26 Agustus 2026, permintaan owner) —
  // dihitung dari `itemsAktif` (order aktif yang SUDAH difilter — rentang
  // tanggal/kategori/pembayaran/dst di atas), BUKAN dari seluruh histori
  // customer. Sengaja beda dari "Repeat Order" di Ringkasan (yang pakai
  // Customer.orderCount ALL-TIME) — di halaman Order, pertanyaannya "dari
  // order-order yang sedang saya lihat SEKARANG (mis. bulan ini), berapa
  // pelanggan unik & berapa yang order LEBIH dari sekali DI RENTANG INI",
  // bukan status repeat sepanjang hidup pelanggan itu.
  //
  // ⚠️ JUGA beda dari kartu "Conversion" di Dashboard — itu cuma menghitung
  // COHORT lead yang BARU MASUK di periode yang sama (dan sudah closing),
  // sementara "Total Pelanggan" di sini menghitung SEMUA pelanggan (baru
  // ATAU lama) yang bikin order di periode ini. Pelanggan LAMA yang order
  // lagi bulan ini ikut kehitung di sini tapi TIDAK ikut cohort Dashboard
  // — itu sebabnya angkanya bisa beda cukup jauh (dikonfirmasi ke DB
  // production 26 Agustus: dari 120 pelanggan di sini, 97 di antaranya
  // memang cohort baru bulan ini — cocok dengan angka Dashboard — sisanya
  // 23 adalah pelanggan LAMA yang order lagi, bukan salah hitung).
  const orderPerPelanggan = useMemo(() => {
    const counts = new Map();
    for (const o of itemsAktif) {
      if (!o.customerId) continue;
      counts.set(o.customerId, (counts.get(o.customerId) || 0) + 1);
    }
    return counts;
  }, [itemsAktif]);
  const totalPelanggan = orderPerPelanggan.size;
  const repeatPelanggan = [...orderPerPelanggan.values()].filter((n) => n >= 2).length;
  const aov = totalOrderAktif > 0 ? Math.round(totalNilai / totalOrderAktif) : 0;
  // Rata-rata Proses (rekomendasi, permintaan owner) — dari order DIBUAT
  // sampai berstatus DELIVERED, dihitung dari order yang SUDAH delivered
  // di rentang/filter yang sedang aktif. `statusSince` (dari GET /orders)
  // adalah kapan order MASUK ke status SEKARANG — untuk order berstatus
  // DELIVERED, itu berarti "kapan dia jadi delivered", jadi selisihnya ke
  // `createdAt` adalah lama proses ujung-ke-ujung. TIDAK dihitung dari
  // order yang masih berjalan (belum delivered) — waktu prosesnya belum
  // final, bukan pelengkap "Mandek" (yang justru soal order yang BELUM
  // selesai tapi sudah lama tidak bergerak).
  const orderDelivered = itemsAktif.filter((o) => o.status === "DELIVERED");
  const avgProsesHari = orderDelivered.length > 0
    ? orderDelivered.reduce((s, o) => s + Math.max(0, (new Date(o.statusSince) - new Date(o.createdAt)) / 86_400_000), 0) / orderDelivered.length
    : null;
  // Komplain Rate (rekomendasi, permintaan owner) — persentase order aktif
  // (di rentang/filter ini) yang ditandai "Pernah Komplain" (hasComplaint,
  // toggle manual sales/admin — lihat OrderSection.jsx). Bukan pengganti
  // badge "Pernah Komplain" di profil pelanggan, ini agregatnya per
  // periode: "dari order BULAN INI, berapa persen yang komplain" — beda
  // dari badge itu yang menandai riwayat SEPANJANG WAKTU pelanggannya.
  const complaintCount = itemsAktif.filter((o) => o.hasComplaint).length;
  const complaintRate = itemsAktif.length > 0 ? Math.round((complaintCount / itemsAktif.length) * 1000) / 10 : null;
  const adaFilter = !!(debounced || fStatus || fKategori || fBayar || fSales || fPromo || fPipeline || hanyaMandek);

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
    const { exportToExcelMultiSheet } = await import("../utils/export.js");

    const sheetOrder = items.map((o) => {
      // Merk/ukuran/keluhan kasur disimpan JSON di o.notes, bukan kolom
      // sendiri — sama parser yang dipakai OrderSection.jsx (drawer
      // profil pelanggan), supaya export TIDAK PERNAH beda baca dari UI.
      const info = parseOrderNotes(o.notes);
      const berat = (o.weightEntries || []).map((w) => `${w.label}: ${w.beratKg}kg`).join(", ");
      const orderItems = o.items || [];
      // Ringkasan layanan per ORDER (29 Agustus 2026) — sebelumnya TIDAK
      // ADA sama sekali kolom yang menunjukkan layanan apa yang dibeli di
      // sheet ini (cuma "Nilai" total, tanpa rinciannya). Rincian penuh
      // per-item ada di sheet "Rincian Layanan" di bawah — kolom di sini
      // cuma RINGKASAN supaya sheet Order tetap 1-baris-1-order.
      const belowStandardCount = orderItems.filter(
        (it) => it.standardPrice != null && it.harga < it.standardPrice
      ).length;
      return {
        // ── Identitas ────────────────────────────────────────────────────
        "ID Order": o.orderNumber || "",
        Pelanggan: o.customerName || "",
        "No HP": o.customerPhone || "",
        Kota: o.customerCity || "",
        "Sales Person": o.assignedSales?.name || "",

        // ── Klasifikasi produk (29 Agustus 2026 — digeser ke depan &
        // dikelompokkan, permintaan owner: dulu tersebar/tidak berurutan).
        // Kategori (Layanan/Baru/Sewa) TETAP dipertahankan di sini meski
        // ada Kategori Layanan/Produk yg lebih detail di sheet "Rincian
        // Layanan" — Kategori di sini yg menentukan awalan nomor order
        // (RES-/SWS-/NEW-, lihat orderNumberGenerator.js), bukan sekadar
        // label, dan berguna dibaca cepat tanpa buka sheet lain. ──
        Kategori: KATEGORI_LABELS[o.category] || o.category,
        "Lini Produk": PRODUCT_LINE_LABELS[o.productLine] || o.productLine || "",
        "Jenis Produk": PRODUCT_TYPE_LABELS[o.productType] || "",
        // Header dilepas dari "Kasur" (dulu satu-satunya produk) — isinya
        // sekarang bisa merk/ukuran Sofa/Divan juga, lihat OrderSection.jsx.
        "Merk/Model":            info.merkKasur || "",
        "Ukuran/Konfigurasi":    info.ukuranKasur || "",
        // Ringkasan katalog harga — lihat sheet "Rincian Layanan" utk
        // detail per layanan. Kosong ("") kalau order ini TIDAK PUNYA item
        // sama sekali (order lama / isian bebas semua).
        Layanan: orderItems.map((it) => it.layananName).filter(Boolean).join(", "),

        // ── Status & fulfillment ─────────────────────────────────────────
        Status: ORDER_STATUS_LABELS[o.status] || o.status,
        "Hari di Status": o.daysInStatus ?? "",
        // Perkiraan? (29 Agustus 2026) — sebelumnya TIDAK di-export sama
        // sekali. "Ya" = order ini belum punya riwayat perpindahan status
        // tercatat, jadi "Hari di Status" dihitung dari tanggal EDIT
        // TERAKHIR (bisa lebih pendek dari kenyataan), BUKAN dari kapan dia
        // benar-benar pindah ke status ini. Lihat daysInStatusPerkiraan di
        // routes/orders.js.
        "Perkiraan?": o.daysInStatusPerkiraan ? "Ya" : "Tidak",
        Mandek: isMandek(o) ? "Ya" : "",
        Pembayaran: PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus,

        // ── Nilai & harga ────────────────────────────────────────────────
        // Angka dibiarkan NUMBER supaya bisa di-SUM di Excel (lihat catatan
        // di utils/exportLaporan.js soal uang sebagai teks).
        Nilai: o.value || 0,
        "Ada Nego Di Bawah Standard": orderItems.some((it) => it.standardPrice != null)
          ? (belowStandardCount > 0 ? `Ya (${belowStandardCount})` : "Tidak")
          : "",
        Promo: o.promo ? `${o.promo.code} — ${o.promo.name}` : "",
        Ongkir: o.ongkir || 0,
        "Ongkir Klaim Garansi": o.ongkirKlaimGaransi || 0,
        Komplain: o.hasComplaint ? "Ya" : "",

        // ── Kesehatan pelanggan (D-028, PER ORDER — beda dari
        // Customer.healthStatus/complaintCategory di profil pelanggan) ────
        "Kondisi Kesehatan": o.healthStatus ? (HEALTH_LABELS[o.healthStatus] || o.healthStatus) : "",
        "Kategori Keluhan": (o.complaintCategory || []).map((c) => HEALTH_COMPLAINT_LABELS[c] || c).join(", "),
        "Berat Badan": berat,
        "Keluhan/Catatan": info.keluhanCustomer || "",

        // ── Pengiriman (D-027, D-029 — kota/alamat PENGIRIMAN, TERPISAH
        // dari "Kota" domisili pelanggan di atas) ─────────────────────────
        "Kota Pengiriman":   o.deliveryCity || "",
        "Alamat Pengiriman": o.deliveryAddress || "",
        "Estimasi Pick Up": o.pickupEstimate || "",
        "Tanggal Pick Up Pasti": o.pickupConfirmedDate ? o.pickupConfirmedDate.slice(0, 10) : "",
        "Estimasi Kirim": o.deliveryEstimate || "",
        "Tanggal Kirim Pasti": o.deliveryConfirmedDate ? o.deliveryConfirmedDate.slice(0, 10) : "",
        "Link Lokasi": o.locationUrl || "",
        Dibuat: o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "",
      };
    });

    // Sheet KEDUA (29 Agustus 2026) — 1 BARIS PER ITEM LAYANAN, bukan per
    // order. Inilah yang sebelumnya TIDAK ADA sama sekali di export manapun:
    // harga normal/standard/final tersimpan di level OrderItem (satu order
    // bisa punya beberapa layanan dgn harga berbeda-beda), jadi tidak bisa
    // direpresentasikan jujur di sheet 1-baris-1-order. Ini sheet yang
    // dipakai utk pertanyaan "disiplin nego" (per sales, per layanan) —
    // alasan utama katalog harga ini dibangun.
    const sheetLayanan = items.flatMap((o) =>
      (o.items || []).map((it) => {
        const dariKatalog = it.priceItemId != null;
        const dibawahStandard = it.standardPrice != null && it.harga < it.standardPrice;
        return {
          "ID Order": o.orderNumber || "",
          Pelanggan: o.customerName || "",
          "Sales Person": o.assignedSales?.name || "",
          // Kategori Produk = Lini Produk order (Kasur/Sofa/Divan) — level
          // order, sama utk semua item di dalamnya.
          "Kategori Produk": PRODUCT_LINE_LABELS[o.productLine] || o.productLine || "",
          // Kategori Layanan = PriceItem.kind SNAPSHOT (Layanan/Tambahan/
          // Produk/Sewa/Biaya) — level ITEM, bisa beda-beda dalam 1 order
          // yang sama (mis. 1 item Layanan + 1 item Tambahan). Kosong kalau
          // item ini diketik bebas (kind cuma ada utk item dari katalog).
          "Kategori Layanan": PRICE_ITEM_KIND_LABELS[it.kind] || "",
          Layanan: it.layananName,
          "Dari Katalog": dariKatalog ? "Ya" : "Tidak (isian bebas)",
          // NULL (bukan 0) kalau layanan ini diketik bebas / katalog belum
          // punya harga utk varian itu — beda arti dari "harganya Rp0".
          "Harga Normal":   it.normalPrice ?? "",
          "Harga Standard": it.standardPrice ?? "",
          "Harga Final": it.harga || 0,
          "Selisih ke Standard": it.standardPrice != null ? it.harga - it.standardPrice : "",
          "Status Nego": it.standardPrice == null ? "" : (dibawahStandard ? "Di bawah standard" : "Dalam batas"),
          "Tanggal Order": o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "",
        };
      })
    );

    exportToExcelMultiSheet(
      [
        { name: "Order", data: sheetOrder },
        { name: "Rincian Layanan", data: sheetLayanan },
      ],
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
              ? `${itemsAktif.length} order · ${totalMandek} mandek ≥${MANDEK_HARI} hari di status yang sama`
              : `${itemsAktif.length} order · ${formatRupiah(totalNilai)}`
        }
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
              <input
                type="search" value={cari} onChange={(e) => setCari(e.target.value)}
                placeholder="Cari ID, nama, HP…"
                aria-label="Cari order"
                className="h-8 w-64 rounded-lg bg-surface pl-8 pr-7 text-[13px] text-ink placeholder:text-ink3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              {cari && (
                <button type="button" onClick={() => setCari("")} aria-label="Hapus pencarian"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink3 hover:text-ink">
                  <X size={13} />
                </button>
              )}
            </div>
            <FilterDropdown
              icon={FILTER_TONE.status.icon} activeColor={FILTER_TONE.status.hex}
              value={fStatus} onChange={setFStatus}
              options={SEMUA_STATUS.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] || s }))}
              placeholder="Semua Status"
              ariaLabel="Filter status order"
            />
            <FilterDropdown
              icon={FILTER_TONE.kategori.icon} activeColor={FILTER_TONE.kategori.hex}
              value={fKategori} onChange={setFKategori}
              options={Object.entries(KATEGORI_LABELS).map(([value, label]) => ({ value, label }))}
              placeholder="Semua Kategori"
              ariaLabel="Filter kategori"
            />
            <FilterDropdown
              icon={FILTER_TONE.pembayaran.icon} activeColor={FILTER_TONE.pembayaran.hex}
              value={fBayar} onChange={setFBayar}
              options={Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              placeholder="Semua Pembayaran"
              ariaLabel="Filter status pembayaran"
            />
            <FilterDropdown
              icon={FILTER_TONE.sales.icon} activeColor={FILTER_TONE.sales.hex}
              value={fSales} onChange={setFSales}
              options={salesUsers.map((u) => ({ value: u.id, label: u.name }))}
              placeholder="Semua Sales"
              ariaLabel="Filter sales person"
            />
            <FilterDropdown
              icon={FILTER_TONE.pipeline.icon} activeColor={FILTER_TONE.pipeline.hex}
              value={fPipeline} onChange={setFPipeline}
              options={PIPELINE_STAGES.map(({ value, label }) => ({ value, label }))}
              placeholder="Semua Pipeline"
              ariaLabel="Filter tahap pipeline"
            />
            {promos.length > 0 && (
              <FilterDropdown
                icon={FILTER_TONE.promo.icon} activeColor={FILTER_TONE.promo.hex}
                value={fPromo} onChange={setFPromo}
                options={promos.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
                placeholder="Semua Promo"
                ariaLabel="Filter promo"
              />
            )}
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
        {isAdmin && <SalesGroupSettings />}
        {/* Ringkasan uang — piutang ditonjolkan karena itu angka yang paling
            sering dicari dan paling mudah hilang dari pandangan. */}
        {!loading && items.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { l: "Total order", v: totalOrderAktif.toLocaleString("id-ID"),
                tip: "Order aktif yang cocok dengan filter — CANCELLED tidak dihitung, konsisten dengan Dashboard & Laporan. Dihitung dari agregat penuh (tidak kepotong batas 200 baris tabel di bawah)." },
              { l: "Total pelanggan", v: totalPelanggan.toLocaleString("id-ID"),
                tip: "Pelanggan UNIK (baru ATAU lama) yang bikin order di periode/filter ini. Beda dari kartu \"Conversion\" di Dashboard — itu cuma menghitung lead BARU yang masuk di periode yang sama, tidak termasuk pelanggan lama yang order lagi." },
              { l: "Repeat order", v: repeatPelanggan.toLocaleString("id-ID"), tone: repeatPelanggan > 0 ? "text-green" : undefined,
                tip: "Dari Total Pelanggan di atas, berapa yang bikin order LEBIH dari sekali DI PERIODE/FILTER INI (bukan status repeat sepanjang riwayat pelanggan itu)." },
              { l: "Nilai order", v: formatRupiah(totalNilai),
                tip: "Total nilai order aktif (CANCELLED tidak dihitung) — belum tentu sudah dibayar lunas." },
              { l: "AOV", v: totalOrderAktif > 0 ? formatRupiah(aov) : "—",
                tip: "Average Order Value = Nilai order ÷ Total order aktif — rata-rata besar 1 order di periode/filter ini." },
              { l: "Belum lunas", v: formatRupiah(belumLunas),
                tip: "Nilai order aktif yang status pembayarannya BELUM Lunas (DP atau Belum Bayar)." },
              { l: "Rata-rata proses", v: avgProsesHari != null ? `${avgProsesHari.toFixed(1)} hari` : "—",
                tip: "Rata-rata lama dari order DIBUAT sampai berstatus DELIVERED, dihitung dari order yang SUDAH delivered di periode/filter ini. Order yang masih berjalan tidak dihitung — waktu prosesnya belum final." },
              { l: "Komplain", v: complaintRate != null ? `${complaintRate}%` : "—", tone: complaintRate > 5 ? "text-red" : undefined,
                tip: "Persentase order aktif di periode ini yang ditandai \"Pernah Komplain\" — bukan penalti, diagnostik kualitas layanan periode ini." },
              { l: "Mandek", v: totalMandek.toLocaleString("id-ID"), tone: totalMandek > 0 ? "text-orange" : undefined,
                tip: `Order yang tertahan di status yang sama ≥${MANDEK_HARI} hari (DELIVERED/CANCELLED dikecualikan — itu status akhir, wajar lama).` },
            ].map((k) => (
              <div key={k.l} className="rounded-2xl bg-surface p-3.5 shadow-card">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink3">
                  {k.l}
                  <InfoTooltip text={k.tip} />
                </p>
                <p className={cn("mt-1 text-[17px] font-bold tabular-nums", k.tone || "text-ink")}>{k.v}</p>
              </div>
            ))}
          </div>
        )}

        {adaFilter && !loading && (
          <p className="mb-3 text-xs text-ink3">
            {items.length.toLocaleString("id-ID")} order cocok dengan filter ·{" "}
            <button type="button"
              onClick={() => { setCari(""); setFStatus(""); setFKategori(""); setFBayar(""); setFSales(""); setFPromo(""); setFPipeline(""); setHanyaMandek(false); }}
              className="font-semibold text-accent hover:underline">
              Reset filter
            </button>
          </p>
        )}

        {data?.truncated && (
          <div className="mb-3 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[11.5px] leading-relaxed text-ink">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-orange" />
            <p>
              Tabel di bawah cuma menampilkan {items.length} order terbaru (dibatasi demi kecepatan) —
              pakai pencarian/filter untuk mempersempit kalau perlu lihat semuanya.{" "}
              <strong>Kartu Total order/Nilai order/AOV/Belum lunas di atas TETAP akurat</strong> (dihitung
              dari agregat penuh, tidak ikut kepotong) — yang masih dari daftar terpotong ini cuma
              Repeat Order, Rata-rata Proses, dan Komplain.
            </p>
          </div>
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
                      <OrderCard key={o.id} order={o} onOpenChat={bukaChat} onOpenTimeline={setTimelineOrder} onStatusChange={handleStatusChange} onStageChange={handleStageChange} onPaymentChange={handlePaymentChange} paymentLocked={o.paymentStatus === "LUNAS" && !canEditLunas} />
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
                  {/* Header bisa diklik untuk urut — komponen TH sama yang
                      dipakai tabel Pelanggan (components/ui/table.jsx), jadi
                      perilaku & tampilannya konsisten di seluruh CRM. */}
                  <TH sortable sortDir={sortKey === "orderNumber" ? sortDir : null} onSort={() => toggleSort("orderNumber")}>ID Order</TH>
                  <TH sortable sortDir={sortKey === "customerName" ? sortDir : null} onSort={() => toggleSort("customerName")}>Pelanggan</TH>
                  <TH sortable sortDir={sortKey === "category" ? sortDir : null} onSort={() => toggleSort("category")}>Kategori</TH>
                  <TH sortable sortDir={sortKey === "status" ? sortDir : null} onSort={() => toggleSort("status")}>Status</TH>
                  <TH sortable sortDir={sortKey === "pipelineStage" ? sortDir : null} onSort={() => toggleSort("pipelineStage")}>Pipeline</TH>
                  <TH numeric sortable sortDir={sortKey === "daysInStatus" ? sortDir : null} onSort={() => toggleSort("daysInStatus")}>Lama</TH>
                  <TH sortable sortDir={sortKey === "paymentStatus" ? sortDir : null} onSort={() => toggleSort("paymentStatus")}>Pembayaran</TH>
                  <TH numeric sortable sortDir={sortKey === "value" ? sortDir : null} onSort={() => toggleSort("value")}>Nilai</TH>
                  <TH sortable sortDir={sortKey === "promo" ? sortDir : null} onSort={() => toggleSort("promo")}>Promo</TH>
                  <TH sortable sortDir={sortKey === "assignedSales" ? sortDir : null} onSort={() => toggleSort("assignedSales")}>Sales</TH>
                  <TH sortable sortDir={sortKey === "createdAt" ? sortDir : null} onSort={() => toggleSort("createdAt")}>Dibuat</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {items.map((o) => {
                  const mandek = isMandek(o);
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setTimelineOrder(o)}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-hovertint"
                    >
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
                        <PaymentStatusSelect order={o} onChange={handlePaymentChange} locked={o.paymentStatus === "LUNAS" && !canEditLunas} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-ink">
                        {formatRupiah(o.value || 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {o.promo ? (
                          // "violet dekoratif dilipat ke accent" — satu aturan
                          // warna aksen di seluruh design system, lihat
                          // components/ui/badge.jsx variant="violet".
                          // KODE (bukan nama campaign) yang ditampilkan —
                          // 1 campaign (mis. "MDSP-Aug") sering punya BEBERAPA
                          // kode voucher (MERDEKA10, MERDEKA8), kode itu yang
                          // membedakan, nama campaign cuma di tooltip.
                          <span className="rounded-chip bg-accentbg px-1.5 py-0.5 text-[10px] font-semibold text-accent" title={o.promo.name}>
                            {o.promo.code}
                          </span>
                        ) : <span className="text-ink3">—</span>}
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-2.5", o.assignedSales ? "font-medium text-ink2" : "text-ink3")}>
                        {o.assignedSales?.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-ink3">
                        {o.createdAt ? formatTanggalPendek(o.createdAt) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setTimelineOrder(o)} title="Rincian pesanan"
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
