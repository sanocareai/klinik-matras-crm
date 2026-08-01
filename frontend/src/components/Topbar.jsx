import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Menu as MenuIcon, Search, ChevronDown, LogOut } from "lucide-react";
import { formatTanggalIndo, getInitials } from "../utils/format.js";
import { CommandPalette } from "@/components/ui/command-palette.jsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { DIVISION_CONTENT } from "@/features/portal/divisionContent.js";

const ROUTE_LABELS = {
  // Tanpa entri ini breadcrumb jatuh ke fallback `pathname.replace("/","")`
  // dan menampilkan "portal" huruf kecil apa adanya.
  "/portal":      ["Main Hub"],
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
// showMobileMenu: tombol hamburger disembunyikan di halaman yang memang tidak
// punya drawer sidebar (saat ini: /portal). Default true supaya semua pemanggil
// lama berperilaku persis seperti sebelumnya.
export default function Topbar({ onToggleMobileMenu, showMobileMenu = true, unreadCount = 0, user, onLogout }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // /portal/:key (command center) py key DINAMIS, tidak bisa didaftar satu-
  // satu di ROUTE_LABELS statis seperti path lain — dicocokkan terpisah di
  // sini, dengan judul divisi ASLI (bukan slug key mentah seperti "bengkel").
  const commandCenterKey = /^\/portal\/([^/]+)/.exec(pathname)?.[1];
  const commandCenterTitle = commandCenterKey && DIVISION_CONTENT[commandCenterKey]?.title;
  const crumbs = commandCenterTitle
    ? ["Main Hub", commandCenterTitle]
    : ROUTE_LABELS[pathname] || [pathname.replace("/", "")];

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-6">
      {/* Kiri: hamburger (mobile) + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        {showMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            title="Buka menu"
            aria-label="Buka menu"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink2 transition-colors hover:bg-hovertint md:hidden"
          >
            <MenuIcon size={20} />
          </button>
        )}
        <nav className="flex min-w-0 items-center gap-1 text-[13.5px]">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink3" />}
              <span
                className={
                  i === crumbs.length - 1
                    ? "truncate font-semibold text-ink"
                    : "hidden truncate text-ink3 sm:inline"
                }
              >
                {c}
              </span>
            </React.Fragment>
          ))}
        </nav>
      </div>

      {/* Tengah: SATU tombol cari, ikon-saja secara default, MELEBAR jadi pil
          teks penuh saat hover/fokus (bukan dua elemen terpisah per breakpoint
          seperti sebelumnya — di sana ada pil desktop `sm:flex` + ikon mobile
          `sm:hidden`; kalau breakpoint-nya tumpang-tindih di lebar tertentu,
          dua-duanya kelihatan sekaligus, persis yang dilaporkan di tangkapan
          layar produksi). Klik selalu membuka CommandPalette — modal itu
          SENDIRI sudah "search bar yang muncul saat ikon diklik" yang diminta.
          `group` + transisi width/opacity CSS murni, tanpa JS animasi tambahan. */}
      <button
        onClick={() => setPaletteOpen(true)}
        aria-label="Cari pelanggan, percakapan, halaman"
        // w-10 tetap (ikon saja) SAMPAI hover/fokus — sengaja BUKAN "flex-1",
        // karena flex-1 (flex-basis:0%) akan membuatnya selalu melebar penuh
        // di layar ≥sm terlepas dari hover, meniadakan efek "expand on click"
        // yang diminta. Target lebar FIXED (320px), bukan w-full, supaya
        // tidak butuh flex-basis dari parent untuk resolve.
        className="group ml-1 flex h-10 w-10 shrink-0 items-center gap-2.5 overflow-hidden rounded-xl bg-inset px-2.5 text-ink3 transition-[width,background-color] duration-200 ease-out hover:w-[320px] hover:bg-surface hover:px-3.5 focus-visible:w-[320px] focus-visible:bg-surface focus-visible:px-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Search size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left text-[13px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          Cari pelanggan, percakapan, halaman…
        </span>
        <kbd className="hidden shrink-0 rounded bg-inset px-1.5 py-0.5 text-[10px] font-semibold text-ink3 group-hover:inline-block group-focus-visible:inline-block">
          ⌘K
        </kbd>
      </button>

      {/* Kanan: tanggal + notif + profil */}
      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden text-[13px] text-ink3 lg:block">{formatTanggalIndo()}</span>

        <button
          onClick={() => navigate("/inbox")}
          title={unreadCount > 0 ? `${unreadCount} pesan belum dibaca` : "Notifikasi"}
          aria-label="Notifikasi"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink2 transition-transform hover:bg-hovertint active:scale-95"
        >
          <Bell size={17} />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {user && (
          <>
            <span className="mx-0.5 hidden h-6 w-px bg-line sm:block" />
            <Menu
              align="end"
              trigger={
                <button
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 transition-colors hover:bg-hovertint md:pr-2.5"
                  title="Menu akun"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">
                    {getInitials(user.name)}
                  </span>
                  <span className="hidden max-w-[120px] truncate text-[13px] font-semibold text-ink md:block">
                    {user.name?.split(" ")[0]}
                  </span>
                  <ChevronDown size={14} className="hidden text-ink3 md:block" />
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
