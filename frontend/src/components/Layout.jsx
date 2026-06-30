import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Users, GitBranch,
  Megaphone, BarChart3, Zap, Settings, UserCog,
  LogOut, BedDouble,
} from "lucide-react";
import { api } from "../api.js";
import Topbar from "./Topbar.jsx";

// Seksi sidebar: { section, items: [{to, label, Icon, badge?, adminOnly?}] }
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
      { to: "/customers", label: "Pelanggan",   Icon: Users },
      { to: "/pipeline",  label: "Pipeline",    Icon: GitBranch },
    ],
  },
  {
    section: "OUTREACH",
    items: [
      { to: "/broadcast", label: "Broadcast & Campaign", Icon: Megaphone },
    ],
  },
  {
    section: "ANALITIK",
    items: [
      { to: "/laporan", label: "Laporan", Icon: BarChart3 },
    ],
  },
  {
    section: "AI & OTOMASI",
    items: [
      { to: "/automation", label: "Otomasi", Icon: Zap },
    ],
  },
  {
    section: "PENGATURAN",
    adminOnly: true,
    items: [
      { to: "/pengaturan", label: "Pengaturan",      Icon: Settings, adminOnly: true },
      { to: "/pengguna",   label: "Pengguna & Peran", Icon: UserCog, adminOnly: true },
    ],
  },
];

export default function Layout({ user, onLogout, children }) {
  const [openCount, setOpenCount] = useState(0);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    async function fetchUnread() {
      try {
        const { count } = await api.getUnreadCount();
        setOpenCount(count);
      } catch {}
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, []);

  const roleLower = (user.role || "SALES").toLowerCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <BedDouble size={18} />
          </div>
          <div>
            <div className="sidebar-brand-name">Klinik Matras</div>
            <div className="sidebar-brand-sub">Omnichannel CRM</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_SECTIONS.map(({ section, adminOnly, items }) => {
            if (adminOnly && !isAdmin) return null;
            return (
              <div key={section} className="nav-section">
                <div className="sidebar-section-label">{section}</div>
                {items.map(({ to, label, Icon, badge, adminOnly: itemAdmin }) => {
                  if (itemAdmin && !isAdmin) return null;
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}
                    >
                      <Icon size={17} className="nav-icon" />
                      {label}
                      {badge && openCount > 0 && (
                        <span className="nav-badge">{openCount > 99 ? "99+" : openCount}</span>
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
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <span className={`role-badge ${roleLower}`}>{user.role}</span>
          </div>
          <button className="sidebar-logout-btn" onClick={onLogout} title="Keluar">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="app-content">
        <Topbar />
        <div className="page-body">
          {children}
        </div>
      </main>
    </div>
  );
}
