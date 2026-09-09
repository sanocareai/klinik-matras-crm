import React, { useState } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { SquareArrowOutUpRight, AppWindow, Link2, Check } from "lucide-react";

// Item navigasi sidebar (presentational). Diekstrak dari Layout HANYA untuk
// keperluan layout/visual — data nav, role gating, dan route TETAP dikelola
// Layout. Indikator aktif "pill" geser halus antar item via layoutId
// (framer-motion), durasi ~180ms sesuai batas motion Sano (150–200ms).
//
// D-142 (9 September 2026, permintaan owner: "build workspace SANSS
// seperti Notion — bisa buka tab baru, jendela baru, dst") — item ini
// SUDAH `<NavLink>` (anchor `<a href>` sungguhan, bukan `<button onClick>`),
// jadi Ctrl+klik/klik-tengah SEBENARNYA sudah membuka tab baru dari dulu —
// tapi itu tersembunyi total, tidak ada cara TEMUKAN fitur itu tanpa sudah
// tahu shortcut keyboard/mouse-nya, dan "buka jendela baru sungguhan"
// (bukan cuma tab) tidak ada jalannya sama sekali sebelum ini. Klik-kanan
// sekarang membuka menu kecil — pola SAMA PERSIS dengan menu Sematkan di
// ConversationItem.jsx (Inbox), termasuk kelas CSS `.conv-context-menu`/
// `.conv-context-backdrop` yang DIPAKAI ULANG apa adanya (sudah generik:
// kartu kaca kecil + backdrop klik-luar, dipakai juga oleh
// TransferPickerPopover.jsx — bukan sesuatu yang khusus Inbox walau
// namanya begitu) — bukan menulis resep menu kedua yang bisa drift.
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
  const [menu, setMenu] = useState(null); // { x, y }
  const [copied, setCopied] = useState(false);

  function fullUrl() {
    return `${window.location.origin}${to}`;
  }

  function handleContextMenu(e) {
    e.preventDefault();
    const safeX = Math.min(e.clientX, window.innerWidth - 210);
    const safeY = Math.min(e.clientY, window.innerHeight - 150);
    setMenu({ x: safeX, y: safeY });
  }

  function bukaTabBaru() {
    window.open(fullUrl(), "_blank", "noopener");
    setMenu(null);
  }

  // `width`/`height` di argumen ketiga window.open() — sinyal ke browser
  // supaya ini dibuka sebagai JENDELA terpisah (popup), bukan tab baru di
  // window yang sama. Ukuran 1280×860 dipilih supaya halaman CRM (tabel/
  // drawer lebar) tetap wajar dipakai, bukan jendela sempit yang malah
  // memotong layout.
  function bukaJendelaBaru() {
    window.open(fullUrl(), "_blank", "noopener,width=1280,height=860");
    setMenu(null);
  }

  function salinTautan() {
    navigator.clipboard?.writeText(fullUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
    setMenu(null);
  }

  return (
    <>
      <NavLink
        to={to}
        title={collapsed ? label : undefined}
        onClick={onNavigate}
        onContextMenu={handleContextMenu}
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
            {collapsed ? (
              // Tooltip saat sidebar menyempit (72px): tanpa ini item nav jadi
              // deretan ikon tanpa nama. `title` di NavLink saja tidak cukup —
              // tooltip bawaan browser lambat muncul (±1 detik) dan tidak
              // terbaca screen reader sebagai label item.
              <span className="nav-tooltip" role="tooltip">{label}</span>
            ) : (
              <span className="nav-label">{label}</span>
            )}
            {isAI && !collapsed && !showBadge && (
              <span className="nav-ai-dot" aria-hidden="true" />
            )}
            {showBadge && (
              <span className="nav-badge">{badgeCount > 99 ? "99+" : badgeCount}</span>
            )}
          </>
        )}
      </NavLink>

      {/* D-142 — di-portal ke document.body (bukan inline di dalam
          NavLink) supaya TIDAK ikut terjebak transform/stacking-context
          leluhur mana pun (pelajaran yang sama dengan bug peek-preview
          Inbox musim ini — lihat catatan panjang di
          ConversationItem.jsx). */}
      {menu && createPortal(
        <>
          <div
            className="conv-context-backdrop"
            onClick={(e) => { e.stopPropagation(); setMenu(null); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(null); }}
          />
          <div className="conv-context-menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); bukaTabBaru(); }}>
              <SquareArrowOutUpRight size={14} style={{ color: "#2563eb" }} />
              Buka di Tab Baru
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); bukaJendelaBaru(); }}>
              <AppWindow size={14} style={{ color: "#2563eb" }} />
              Buka di Jendela Baru
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); salinTautan(); }}>
              {copied ? <Check size={14} style={{ color: "#16a34a" }} /> : <Link2 size={14} style={{ color: "#7c3aed" }} />}
              {copied ? "Tautan disalin" : "Salin Tautan"}
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
