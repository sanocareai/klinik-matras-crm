import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Users, GitBranch,
  Megaphone, BarChart3, Zap, Settings, UserCog,
  LogOut, BedDouble, Package, ChevronLeft, ChevronRight, X, Link2,
} from "lucide-react";
import { api } from "../api.js";
import Topbar from "./Topbar.jsx";

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
    adminOnly: true,
    items: [
      { to: "/automation", label: "Otomasi", Icon: Zap },
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

export default function Layout({ user, onLogout, children }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [collapsed, setCollapsed]     = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true"
  );
  const [mobileOpen, setMobileOpen]   = useState(false);

  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    async function fetchUnread() {
      try {
        const { count } = await api.getUnreadCount();
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
      {/* Backdrop untuk mobile sidebar */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={closeMobileMenu} />
      )}

      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        {/* Brand + toggle collapse */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <BedDouble size={18} />
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
        <Topbar onToggleMobileMenu={() => setMobileOpen((v) => !v)} />
        <div className="page-body">
          {children}
        </div>
      </main>
    </div>
  );
}
