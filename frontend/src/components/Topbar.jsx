import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import { formatTanggalIndo } from "../utils/format.js";
import { CommandPalette } from "@/components/ui/command-palette.jsx";

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

// Wave 1: reskin visual + entry ⌘K (persiapan UI). Aliran unreadCount (prop dari
// Layout), navigasi bell → /inbox, dan onToggleMobileMenu TIDAK diubah.
export default function Topbar({ onToggleMobileMenu, unreadCount = 0 }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const crumbs = ROUTE_LABELS[pathname] || [pathname.replace("/", "")];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
      {/* Kiri: hamburger (mobile) + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onToggleMobileMenu}
          title="Buka menu"
          aria-label="Buka menu"
          className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
        >
          <Menu size={20} />
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

      {/* Kanan: search ⌘K + tanggal + notifikasi */}
      <div className="flex items-center gap-2">
        {/* Entry ⌘K — pill di layar lebar */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-500 sm:flex"
        >
          <Search size={15} />
          <span>Cari…</span>
          <kbd className="ml-2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
            ⌘K
          </kbd>
        </button>
        {/* Entry ⌘K — ikon saja di mobile */}
        <button
          onClick={() => setPaletteOpen(true)}
          aria-label="Cari"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:hidden"
        >
          <Search size={18} />
        </button>

        <span className="hidden text-[13px] text-slate-400 lg:block">{formatTanggalIndo()}</span>

        <button
          onClick={() => navigate("/inbox")}
          title={unreadCount > 0 ? `${unreadCount} pesan belum dibaca` : "Notifikasi"}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-chart-rose px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
