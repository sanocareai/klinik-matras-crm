import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Users, GitBranch, ClipboardList,
  Megaphone, BarChart3, Zap, Settings, UserCog,
  LogOut, Package, ChevronLeft, ChevronRight, X, Link2, Sparkles, MoreVertical,
  Wrench, Truck, Gauge, Grid3x3,
} from "lucide-react";
import { LayoutGroup } from "framer-motion";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import Topbar from "./Topbar.jsx";
import ToastNotif from "./ToastNotif.jsx";
import SidebarLink from "./SidebarLink.jsx";
import { BRAND } from "@/lib/brand.js";
import { isAdminUser } from "@/lib/roles.js";
import SidebarPromo from "@/features/settings/SidebarPromo.jsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { cn } from "@/lib/utils.js";

// ─── SIDEBAR PER DIVISI (1 Agustus 2026, Gilang) ─────────────────────────────
// SEBELUMNYA satu NAV_SECTIONS statis dipakai di SETIAP halaman — masuk ke
// Bengkel/Armada/Kendali tetap menampilkan menu CRM (Inbox/Pelanggan/
// Pipeline/dst), yang tidak relevan sama sekali di sana. Sekarang sidebar
// ditentukan dari PATH aktif (divisionFromPath di bawah) — pindah divisi =
// seluruh menu, warna aksen, dan badge di sidebar ikut berganti, bukan cuma
// konten halaman. Warna aksen per divisi SATU SUMBER dengan Portal.jsx
// (PORTAL_ACCENT) supaya kartu di halaman Portal dan sidebar di dalam
// divisinya terasa sistem yang sama, bukan dua skema warna berbeda.
const DIVISIONS = {
  growth: {
    label: "Growth",
    // Tanpa cssVar — default token (:root, tokens.css) sudah biru accent,
    // TIDAK di-override supaya identik persis dengan sebelumnya.
    accent: { text: "text-blue-600", bg: "bg-blue-50", dot: "bg-blue-600" },
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
    label: "Produksi & Bengkel",
    accent: {
      text: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-600",
      cssVar: { "--sidebar-accent": "#D97706", "--sidebar-accent-strong": "#B45309", "--sidebar-accent-bg": "rgba(217,119,6,0.10)" },
    },
    sections: [
      {
        section: "BENGKEL",
        items: [
          { to: "/bengkel", label: "Papan Produksi", Icon: ClipboardList },
          { to: "/gudang",  label: "Gudang",         Icon: Package },
        ],
      },
    ],
  },
  armada: {
    label: "Armada & Pengiriman",
    accent: {
      text: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-600",
      cssVar: { "--sidebar-accent": "#059669", "--sidebar-accent-strong": "#047857", "--sidebar-accent-bg": "rgba(5,150,105,0.10)" },
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
    label: "Kendali",
    accent: {
      text: "text-violet-600", bg: "bg-violet-50", dot: "bg-violet-600",
      cssVar: { "--sidebar-accent": "#7C3AED", "--sidebar-accent-strong": "#6D28D9", "--sidebar-accent-bg": "rgba(124,58,237,0.10)" },
    },
    sections: [
      {
        section: "KENDALI",
        items: [
          { to: "/kendali", label: "Ringkasan",  Icon: Gauge },
          { to: "/orders",  label: "Order",      Icon: ClipboardList },
          { to: "/laporan", label: "Laporan",    Icon: BarChart3, adminOnly: true },
        ],
      },
    ],
  },
};

const DIVISION_ICON = { growth: Users, bengkel: Wrench, armada: Truck, kendali: Gauge };

// Prefix path → kunci divisi. Path yang tidak cocok apa pun (termasuk
// /portal sendiri) jatuh ke "growth" sebagai default aman — itu perilaku
// LAMA (satu-satunya nav sebelum perubahan ini), jadi tidak ada regresi
// untuk halaman yang belum dipetakan eksplisit di sini.
function divisionFromPath(pathname) {
  if (pathname.startsWith("/bengkel") || pathname.startsWith("/gudang")) return "bengkel";
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
  const divisionKey = divisionFromPath(location.pathname);
  const division = DIVISIONS[divisionKey];
  const DivisionIcon = DIVISION_ICON[divisionKey];

  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast]             = useState(null); // { customerName, preview, conversationId }
  const [collapsed, setCollapsed]     = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true"
  );
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
    new Notification("Sano Hub", {
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

  function toggleCollapsed() {
    setCollapsed((v) => {
      localStorage.setItem("sidebar-collapsed", !v);
      return !v;
    });
  }

  function closeMobileMenu() {
    setMobileOpen(false);
  }

  const roleLower = (user.role || "SALES").toLowerCase();

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {/* Toast notifikasi pesan masuk */}
      <ToastNotif toast={toast} onClose={() => setToast(null)} />

      {/* Backdrop untuk mobile sidebar */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={closeMobileMenu} />
      )}

      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`} style={division.accent.cssVar || undefined}>
        {/* Brand + toggle collapse */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <span className="sidebar-brand-inner">
              <img src="/logo-small.png" alt="Logo" style={{ width: 20, height: 20, objectFit: "contain" }} />
            </span>
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sidebar-brand-name">{BRAND.name}</div>
              <div className="sidebar-brand-sub">{BRAND.subtitle}</div>
            </div>
          )}
          {/* Tombol tutup di mobile */}
          <button className="sidebar-close-mobile" onClick={closeMobileMenu} title="Tutup">
            <X size={16} />
          </button>
          {/* Tombol collapse di desktop */}
          <button
            className="sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? "Buka sidebar" : "Tutup sidebar"}
          >
            {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
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
          className={cn(
            "mx-3 mb-2 flex items-center gap-2 rounded-btn px-2.5 py-2 text-left transition-colors hover:bg-hovertint",
            collapsed && "justify-center px-0"
          )}
        >
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", division.accent.bg)}>
            <DivisionIcon className={cn("h-3.5 w-3.5", division.accent.text)} strokeWidth={2} />
          </span>
          {!collapsed && (
            <>
              <span className={cn("min-w-0 flex-1 truncate text-[12px] font-semibold", division.accent.text)}>
                {division.label}
              </span>
              <Grid3x3 size={13} className="shrink-0 text-ink3" />
            </>
          )}
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
                {!collapsed && (
                  <div className="sidebar-section-label">{section}</div>
                )}
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
            divisi Growth (Bengkel/Armada/Kendali tidak punya co-pilot sendiri
            saat ini). Disembunyikan saat collapsed (perilaku lama). */}
        {divisionKey === "growth" && <SidebarPromo collapsed={collapsed} />}

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
                {!collapsed && (
                  <div className="sidebar-user-info">
                    <div className="sidebar-user-name">{user.name}</div>
                    <span className={`role-badge ${roleLower}`}>{user.role}</span>
                  </div>
                )}
                {!collapsed && <MoreVertical size={15} className="sidebar-kebab-ic" />}
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
        <Topbar onToggleMobileMenu={() => setMobileOpen((v) => !v)} unreadCount={unreadCount} user={user} onLogout={onLogout} />
        <div className="page-body">
          {children}
        </div>
      </main>
    </div>
  );
}
