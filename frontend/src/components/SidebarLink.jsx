import React from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";

// Item navigasi sidebar (presentational). Diekstrak dari Layout HANYA untuk
// keperluan layout/visual — data nav, role gating, dan route TETAP dikelola
// Layout. Indikator aktif "pill" geser halus antar item via layoutId
// (framer-motion), durasi ~180ms sesuai batas motion Sano (150–200ms).
export default function SidebarLink({
  to,
  label,
  Icon,
  isAI = false,
  showBadge = false,
  badgeCount = 0,
  collapsed = false,
  onNavigate,
}) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        "sidebar-link" + (isActive ? " active" : "") + (collapsed ? " collapsed" : "")
      }
    >
      {({ isActive }) => (
        <>
          {/* Pill latar item aktif — geser antar item. z-index di bawah konten. */}
          {isActive && (
            <motion.span
              layoutId="sidebarActivePill"
              className="nav-pill"
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              aria-hidden="true"
            />
          )}
          <Icon size={17} className={"nav-icon" + (isAI ? " nav-icon-ai" : "")} />
          {!collapsed && <span className="nav-label">{label}</span>}
          {isAI && !collapsed && !showBadge && (
            <span className="nav-ai-dot" aria-hidden="true" />
          )}
          {showBadge && (
            <span className="nav-badge">{badgeCount > 99 ? "99+" : badgeCount}</span>
          )}
        </>
      )}
    </NavLink>
  );
}
