import React from "react";
import { useLocation } from "react-router-dom";
import { Bell, ChevronRight } from "lucide-react";
import { formatTanggalIndo } from "../utils/format.js";

const ROUTE_LABELS = {
  "/dashboard":   ["Dashboard"],
  "/inbox":       ["Operasional", "Inbox"],
  "/customers":   ["Data", "Pelanggan"],
  "/pipeline":    ["Data", "Pipeline"],
  "/broadcast":   ["Outreach", "Broadcast & Campaign"],
  "/laporan":     ["Analitik", "Laporan"],
  "/automation":  ["AI & Otomasi", "Otomasi"],
  "/pengaturan":  ["Pengaturan"],
  "/pengguna":    ["Pengaturan", "Pengguna & Peran"],
};

export default function Topbar() {
  const { pathname } = useLocation();
  const crumbs = ROUTE_LABELS[pathname] || [pathname.replace("/", "")];

  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={13} style={{ color: "#d1d5db" }} />}
            <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-right">
        <span className="topbar-date">{formatTanggalIndo()}</span>
        <button className="topbar-notif" title="Notifikasi">
          <Bell size={16} />
        </button>
      </div>
    </div>
  );
}
