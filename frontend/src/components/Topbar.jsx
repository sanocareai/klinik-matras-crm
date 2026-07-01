import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Menu } from "lucide-react";
import { formatTanggalIndo } from "../utils/format.js";

const ROUTE_LABELS = {
  "/dashboard":   ["Dashboard"],
  "/inbox":       ["Operasional", "Inbox"],
  "/customers":   ["Data", "Pelanggan"],
  "/pipeline":    ["Data", "Pipeline"],
  "/products":    ["Data", "Galeri Produk"],
  "/broadcast":   ["Outreach", "Broadcast & Campaign"],
  "/laporan":     ["Analitik", "Laporan"],
  "/automation":  ["AI & Otomasi", "Otomasi"],
  "/pengaturan":  ["Pengaturan"],
  "/pengguna":    ["Pengaturan", "Pengguna & Peran"],
};

export default function Topbar({ onToggleMobileMenu, unreadCount = 0 }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const crumbs = ROUTE_LABELS[pathname] || [pathname.replace("/", "")];

  return (
    <div className="topbar">
      <div className="topbar-left">
        {/* Hamburger hanya tampil di mobile */}
        <button
          className="topbar-hamburger"
          onClick={onToggleMobileMenu}
          title="Buka menu"
        >
          <Menu size={20} />
        </button>
        <div className="topbar-breadcrumb">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={13} style={{ color: "#d1d5db" }} />}
              <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="topbar-right">
        <span className="topbar-date">{formatTanggalIndo()}</span>
        <button
          className="topbar-notif"
          title={unreadCount > 0 ? `${unreadCount} pesan belum dibaca` : "Notifikasi"}
          onClick={() => navigate("/inbox")}
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="topbar-notif-badge">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
