import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Users, GitBranch, ClipboardList,
  Megaphone, BarChart3, Zap, Settings, UserCog, Bell,
  LogOut, Package, X, Link2, Sparkles, MoreVertical, ChevronLeft, ChevronRight,
  Wrench, Truck, Gauge, CalendarClock, Route, MapPin, ClipboardCheck, AlertTriangle, Undo2,
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Scale, TrendingUp,
  Boxes, ScanLine, Award,
} from "lucide-react";
import { LayoutGroup, AnimatePresence, motion } from "framer-motion";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import Topbar from "./Topbar.jsx";
import ToastNotif from "./ToastNotif.jsx";
import SidebarLink from "./SidebarLink.jsx";
import WorkspaceSwitcher from "./WorkspaceSwitcher.jsx";
import NotificationDrawer from "@/features/notifications/NotificationDrawer.jsx";
import Avatar from "./Avatar.jsx";
import { BRAND } from "@/lib/brand.js";
import { isAdminUser, rolesOf } from "@/lib/roles.js";
import SidebarPromo from "@/features/settings/SidebarPromo.jsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { cn } from "@/lib/utils.js";

// ─── SIDEBAR PER DIVISI (1 Agustus 2026, Gilang) ─────────────────────────────
// SEBELUMNYA satu NAV_SECTIONS statis dipakai di SETIAP halaman — masuk ke
// Bengkel/Armada/Kendali tetap menampilkan menu CRM (Inbox/Pelanggan/
// Pipeline/dst), yang tidak relevan sama sekali di sana. Sekarang sidebar
// ditentukan dari PATH aktif (divisionFromPath di bawah) — pindah divisi =
// seluruh menu dan badge di sidebar ikut berganti, bukan cuma konten halaman.
//
// ⚠️ WARNA: sejak 1 Agustus 2026 SELURUH divisi memakai biru SANSS yang sama
// (keputusan Gilang: "tiru persis file desain v4", dan v4 monokrom biru).
// SEBELUMNYA tiap divisi punya aksen sendiri (growth biru, bengkel amber,
// warehouse sky, armada emerald, kendali violet) yang juga mewarnai kartu di
// Portal. Konsekuensi yang DISADARI saat mengambil keputusan ini: warna tidak
// lagi jadi penanda "saya sedang di divisi mana" — sekarang penandanya tinggal
// LABEL TEKS di badge divisi + ikon. Kalau suatu saat orientasi divisi terasa
// hilang, kembalikan `accent` per divisi di bawah (dan PORTAL_ACCENT di
// Portal.jsx), jangan menambal dengan warna di satu tempat saja.
const DIVISION_ACCENT = {
  text: "text-blue-700",
  bg: "bg-blue-50",
  dot: "bg-blue-700",
};

const DIVISIONS = {
  growth: {
    label: "Growth",
    // Tanpa cssVar — default token (:root, tokens.css) sudah biru SANSS
    // (#1457D9), jadi tidak ada yang perlu di-override.
    accent: DIVISION_ACCENT,
    sections: [
      {
        section: "OPERASIONAL",
        items: [
          { to: "/dashboard", label: "Dashboard",  Icon: LayoutDashboard },
          { to: "/inbox",     label: "Inbox",       Icon: MessageSquare, badge: true },
        ],
      },
      {
        section: "DATA",
        items: [
          { to: "/customers", label: "Pelanggan",     Icon: Users },
          { to: "/pipeline",  label: "Pipeline",      Icon: GitBranch },
          // Order = sisi PENGERJAAN (antrean produksi), terpisah dari Pipeline yang
          // sisi PENJUALAN. Sengaja bukan tab di Pelanggan: 1 baris = 1 order.
          { to: "/orders",    label: "Order",         Icon: ClipboardList },
          // Sales sekarang boleh tambah produk sendiri (backend routes/products.js
          // membatasi edit/hapus HANYA ke produk buatannya sendiri, admin bebas).
          { to: "/products",  label: "Galeri Produk", Icon: Package },
        ],
      },
      {
        section: "OUTREACH",
        adminOnly: true,
        items: [
          { to: "/broadcast", label: "Broadcast & Campaign", Icon: Megaphone },
          { to: "/tracking",  label: "Link Pelacakan",       Icon: Link2 },
        ],
      },
      {
        section: "ANALITIK",
        adminOnly: true,
        items: [
          // Sales Performance Intelligence (28 Agustus 2026) — dijadikan HUB
          // utama & item PERTAMA menu Analitik: agregasi Quality Scorer +
          // Sales Risk Engine + SLA per sales dalam 1 baris ringkas, dengan
          // drill-down ke 2 halaman detail di bawah (yang TIDAK dihapus,
          // cuma bukan lagi entry point utama — route-nya tetap ada di
          // App.jsx, diakses via link dari dalam hub).
          { to: "/sales-intelligence", label: "Sales Performance Intelligence", Icon: Award },
          { to: "/laporan", label: "Laporan", Icon: BarChart3 },
        ],
      },
      {
        section: "AI & OTOMASI",
        items: [
          { to: "/copilot",    label: "Tanya Sano", Icon: Sparkles },
          { to: "/automation", label: "Otomasi",    Icon: Zap, adminOnly: true },
        ],
      },
      // Dipindah DARI /pengaturan (Main Hub) — 26 Agustus 2026, permintaan
      // owner: Template Pesan/Target Sales/Promo pengaturan khusus CRM,
      // bukan lintas-divisi, jadi tempatnya di sini, bukan Hub.
      //
      // BUG YANG DIPERBAIKI (putaran kedua, sama hari): sempat dipecah jadi
      // 3 <SidebarLink> terpisah (satu per section, beda cuma ?section=) —
      // NavLink React Router hanya mencocokkan PATHNAME utk `isActive`,
      // bukan search string, jadi ketiganya ke pathname yang SAMA persis
      // (/pengaturan-sales) dan SEMUANYA menyala aktif bersamaan, bukan cuma
      // yang sedang dibuka. Halaman itu SENDIRI sudah punya nav internal
      // (kartu Template Pesan/Target Sales/Promo di dalam PengaturanSales.jsx)
      // — 3 link sidebar di atasnya cuma duplikasi navigasi yang membingungkan
      // DAN buggy. Sekarang satu link saja, gerbang per-section (SALES cuma
      // Template Pesan) tetap ditegakkan DI DALAM halamannya sendiri.
      {
        section: "PENGATURAN CRM",
        items: [
          { to: "/pengaturan-sales", label: "Pengaturan", Icon: Settings },
        ],
      },
    ],
  },
  // ── PRODUCTION OPERATIONS (diperluas 2 Agustus 2026, Tahap 1) ───────────
  // Sebelumnya satu menu ("Papan Produksi"). Sekarang enam.
  //
  // ⚠️ MODUL INI KEBALIKAN dari Delivery & Warehouse. Di dua modul itu,
  // schema-nya yang belum ada dan harus dibangun. Di sini schema + stage
  // engine SUDAH LENGKAP sejak awal (12 routing_stages & 6 service_catalog
  // ter-seed, unitStageEngine.js punya start/complete/fail/skip/QC) — yang
  // belum ada cuma UI-nya. Jadi tahap-tahap berikutnya sebagian besar
  // MENYAMBUNGKAN endpoint yang sudah ditulis, bukan migrasi baru.
  //
  // Capacity Planning, Product Recipe, dan Maintenance dari mockup SENGAJA
  // TIDAK dimasukkan ke sidebar: tidak ada entitas mesin, BOM, maupun
  // jadwal perawatan di sistem ini, dan tidak ada alur bisnis berjalan yang
  // membutuhkannya. Ketiganya tetap jadi kartu "Segera hadir" di Portal —
  // menampilkannya di sidebar akan menyiratkan janji yang belum tentu ditepati.
  bengkel: {
    label: "Production",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "PRODUCTION",
        items: [
          { to: "/bengkel",                 label: "Papan Produksi",  Icon: ClipboardList },
          { to: "/bengkel/work-orders",     label: "Work Order",      Icon: Boxes },
          { to: "/bengkel/qc",              label: "QC Inspection",   Icon: ScanLine },
          { to: "/bengkel/scope-revisions", label: "Revisi Lingkup",  Icon: GitBranch },
          { to: "/bengkel/materials",       label: "Bahan Produksi",  Icon: ArrowUpFromLine },
          { to: "/bengkel/reports",         label: "Laporan",         Icon: BarChart3 },
        ],
      },
    ],
  },
  // Workspace ke-5 (SANSS, 1 Agustus 2026) — Gudang dikeluarkan dari Bengkel
  // jadi workspace sendiri. Lihat alasannya di backend constants/permissions.js.
  //
  // ── DIPERLUAS 2 Agustus 2026, Warehouse Tahap 1 ─────────────────────────
  // Sebelumnya satu menu ("Stok & Material" → /gudang). Sekarang sembilan,
  // dengan prefiks route BARU /warehouse/* — bukan /gudang/*.
  //
  // KENAPA GANTI PREFIKS (padahal Delivery justru MEMPERTAHANKAN /armada/*):
  // di Delivery, kunci workspace-nya memang "armada", jadi path dan kunci
  // sudah cocok. Di sini TIDAK: kunci workspace, PORTALS backend,
  // divisionContent, dan notificationTypes SEMUANYA sudah menyebut
  // "warehouse" — cuma path-nya yang sendirian menyebut "gudang". Menyamakan
  // sekarang MENGHILANGKAN ketidakcocokan itu, bukan menambah yang baru, dan
  // ongkosnya nol: cuma ada SATU route lama untuk dialihkan (/gudang) dan
  // tabel materials/stock_movements masih kosong di production.
  //
  // /gudang TIDAK dihapus — di-redirect ke /warehouse/inventory di App.jsx,
  // dan halaman lamanya (pages/Gudang.jsx) TETAP UTUH sebagai satu-satunya
  // halaman berdata NYATA sampai Tahap 2 menyambungkan backend.
  warehouse: {
    label: "Warehouse",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "WAREHOUSE",
        items: [
          { to: "/warehouse/dashboard",     label: "Dashboard",         Icon: LayoutDashboard },
          { to: "/warehouse/inventory",     label: "Stock & Material",  Icon: Package },
          { to: "/warehouse/goods-receipt", label: "Goods Receipt",     Icon: ArrowDownToLine },
          { to: "/warehouse/material-issue",label: "Material Issue",    Icon: ArrowUpFromLine },
          { to: "/warehouse/transfers",     label: "Stock Transfer",    Icon: ArrowLeftRight },
          { to: "/warehouse/stock-count",   label: "Cycle Count & Opname", Icon: Scale },
          { to: "/warehouse/replenishment", label: "Replenishment",     Icon: TrendingUp },
          { to: "/warehouse/adjustments",   label: "Damaged & Retur",   Icon: AlertTriangle },
          { to: "/warehouse/reports",       label: "Reports",           Icon: BarChart3 },
        ],
      },
    ],
  },
  // ── DELIVERY & FULFILLMENT (diperluas 2 Agustus 2026, Tahap 1) ───────────
  // Sebelumnya satu menu ("Jadwal & Job" → /armada). Sekarang sembilan, dan
  // route-nya bersarang di bawah /armada/* — BUKAN /delivery/*, supaya satu
  // divisi tidak punya dua nama: `divisionFromPath()` di bawah, PORTALS di
  // backend, dan WorkspaceSwitcher semuanya sudah memakai "armada".
  //
  // /armada (tanpa sub-path) TIDAK dihapus — ia redirect ke /armada/dashboard
  // di App.jsx, karena masih dirujuk PORTALS backend & divisionContent.js.
  //
  // Ikon semuanya dari lucide-react yang sudah terpasang; tidak ada library
  // ikon baru.
  armada: {
    label: "Delivery",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "DELIVERY & FULFILLMENT",
        items: [
          { to: "/armada/dashboard", label: "Dashboard",           Icon: LayoutDashboard },
          { to: "/armada/jobs",      label: "Jadwal & Penugasan",  Icon: CalendarClock },
          { to: "/armada/routes",    label: "Route Planner",       Icon: Route },
          { to: "/armada/tracking",  label: "Live Tracking",       Icon: MapPin },
          { to: "/armada/resources", label: "Driver & Armada",     Icon: Truck },
          { to: "/armada/pod",       label: "Proof of Delivery",   Icon: ClipboardCheck },
          { to: "/armada/issues",    label: "Kendala & Reschedule",Icon: AlertTriangle },
          { to: "/armada/returns",   label: "Retur",               Icon: Undo2 },
          { to: "/armada/reports",   label: "Laporan",             Icon: BarChart3 },
        ],
      },
    ],
  },
  kendali: {
    label: "All Teams",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "ALL TEAMS",
        items: [
          { to: "/kendali", label: "Ringkasan",  Icon: Gauge },
          { to: "/orders",  label: "Order",      Icon: ClipboardList },
          { to: "/laporan", label: "Laporan",    Icon: BarChart3, adminOnly: true },
        ],
      },
    ],
  },
};

// Nav Main Hub (/portal) — SEBELUMNYA kosong total (lihat komentar di atas
// <nav>), tapi Pengaturan/Pengguna & Peran cuma pernah bisa dijangkau lewat
// sidebar Growth walau ISI-nya (saat itu) sama sekali bukan urusan Sales
// (template pesan, jam operasional, dan sekarang 24 akun lintas 6 role —
// Produksi, Armada, Gudang, Finance, dst, bukan cuma sales). Dipindah
// (bukan digandakan) ke sini supaya letaknya sesuai cakupannya: lintas-
// divisi, bukan milik satu workspace. Notifikasi ditambahkan sekalian —
// halamannya (pages/Notifications.jsx, route /notifications) sudah lama
// ada tapi sebelum ini tidak tertaut di sidebar mana pun sama sekali, cuma
// lewat ikon lonceng di Topbar.
//
// REVISI 26 Agustus 2026 (permintaan owner): /pengaturan TIDAK LAGI berisi
// SEMUA pengaturan seperti saat komentar di atas ditulis — Template Pesan/
// Target Sales/Promo (section "PENGATURAN CRM" di DIVISIONS.growth di
// atas) DIPINDAH BALIK ke sidebar Growth, karena ketiganya genuinely
// pengaturan khusus CRM (dipakai sales sehari-hari), bukan lintas-divisi
// seperti sisa isi /pengaturan (Profil Perusahaan, Status WhatsApp,
// Tampilan, Keamanan Akun, Data & Backup) yang TETAP di sini. Jangan
// baca komentar di atas sebagai "seluruh Pengaturan ada di Hub" — itu
// benar untuk Pengguna & Peran + 5 section lintas-divisi itu saja.
//
// SENGAJA TIDAK menambah item operasional (Dashboard/Order/Inbox dst) di
// sini — itu tempatnya di sidebar masing-masing divisi. 5 kartu workspace
// di halaman Hub sendiri sudah cukup untuk "masuk ke divisi mana"; kalau
// Hub ikut menduplikasi menu operasional dia jadi divisi ke-6 yang
// membingungkan, bukan lobi antar-divisi.
// Path yang TERTAUT dari HUB_SECTIONS tapi TIDAK punya prefiks divisi apa
// pun di divisionFromPath() — tanpa daftar ini, membuka salah satu dari
// ketiganya jatuh ke fallback "growth" di divisionKey (lihat komentar di
// sana), yang bikin sidebar & WorkspaceSwitcher diam-diam berpindah balik
// ke Sales CRM padahal user baru saja klik dari Main Hub. BUG NYATA (22
// Agustus 2026): persis inilah yang bikin klik Notifikasi/Pengaturan/
// Pengguna & Peran di sidebar Hub "kelihatan seperti pindah ke CRM".
const HUB_ONLY_PATHS = ["/notifications", "/pengaturan", "/pengguna"];

const HUB_SECTIONS = [
  {
    section: "UMUM",
    items: [
      { to: "/notifications", label: "Notifikasi", Icon: Bell },
    ],
  },
  {
    section: "PENGATURAN",
    items: [
      { to: "/pengaturan", label: "Pengaturan",       Icon: Settings },
      { to: "/pengguna",   label: "Pengguna & Peran", Icon: UserCog, adminOnly: true },
    ],
  },
];

// ⚠️ RAIL IKON 78px SUDAH DIHAPUS (refactor navigasi 2 Agustus 2026).
// Dulu ada DUA elemen navigasi berdampingan di desktop: rail ikon di paling
// kiri + sidebar lebar di sebelahnya. Itu memakan ~322px lebar sebelum konten
// dimulai, dan menyediakan jalan KEDUA ke tiap divisi yang tumpang tindih
// dengan isi sidebar. Sekarang tinggal SATU sidebar yang bisa disempitkan,
// dan perpindahan antar divisi lewat WorkspaceSwitcher di puncaknya.
// Daftar workspace-nya sekarang tinggal di components/WorkspaceSwitcher.jsx —
// jangan dihidupkan lagi di sini, cukup satu sumber.

// Prefix path → kunci divisi. Path yang tidak cocok apa pun jatuh ke "growth"
// sebagai default aman — itu perilaku LAMA (satu-satunya nav sebelum perubahan
// ini), jadi tidak ada regresi untuk halaman yang belum dipetakan eksplisit.
//
// ⚠️ /portal (hub MURNI) TIDAK boleh mengandalkan fungsi ini — kalau
// dipaksakan, fallback "growth" di bawah membuat hub terbaca sebagai Growth
// dan sidebar-nya ikut nyala di halaman yang bukan divisi mana pun. Pemakai
// mengecek `pathname === "/portal"` (disebut `onHub` di komponen Layout)
// DULU, baru pakai fungsi ini untuk path lainnya.
//
// /gudang SEKARANG milik "warehouse", bukan lagi "bengkel" — Gudang sudah
// jadi workspace sendiri (SANSS, 1 Agustus 2026).
function divisionFromPath(pathname) {
  // /warehouse/* adalah prefiks BARU (Tahap 1); /gudang dipertahankan supaya
  // link lama & halaman berdata nyata pages/Gudang.jsx tetap punya sidebar
  // yang benar sampai dipensiunkan.
  if (pathname.startsWith("/warehouse")) return "warehouse";
  if (pathname.startsWith("/gudang")) return "warehouse";
  if (pathname.startsWith("/bengkel")) return "bengkel";
  if (pathname.startsWith("/armada")) return "armada";
  if (pathname.startsWith("/kendali")) return "kendali";
  return "growth";
}

// /portal/:key (command center — DivisionPage.jsx) PUNYA divisi aktif:
// kuncinya diambil LANGSUNG dari path, bukan lewat divisionFromPath (yang
// fallback ke "growth" dan akan salah untuk keempat divisi lain — path
// "/portal/bengkel" tidak cocok prefiks apa pun di divisionFromPath).
function portalDivisionKey(pathname) {
  const m = /^\/portal\/([^/]+)/.exec(pathname);
  return m ? m[1] : null;
}

// Buat bunyi notifikasi pakai Web Audio API — tidak perlu file eksternal
function playNotifSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    ctx.close();
  } catch {}
}

export default function Layout({ user, onLogout, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Ikut "hub" untuk keperluan sidebar/switcher: /portal SUNGGUHAN, ATAU
  // salah satu halaman lintas-divisi yang cuma tertaut dari sana (lihat
  // HUB_ONLY_PATHS) — keduanya sama-sama "bukan milik divisi mana pun".
  const onHub = location.pathname === "/portal" || HUB_ONLY_PATHS.includes(location.pathname);
  // Divisi yang lagi aktif — SATU fungsi ini dipakai untuk RAIL (ikon mana
  // yang menyala) MAUPUN sidebar lebar (konten mana yang ditampilkan).
  // Command center (/portal/:key) py kunci divisi LANGSUNG dari path-nya
  // (portalDivisionKey) — kalau ini dilewatkan dan jatuh ke divisionFromPath
  // biasa, path "/portal/bengkel" tidak cocok prefiks mana pun di sana dan
  // fallback ke "growth", jadi sidebar Bengkel keliru menampilkan menu
  // Growth. Baru kalau BUKAN command center, pakai divisionFromPath (halaman
  // kerja asli: /inbox, /bengkel, /gudang, dst).
  const divisionKey = onHub ? null : (portalDivisionKey(location.pathname) || divisionFromPath(location.pathname));
  const divisionBase = DIVISIONS[divisionKey || "growth"];

  // Driver murni cuma punya JOB_OWN_READ/JOB_OWN_WRITE — DELAPAN dari sembilan
  // menu Delivery (Dashboard, Route Planner, Live Tracking, Driver & Armada,
  // POD, Kendala, Retur, Laporan) butuh JOB_READ/ROUTE_WRITE dan akan gagal
  // memuat untuk mereka. Menampilkan menu yang pasti buntu membuat sistem
  // terbaca rusak di mata driver — persis alasan yang sudah ditulis di App.jsx
  // kenapa route placeholder dibuat, dibalik ke sisi navigasi.
  //
  // Ditemukan 21 Agustus 2026 saat uji kesiapan divisi dengan akun driver
  // sungguhan (sebelumnya semua pengujian pakai admin, yang punya semua hak).
  const division = React.useMemo(() => {
    const roles = rolesOf(user);
    // HELPER (D-037) ikut disederhanakan sidebarnya sama seperti DRIVER.
    // LEADER_DRIVER (D-042) — lihat catatan sama di App.jsx.
    const driverOnly = roles.some((r) => ["DRIVER", "HELPER"].includes(r)) && !roles.some((r) => ["ADMIN", "DISPATCHER", "LEADER_DRIVER"].includes(r));
    if (divisionKey !== "armada" || !driverOnly) return divisionBase;
    return {
      ...divisionBase,
      sections: [{
        section: "TUGAS SAYA",
        items: divisionBase.sections[0].items.filter((i) => i.to === "/armada/jobs")
          .map((i) => ({ ...i, label: "Job Saya" })),
      }],
    };
  }, [divisionBase, divisionKey, user]);

  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast]             = useState(null); // { customerName, preview, conversationId }
  const [mobileOpen, setMobileOpen]   = useState(false);
  // Sidebar menyempit (248px → 72px). Dikembalikan pada refactor navigasi
  // 2 Agustus 2026: begitu rail ikon dihapus, menyempitkan sidebar jadi
  // satu-satunya cara melebarkan area konten — dan itu memang salah satu
  // keluhan yang memicu refactor ini.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true"
  );
  const prevUnread    = useRef(null); // null = belum ada data awal
  const lastSeenAt    = useRef(new Date().toISOString()); // timestamp polling terakhir
  const fetchUnreadRef = useRef(null); // ref ke fetchUnread terbaru untuk SSE callback

  // BUG (ditemukan QA 1 Agustus 2026): SEBELUMNYA `user?.role === "ADMIN"` —
  // field LEGACY tunggal, bukan array `roles` dari sistem multi-role (D-010).
  // Lihat lib/roles.js untuk detail. Kebetulan tidak kelihatan di production
  // karena admin yang ada sekarang (Gilang, Novi) sama-sama masih punya
  // legacy role=ADMIN.
  const isAdmin = isAdminUser(user);

  // SSE: saat ada pesan baru, refresh badge unread & notifikasi langsung tanpa tunggu interval
  useSSE("new_message", () => { fetchUnreadRef.current?.(); });

  // Refresh badge saat app kembali ke foreground (dari App.jsx visibilitychange)
  useEffect(() => {
    const handler = () => { fetchUnreadRef.current?.(); };
    window.addEventListener("app-visible", handler);
    return () => window.removeEventListener("app-visible", handler);
  }, []);

  // Minta izin notifikasi sekali saat pertama login
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      // Tunda sedikit supaya tidak muncul langsung saat buka app (kurang ramah)
      const timer = setTimeout(() => Notification.requestPermission(), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  function kirimNotifikasi(jumlahBaru) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    // tag: "pesan-baru" supaya notifikasi lama di-replace, tidak menumpuk
    new Notification(BRAND.name, {
      body: jumlahBaru === 1
        ? "Ada 1 pesan baru masuk"
        : `Ada ${jumlahBaru} pesan baru masuk`,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: "pesan-baru",
      renotify: true,
    });
  }

  useEffect(() => {
    async function fetchUnread() {
      try {
        const { count, latest } = await api.getLatestUnread(lastSeenAt.current);
        const now = new Date().toISOString();

        // Pertama kali load: simpan sebagai baseline, tidak notif
        if (prevUnread.current === null) {
          prevUnread.current = count;
          lastSeenAt.current = now;
          setUnreadCount(count);
          return;
        }

        if (count > prevUnread.current) {
          // Ada pesan baru masuk sejak polling terakhir
          kirimNotifikasi(count - prevUnread.current);
          playNotifSound();
          if (latest) setToast(latest);
        }
        prevUnread.current = count;
        lastSeenAt.current = now;
        setUnreadCount(count);
      } catch {}
    }
    fetchUnreadRef.current = fetchUnread; // update ref supaya SSE callback pakai versi terbaru
    fetchUnread();
    // SSE sebagai trigger utama — polling 60s hanya sebagai fallback
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, []);

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar-collapsed", String(!v));
      return !v;
    });
  }

  // Sama bug-nya dengan isAdmin di atas — sebelumnya `user.role` legacy
  // langsung, jadi badge di pojok sidebar bisa nampilin "SALES" walau user
  // itu sekarang juga punya role ADMIN lewat multi-role. ADMIN diprioritaskan
  // kalau dipegang (paling relevan buat badge ringkas), baru role pertama.
  const displayRole = isAdmin ? "ADMIN" : (rolesOf(user)[0] || "SALES");
  const roleLower = displayRole.toLowerCase();

  return (
    <div className={cn("app-shell", collapsed && "sidebar-collapsed")}>
      {/* Toast notifikasi pesan masuk */}
      <ToastNotif toast={toast} onClose={() => setToast(null)} />

      {/* Drawer notifikasi GLOBAL — di-mount di shell, bukan di Topbar, supaya
          overlay & focus trap-nya berada di atas seluruh layout (termasuk
          sidebar), bukan terjebak di dalam header setinggi 60px.
          ⚠️ BUG NYATA (dilaporkan Gilang, 2 Agustus 2026): sebelumnya import
          komponen ini ADA di file ini, tapi <NotificationDrawer /> TIDAK
          PERNAH ditulis — cuma diimpor, tidak pernah dipakai. Bell membaca
          drawerOpen dari store dan meng-togglenya dengan benar, tapi karena
          komponen yang merender drawer itu sendiri tidak pernah mount, state
          berubah tanpa ada apa pun di layar yang bereaksi. Klik lonceng
          terlihat "tidak ada respon" — bukan karena state-nya salah, tapi
          karena tidak ada yang mendengarkannya. */}
      <NotificationDrawer />

      {/* Backdrop drawer mobile. Sidebar sekarang ADA di semua halaman
          (termasuk Main Hub — switcher-nya tinggal di sana), jadi tidak ada
          lagi pengecualian /portal seperti sebelumnya. */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={closeMobileMenu} />
      )}

      {/* ── SATU-SATUNYA SIDEBAR (refactor navigasi 2 Agustus 2026) ─────────
          Sebelumnya ada dua elemen berdampingan: rail ikon 78px + sidebar
          244px. Rail sudah DIHAPUS. Sidebar ini sekarang:
            · desktop  → 248px, bisa disempitkan jadi 72px (ikon + tooltip)
            · ≤768px   → drawer geser, dipicu hamburger di topbar
          SELALU di-mount di DOM (bukan digantung ke `mobileOpen`) supaya CSS
          transform slide in/out bekerja konsisten. */}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        {/* Brand — logo & nama BISA DIKLIK untuk kembali ke Main Hub. */}
        <div className="sidebar-brand">
          <button
            type="button"
            onClick={() => { navigate("/portal"); closeMobileMenu(); }}
            title="Kembali ke Main Hub"
            aria-label="Kembali ke Main Hub"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-btn text-left transition-opacity hover:opacity-80"
          >
            <div className="sidebar-brand-icon">
              <span className="sidebar-brand-inner">
                <img src="/logo-small.png" alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />
              </span>
            </div>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="sidebar-brand-name">{BRAND.name}</span>
                <span className="sidebar-brand-sub">{BRAND.subtitle}</span>
              </span>
            )}
          </button>

          {/* Tutup drawer — mobile saja (CSS menyembunyikannya di desktop) */}
          <button className="sidebar-close-mobile" onClick={closeMobileMenu} title="Tutup">
            <X size={16} />
          </button>

          {/* Sempitkan/lebarkan — desktop saja */}
          <button
            className="sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? "Lebarkan sidebar" : "Sempitkan sidebar"}
            aria-label={collapsed ? "Lebarkan sidebar" : "Sempitkan sidebar"}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>

        {/* Pemilih workspace — MENGGANTIKAN rail ikon sekaligus tombol
            "badge divisi" yang dulu juga melompat ke Main Hub. */}
        <WorkspaceSwitcher
          activeKey={onHub ? null : divisionKey}
          collapsed={collapsed}
          userRoles={rolesOf(user)}
          onNavigate={closeMobileMenu}
        />

        {/* Navigation — menu DI DALAM workspace yang sedang dibuka. Di Main Hub
            dirender dari HUB_SECTIONS (lintas-divisi: Pengaturan, Pengguna &
            Peran, Notifikasi) — BUKAN kosong seperti sebelumnya, dan bukan
            menu operasional divisi mana pun. Lihat catatan di HUB_SECTIONS. */}
        <nav className="sidebar-nav">
          {/* LayoutGroup: pill aktif geser mulus antar item (layoutId). Data nav,
              role gating, dan kondisi badge unread TIDAK berubah — cuma sumbernya
              sekarang `division.sections` (atau HUB_SECTIONS di Main Hub). */}
          <LayoutGroup>
          {(onHub ? HUB_SECTIONS : division.sections).map(({ section, adminOnly, items }) => {
            if (adminOnly && !isAdmin) return null;
            return (
              <div key={section} className="nav-section">
                <div className="sidebar-section-label">{section}</div>
                {items.map(({ to, label, Icon, badge, adminOnly: itemAdmin }) => {
                  if (itemAdmin && !isAdmin) return null;
                  // Affordance AI HALUS untuk "Tanya Sano" (ikon violet + dot).
                  const isAI = to === "/copilot";
                  const showBadge = !!(badge && unreadCount > 0);
                  return (
                    <SidebarLink
                      key={to}
                      to={to}
                      label={label}
                      Icon={Icon}
                      isAI={isAI}
                      showBadge={showBadge}
                      badgeCount={unreadCount}
                      collapsed={collapsed}
                      onNavigate={closeMobileMenu}
                    />
                  );
                })}
              </div>
            );
          })}
          </LayoutGroup>
        </nav>

        {/* Kartu promo "Tanya Sano" (DS v2.1) — fitur AI CRM, HANYA relevan di
            divisi Growth. Disembunyikan saat sidebar menyempit: kartunya butuh
            lebar penuh untuk terbaca, dan memaksanya masuk 72px cuma jadi
            kotak tanpa arti. */}
        {!onHub && divisionKey === "growth" && !collapsed && <SidebarPromo />}

        {/* User footer — blok profil sekaligus trigger menu akun (Radix Menu).
            onLogout = handler logout yang SUDAH ADA (tidak diubah), dipanggil
            dari item "Keluar". Tidak menyentuh state/flow autentikasi. */}
        <div className="sidebar-footer">
          <Menu
            align="start"
            trigger={
              <button className="sidebar-profile" type="button" title={collapsed ? user.name : "Menu akun"}>
                {/* Foto profil sungguhan kalau sudah diganti (Pengaturan >
                    Keamanan Akun) — fallback inisial berwarna kalau belum
                    pernah upload, sama seperti avatar customer di Inbox/Pelanggan. */}
                <Avatar name={user.name} src={user.avatarUrl} size="sm" className="sidebar-avatar" />
                {!collapsed && (
                  <>
                    <div className="sidebar-user-info">
                      <div className="sidebar-user-name">{user.name}</div>
                      <span className={`role-badge ${roleLower}`}>{displayRole}</span>
                    </div>
                    <MoreVertical size={15} className="sidebar-kebab-ic" />
                  </>
                )}
              </button>
            }
          >
            <MenuLabel>{user.name}</MenuLabel>
            <MenuSeparator />
            <MenuItem icon={LogOut} destructive onSelect={onLogout}>Keluar</MenuItem>
          </Menu>
        </div>

        {/* Versi app kecil — supaya gampang verifikasi device tertentu sudah
            pegang bundle terbaru (bukan basi dari service worker lama) tanpa
            perlu buka DevTools, tersedia untuk semua role (bukan cuma admin
            lewat Pengaturan, yang tidak bisa diakses SALES). */}
        {!collapsed && (
          <div className="sidebar-version" title={typeof __BUILD_TIME__ !== "undefined" ? new Date(__BUILD_TIME__).toLocaleString("id-ID") : undefined}>
            v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}
          </div>
        )}
      </aside>

      <main className="app-content">
        {/* Hamburger SELALU tersedia sekarang — sidebar ada di semua halaman,
            termasuk Main Hub, jadi tidak ada lagi kondisi "tombol tanpa
            drawer di baliknya". */}
        {/* `unreadCount` SENGAJA TIDAK dioper lagi ke Topbar (2 Agustus 2026):
            itu unread INBOX, dan badge lonceng sekarang menghitung notifikasi
            global dari notificationStore. unreadCount tetap dipakai di
            SidebarLink "Inbox" beberapa baris di atas — tempat yang benar. */}
        <Topbar
          onToggleMobileMenu={() => setMobileOpen((v) => !v)}
          user={user}
          onLogout={onLogout}
        />

        {/* Transisi antar halaman (catatan Gilang 1 Agustus 2026: "animasi
            setiap perpindahan agar lebih smooth"). Di-key oleh pathname —
            AnimatePresence mendeteksi route berganti dari situ, bukan dari
            `children` berubah identitas (yang selalu berubah tiap render).
            mode="wait": halaman lama selesai fade-out DULU baru yang baru
            fade-in — mode default ("sync") akan tumpang tindih sesaat dan
            terlihat "kedip" karena kedua halaman punya latar putih penuh.
            Durasi 160ms konsisten dengan pill aktif sidebar (SidebarLink,
            180ms) — motion Sano dipatok 150–200ms, jangan lebih lambat.

            ⚠️ BUG NYATA yang ditemukan begitu ini dipasang: Inbox tampil
            KOSONG TOTAL (cuma latar abu-abu). Sebabnya `.inbox-body` di
            index.css pakai `height:100%`, yang butuh PARENT LANGSUNG-nya
            (`.page-body`, flex:1 di dalam `.app-content` yang flex-column)
            py tinggi pasti. motion.div TANPA style apa pun defaultnya
            height:auto (block biasa) — jadi begitu dia disisipkan DI ANTARA
            `.page-body` dan `.inbox-body`, rantai height:100% putus di situ:
            `.inbox-body` menghitung 100% dari sebuah elemen yang tingginya
            sendiri "auto" (=nol/tak terhingga menurut kontennya), hasilnya
            grid 3-kolom Inbox kolaps. `h-full` di sini WAJIB ada supaya
            motion.div ikut menyalurkan tinggi 100% itu — halaman non-Inbox
            (Dashboard, Pelanggan, dst pakai PageContainer) tidak terpengaruh
            karena kontennya tetap overflow normal ke .page-body yang
            overflow-y:auto (h-full cuma menentukan tinggi BOX motion.div,
            bukan meng-clip konten yang lebih tinggi darinya). */}
        <div className="page-body">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              className="h-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
