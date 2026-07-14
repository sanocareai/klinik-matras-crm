import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Menu as MenuIcon, Search, ChevronDown, LogOut } from "lucide-react";
import { formatTanggalIndo, getInitials } from "../utils/format.js";
import { CommandPalette } from "@/components/ui/command-palette.jsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";

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

// Wave 1.1: search dominan + profil chip. Aliran unreadCount (prop dari Layout),
// navigasi bell → /inbox, dan onToggleMobileMenu TIDAK diubah. `user`/`onLogout`
// adalah prop aditif (onLogout = handler yang sudah ada; TIDAK mengubah
// state/flow autentikasi).
export default function Topbar({ onToggleMobileMenu, unreadCount = 0, user, onLogout }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const crumbs = ROUTE_LABELS[pathname] || [pathname.replace("/", "")];

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
      {/* Kiri: hamburger (mobile) + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onToggleMobileMenu}
          title="Buka menu"
          aria-label="Buka menu"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 md:hidden"
        >
          <MenuIcon size={20} />
        </button>
        <nav className="flex min-w-0 items-center gap-1 text-[13.5px]">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-slate-300" />}
              <span
                className={
                  i === crumbs.length - 1
                    ? "truncate font-semibold text-slate-900"
                    : "hidden truncate text-slate-400 sm:inline"
                }
              >
                {c}
              </span>
            </React.Fragment>
          ))}
        </nav>
      </div>

      {/* Tengah: search ⌘K dominan (buka command palette) */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="ml-1 hidden h-10 max-w-[380px] flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-[13px] text-slate-400 transition-colors hover:border-slate-300 hover:bg-white sm:flex"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 truncate text-left">Cari pelanggan, percakapan, halaman…</span>
        <kbd className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
          ⌘K
        </kbd>
      </button>

      {/* Kanan: search mobile + tanggal + notif + profil */}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={() => setPaletteOpen(true)}
          aria-label="Cari"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 sm:hidden"
        >
          <Search size={18} />
        </button>

        <span className="hidden text-[13px] text-slate-400 lg:block">{formatTanggalIndo()}</span>

        <button
          onClick={() => navigate("/inbox")}
          title={unreadCount > 0 ? `${unreadCount} pesan belum dibaca` : "Notifikasi"}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-transform hover:bg-slate-100 active:scale-95"
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-chart-rose px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {user && (
          <>
            <span className="mx-0.5 hidden h-6 w-px bg-slate-200 sm:block" />
            <Menu
              align="end"
              trigger={
                <button
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 transition-colors hover:bg-slate-100 md:pr-2.5"
                  title="Menu akun"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-[12px] font-bold text-white">
                    {getInitials(user.name)}
                  </span>
                  <span className="hidden max-w-[120px] truncate text-[13px] font-semibold text-slate-700 md:block">
                    {user.name?.split(" ")[0]}
                  </span>
                  <ChevronDown size={14} className="hidden text-slate-400 md:block" />
                </button>
              }
            >
              <MenuLabel>{user.name}</MenuLabel>
              <MenuSeparator />
              <MenuItem icon={LogOut} destructive onSelect={onLogout}>
                Keluar
              </MenuItem>
            </Menu>
          </>
        )}
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
