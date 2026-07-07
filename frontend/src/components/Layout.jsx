import React, { useEffect, useState, useRef } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Users, GitBranch,
  Megaphone, BarChart3, Zap, Settings, UserCog,
  LogOut, Package, ChevronLeft, ChevronRight, X, Link2, Sparkles,
} from "lucide-react";
import { api } from "../api.js";
import Topbar from "./Topbar.jsx";
import ToastNotif from "./ToastNotif.jsx";

// Seksi sidebar — adminOnly di level section = sembunyikan seluruh seksi untuk SALES
const NAV_SECTIONS = [
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
    section: "PENGATURAN",
    adminOnly: true,
    items: [
      { to: "/pengaturan", label: "Pengaturan",       Icon: Settings },
      { to: "/pengguna",   label: "Pengguna & Peran", Icon: UserCog },
    ],
  },
];

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [toast, setToast]             = useState(null); // { customerName, preview, conversationId }
  const [collapsed, setCollapsed]     = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true"
  );
  const [mobileOpen, setMobileOpen]   = useState(false);
  const prevUnread = useRef(null); // null = belum ada data awal
  const lastSeenAt = useRef(new Date().toISOString()); // timestamp polling terakhir

  const isAdmin = user?.role === "ADMIN";

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
    new Notification("Klinik Matras CRM", {
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
    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
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

      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        {/* Brand + toggle collapse */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <img src="/logo-small.png" alt="Logo" style={{ width: 22, height: 22, objectFit: "contain" }} />
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sidebar-brand-name">Klinik Matras</div>
              <div className="sidebar-brand-sub">Omnichannel CRM</div>
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

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_SECTIONS.map(({ section, adminOnly, items }) => {
            if (adminOnly && !isAdmin) return null;
            return (
              <div key={section} className="nav-section">
                {!collapsed && (
                  <div className="sidebar-section-label">{section}</div>
                )}
                {items.map(({ to, label, Icon, badge, adminOnly: itemAdmin }) => {
                  if (itemAdmin && !isAdmin) return null;
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}
                      onClick={closeMobileMenu}
                    >
                      <Icon size={17} className="nav-icon" />
                      {!collapsed && <span className="nav-label">{label}</span>}
                      {badge && unreadCount > 0 && (
                        <span className="nav-badge">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="sidebar-footer">
          <div style={{ flexShrink: 0 }}>
            <div
              className="avatar avatar-sm"
              style={{ background: "rgba(37,99,235,0.25)", color: "#60a5fa", fontWeight: 700 }}
            >
              {(user.name || "?")[0].toUpperCase()}
            </div>
          </div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.name}</div>
              <span className={`role-badge ${roleLower}`}>{user.role}</span>
            </div>
          )}
          <button className="sidebar-logout-btn" onClick={onLogout} title="Keluar">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="app-content">
        <Topbar onToggleMobileMenu={() => setMobileOpen((v) => !v)} unreadCount={unreadCount} />
        <div className="page-body">
          {children}
        </div>
      </main>
    </div>
  );
}
