import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Users, GitBranch, ClipboardList,
  Megaphone, BarChart3, Zap, Settings, UserCog,
  LogOut, Package, X, Link2, Sparkles, MoreVertical,
  Wrench, Truck, Gauge, Grid3x3,
} from "lucide-react";
import { LayoutGroup, AnimatePresence, motion } from "framer-motion";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import Topbar from "./Topbar.jsx";
import ToastNotif from "./ToastNotif.jsx";
import SidebarLink from "./SidebarLink.jsx";
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
          { to: "/products",  label: "Galeri Produk", Icon: Package, adminOnly: true },
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
      {
        // BUG YANG DIPERBAIKI: section ini SEBELUMNYA adminOnly di level SEKSI,
        // jadi SELURUH seksi (termasuk link "Pengaturan" itu sendiri) hilang
        // total dari sidebar SALES — akibatnya SALES tidak pernah bisa membuka
        // halaman Pengaturan sama sekali, walau pages/Pengaturan.jsx SUDAH
        // punya logika sendiri yang mempersempit tampilan SALES ke section
        // "Template Pesan" doang (lihat SALES_ALLOWED_SECTIONS di sana) — logika
        // itu tidak pernah kepakai karena pintu masuknya sudah tertutup di sini.
        // "Pengguna & Peran" TETAP admin-only (item-level, seperti section lain
        // yang campur admin+non-admin, mis. DATA/Galeri Produk).
        section: "PENGATURAN",
        items: [
          { to: "/pengaturan", label: "Pengaturan",       Icon: Settings },
          { to: "/pengguna",   label: "Pengguna & Peran", Icon: UserCog, adminOnly: true },
        ],
      },
    ],
  },
  bengkel: {
    label: "Production",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "PRODUCTION",
        items: [
          { to: "/bengkel", label: "Papan Produksi", Icon: ClipboardList },
        ],
      },
    ],
  },
  // Workspace ke-5 (SANSS, 1 Agustus 2026) — Gudang dikeluarkan dari Bengkel
  // jadi workspace sendiri. Lihat alasannya di backend constants/permissions.js.
  warehouse: {
    label: "Warehouse",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "WAREHOUSE",
        items: [
          { to: "/gudang", label: "Stok & Material", Icon: Package },
        ],
      },
    ],
  },
  armada: {
    label: "Delivery",
    accent: {
      ...DIVISION_ACCENT,
    },
    sections: [
      {
        section: "ARMADA",
        items: [
          { to: "/armada", label: "Jadwal & Job", Icon: Truck },
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

const DIVISION_ICON = { growth: Users, bengkel: Wrench, warehouse: Package, armada: Truck, kendali: Gauge };

// Urutan + hak akses rail ikon (SANSS v4). HARUS cocok dengan PORTALS di
// backend/src/constants/permissions.js — kalau tidak, rail menampilkan tombol
// yang backend-nya menolak (atau menyembunyikan yang sebenarnya boleh).
// Ini duplikasi yang disengaja & kecil: rail perlu tahu daftarnya SEBELUM
// halaman apa pun fetch, dan blokir sebenarnya tetap ditegakkan backend.
const RAIL_ITEMS = [
  { key: "growth",    to: "/dashboard", label: "Sales CRM",           roles: ["ADMIN", "SALES"] },
  { key: "bengkel",   to: "/bengkel",   label: "Production",          roles: ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"] },
  { key: "warehouse", to: "/gudang",    label: "Warehouse",           roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_LEAD"] },
  { key: "armada",    to: "/armada",    label: "Delivery",            roles: ["ADMIN", "DISPATCHER", "DRIVER"] },
  { key: "kendali",   to: "/kendali",   label: "All Teams Dashboard", roles: ["ADMIN", "FINANCE"] },
];

// ── RAIL IKON (78px) — navigasi UTAMA SANSS ────────────────────────────────
// Satu tombol = DASHBOARD satu divisi (instruksi Gilang 1 Agustus 2026:
// "di main menu sidebarnya itu dashboard masing-masing divisi"). Menu detail
// CRM (Inbox/Pelanggan/Pipeline/…) TIDAK di sini — itu hanya milik Sales CRM
// dan tampil sebagai sidebar kedua, lihat render di Layout.
function WorkspaceRail({ activeKey, atHub, userRoles, onNavigate, onLogout }) {
  const navigate = useNavigate();
  const visible = RAIL_ITEMS.filter((it) => it.roles.some((r) => userRoles.includes(r)));

  const btn = "group relative flex h-12 w-13 items-center justify-center rounded-[15px] transition-colors";

  return (
    <aside
      className="hidden w-[78px] shrink-0 flex-col items-center border-r border-[#DEE5EF] bg-white pb-4 pt-[18px] lg:flex"
      aria-label="Navigasi utama SANSS"
    >
      {/* Logo → Main Hub (Portal) */}
      <button
        type="button"
        onClick={() => { navigate("/portal"); onNavigate?.(); }}
        title="SANSS Main Hub"
        aria-current={atHub ? "page" : undefined}
        // Cincin saat berada di hub — begitu tidak ada ikon divisi yang
        // menyala, logo ini jadi satu-satunya penanda posisi di rail.
        className={cn(
          "mb-6 grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-gradient-to-br from-[#0E3B96] to-[#2F73F2] text-white shadow-[0_10px_24px_rgba(20,87,217,.22)]",
          atHub && "ring-2 ring-[#2F73F2] ring-offset-2"
        )}
      >
        <img src="/logo-small.png" alt="" className="h-5 w-5 object-contain brightness-0 invert" />
      </button>

      <nav className="flex w-full flex-col items-center gap-2.5 px-3">
        {visible.map((it) => {
          const active = it.key === activeKey;
          const Icon = DIVISION_ICON[it.key] || Users;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => { navigate(it.to); onNavigate?.(); }}
              aria-current={active ? "page" : undefined}
              className={cn(
                btn,
                active
                  ? "bg-[#E8F0FF] text-[#1457D9]"
                  : "text-[#7A8BA1] hover:bg-[#F4F7FF] hover:text-[#1457D9]"
              )}
            >
              {/* Penanda aktif — batang kecil di tepi kiri rail */}
              {active && (
                <span className="absolute -left-3 h-6 w-1 rounded-r-lg bg-[#1457D9]" aria-hidden />
              )}
              <Icon className="h-[21px] w-[21px]" strokeWidth={1.9} />
              <span className="pointer-events-none absolute left-[62px] z-40 whitespace-nowrap rounded-[9px] bg-[#071A3A] px-2.5 py-1.5 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
                {it.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={onLogout}
          title="Keluar"
          className={cn(btn, "text-[#7A8BA1] hover:bg-[#FDECEF] hover:text-[#D4485A]")}
        >
          <LogOut className="h-5 w-5" strokeWidth={1.9} />
        </button>
      </div>
    </aside>
  );
}

// Prefix path → kunci divisi. Path yang tidak cocok apa pun jatuh ke "growth"
// sebagai default aman — itu perilaku LAMA (satu-satunya nav sebelum perubahan
// ini), jadi tidak ada regresi untuk halaman yang belum dipetakan eksplisit.
//
// ⚠️ /portal TIDAK boleh mengandalkan fungsi ini. Portal adalah HUB, bukan
// divisi — ia berdiri DI ATAS kelima divisi. Karena fallback di bawah
// mengembalikan "growth" untuk path apa pun yang tidak dikenal, /portal ikut
// terbaca sebagai Growth dan sidebar CRM (Dashboard/Inbox/Pelanggan/…) muncul
// di halaman hub — persis bug yang dilaporkan Gilang 1 Agustus 2026. Pemakai
// wajib mengecek isPortalPath() DULU sebelum memakai hasil fungsi ini untuk
// memutuskan tampilan.
//
// /gudang SEKARANG milik "warehouse", bukan lagi "bengkel" — Gudang sudah
// jadi workspace sendiri (SANSS, 1 Agustus 2026).
function isPortalPath(pathname) {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

// /portal (hub) TIDAK punya divisi aktif (rail-nya kosong, lihat komentar di
// pemakaiannya). /portal/:key (command center — DivisionPage.jsx, ditambah
// 1 Agustus 2026 revisi kedua) PUNYA divisi aktif: kuncinya diambil langsung
// dari path, bukan lewat divisionFromPath (yang fallback ke "growth" dan akan
// salah untuk keempat divisi lain).
function portalDivisionKey(pathname) {
  const m = /^\/portal\/([^/]+)/.exec(pathname);
  return m ? m[1] : null;
}

function divisionFromPath(pathname) {
  if (pathname.startsWith("/gudang")) return "warehouse";
  if (pathname.startsWith("/bengkel")) return "bengkel";
  if (pathname.startsWith("/armada")) return "armada";
  if (pathname.startsWith("/kendali")) return "kendali";
  return "growth";
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
  const onPortal = isPortalPath(location.pathname);
  const onHub = location.pathname === "/portal";
  const divisionKey = divisionFromPath(location.pathname);
  const division = DIVISIONS[divisionKey];
  const DivisionIcon = DIVISION_ICON[divisionKey];
  // Rail: hub → tidak ada yang menyala; command center (/portal/:key) →
  // divisi diambil dari path itu sendiri; halaman kerja biasa → divisionKey.
  const railActiveKey = onHub ? null : (portalDivisionKey(location.pathname) || divisionKey);

  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast]             = useState(null); // { customerName, preview, conversationId }
  const [mobileOpen, setMobileOpen]   = useState(false);
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

  // Sama bug-nya dengan isAdmin di atas — sebelumnya `user.role` legacy
  // langsung, jadi badge di pojok sidebar bisa nampilin "SALES" walau user
  // itu sekarang juga punya role ADMIN lewat multi-role. ADMIN diprioritaskan
  // kalau dipegang (paling relevan buat badge ringkas), baru role pertama.
  const displayRole = isAdmin ? "ADMIN" : (rolesOf(user)[0] || "SALES");
  const roleLower = displayRole.toLowerCase();

  return (
    <div className="app-shell">
      {/* Toast notifikasi pesan masuk */}
      <ToastNotif toast={toast} onClose={() => setToast(null)} />

      {/* Backdrop untuk mobile sidebar — ikut dimatikan di /portal supaya
          tidak pernah ada layar gelap menutupi halaman tanpa drawer di
          baliknya (mis. drawer dibuka di /inbox lalu user pindah ke hub). */}
      {mobileOpen && !onPortal && (
        <div className="sidebar-backdrop" onClick={closeMobileMenu} />
      )}

      {/* Rail ikon — navigasi utama, SELALU tampil di desktop (semua divisi) */}
      {/* activeKey null saat di Portal — hub bukan salah satu divisi, jadi
          TIDAK boleh ada ikon divisi yang tersorot di rail. Kalau dibiarkan
          memakai divisionKey, Growth akan menyala di halaman hub (efek dari
          fallback divisionFromPath) dan seolah-olah user sudah berada di
          dalam Sales CRM padahal belum memilih apa pun. */}
      <WorkspaceRail
        activeKey={railActiveKey}
        atHub={onHub}
        userRoles={rolesOf(user)}
        onNavigate={closeMobileMenu}
        onLogout={onLogout}
      />

      {/* Sidebar detail — SEKARANG cuma MOBILE DRAWER, untuk SEMUA divisi
          (revisi 1 Agustus 2026, kedua kalinya). SEBELUMNYA sidebar lebar ini
          selalu tampil di desktop untuk Growth — Gilang minta itu dicabut:
          "taskbar di kiri cuma dashboard per team, bukan operasi/tambah
          task/job". Rail (WorkspaceRail, di atas) SUDAH memenuhi itu — cuma
          5 ikon dashboard. Sidebar lebar ini isinya justru item OPERASIONAL
          (Inbox/Pelanggan/Pipeline/Order/dst) — itu yang dipindah keluar dari
          kolom kiri permanen, sekarang cuma bar horizontal di bawah topbar
          (lihat app-content) untuk SEMUA divisi. Di desktop sidebar ini TIDAK
          PERNAH tampil lagi, cuma jadi drawer mobile (dipicu hamburger).

          DIKECUALIKAN DI /portal: halaman hub bukan divisi, jadi tidak py
          menu untuk ditampilkan — drawer pun tidak perlu, kartu workspace di
          halamannya sendiri yang jadi navigasi. */}
      {!onPortal && mobileOpen && (
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`} style={division.accent.cssVar || undefined}>
        {/* Brand + toggle collapse */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <span className="sidebar-brand-inner">
              <img src="/logo-small.png" alt="Logo" style={{ width: 20, height: 20, objectFit: "contain" }} />
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-brand-name">{BRAND.name}</div>
            <div className="sidebar-brand-sub">{BRAND.subtitle}</div>
          </div>
          {/* Tombol tutup — sidebar ini SEKARANG cuma drawer mobile (lihat
              catatan render-nya di atas), jadi tidak ada lagi "tombol
              collapse desktop" — cuma satu cara menutupnya. */}
          <button className="sidebar-close-mobile" onClick={closeMobileMenu} title="Tutup">
            <X size={16} />
          </button>
        </div>

        {/* Badge divisi + ganti divisi (1 Agustus 2026) — sidebar sekarang
            berbeda per divisi (lihat DIVISIONS di atas); badge ini yang
            memberi tahu SEDANG di divisi mana, dan jadi jalan pintas balik
            ke Portal untuk ganti divisi tanpa lewat menu profil. Warna dot
            & teks pakai aksen divisi (satu sumber dengan Portal.jsx). */}
        <button
          type="button"
          onClick={() => navigate("/portal")}
          title="Ganti divisi"
          className="mx-3 mb-2 flex items-center gap-2 rounded-btn px-2.5 py-2 text-left transition-colors hover:bg-hovertint"
        >
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", division.accent.bg)}>
            <DivisionIcon className={cn("h-3.5 w-3.5", division.accent.text)} strokeWidth={2} />
          </span>
          <span className={cn("min-w-0 flex-1 truncate text-[12px] font-semibold", division.accent.text)}>
            {division.label}
          </span>
          <Grid3x3 size={13} className="shrink-0 text-ink3" />
        </button>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {/* LayoutGroup: pill aktif geser mulus antar item (layoutId). Data nav,
              role gating, dan kondisi badge unread TIDAK berubah — cuma sumbernya
              sekarang `division.sections`, bukan array statis tunggal. */}
          <LayoutGroup>
          {division.sections.map(({ section, adminOnly, items }) => {
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
            divisi Growth (Bengkel/Armada/Kendali tidak punya co-pilot sendiri
            saat ini). */}
        {divisionKey === "growth" && <SidebarPromo />}

        {/* User footer — blok profil sekaligus trigger menu akun (Radix Menu).
            onLogout = handler logout yang SUDAH ADA (tidak diubah), dipanggil
            dari item "Keluar". Tidak menyentuh state/flow autentikasi. */}
        <div className="sidebar-footer">
          <Menu
            align="start"
            trigger={
              <button className="sidebar-profile" type="button" title="Menu akun">
                <div className="avatar avatar-sm sidebar-avatar">
                  {(user.name || "?")[0].toUpperCase()}
                </div>
                <div className="sidebar-user-info">
                  <div className="sidebar-user-name">{user.name}</div>
                  <span className={`role-badge ${roleLower}`}>{displayRole}</span>
                </div>
                <MoreVertical size={15} className="sidebar-kebab-ic" />
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
        <div className="sidebar-version" title={typeof __BUILD_TIME__ !== "undefined" ? new Date(__BUILD_TIME__).toLocaleString("id-ID") : undefined}>
          v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}
        </div>
      </aside>
      )}

      <main className="app-content">
        {/* showMobileMenu=false di /portal: drawer-nya memang tidak dirender
            di sana, jadi tombol hamburger hanya akan jadi kontrol mati. */}
        <Topbar
          onToggleMobileMenu={() => setMobileOpen((v) => !v)}
          showMobileMenu={!onPortal}
          unreadCount={unreadCount}
          user={user}
          onLogout={onLogout}
        />

        {/* Nav horizontal — dulu cuma untuk divisi NON-Growth, SEKARANG untuk
            SEMUA divisi (lihat catatan di sidebar drawer di atas: ini yang
            menggantikan sidebar lebar Growth yang dicabut dari desktop).
            Tanpa ini, halaman operasional (Inbox/Pelanggan/Pipeline/dst)
            tidak akan terjangkau sama sekali dari desktop selain lewat
            command center — bukan sekadar ubah tampilan.
            Growth py ~13 item (jauh lebih banyak dari divisi lain yang cuma
            1-3) — makanya container INI overflow-x-auto + item shrink-0,
            supaya scroll ke samping alih-alih baris kedua yang mendorong
            konten turun tak terduga. */}
        {!onPortal && (() => {
          const items = division.sections
            .filter((s) => !s.adminOnly || isAdmin)
            .flatMap((s) => s.items)
            .filter((it) => !it.adminOnly || isAdmin);
          if (items.length < 2) return null;
          return (
            <div className="hidden items-center gap-1.5 overflow-x-auto border-b border-[#DEE5EF] bg-white px-7 py-2.5 [scrollbar-width:none] lg:flex [&::-webkit-scrollbar]:hidden">
              {items.map(({ to, label, Icon, badge }) => {
                const active = location.pathname.startsWith(to);
                const showBadge = !!(badge && unreadCount > 0);
                return (
                  <button
                    key={to}
                    type="button"
                    onClick={() => navigate(to)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-[11px] px-3 py-1.5 text-[12px] font-bold transition-colors",
                      active
                        ? "bg-[#E8F0FF] text-[#1457D9]"
                        : "text-[#6E7E96] hover:bg-[#F4F7FF] hover:text-[#1457D9]"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} /> {label}
                    {showBadge && (
                      <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red px-1 text-[9px] font-extrabold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Transisi antar halaman (catatan Gilang 1 Agustus 2026: "animasi
            setiap perpindahan agar lebih smooth"). Di-key oleh pathname —
            AnimatePresence mendeteksi route berganti dari situ, bukan dari
            `children` berubah identitas (yang selalu berubah tiap render).
            mode="wait": halaman lama selesai fade-out DULU baru yang baru
            fade-in — mode default ("sync") akan tumpang tindih sesaat dan
            terlihat "kedip" karena kedua halaman punya latar putih penuh.
            Durasi 160ms konsisten dengan pill aktif sidebar (SidebarLink,
            180ms) — motion Sano dipatok 150–200ms, jangan lebih lambat. */}
        <div className="page-body">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
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
