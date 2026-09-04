import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronRight, Menu as MenuIcon, Search, ChevronDown, LogOut } from "lucide-react";
import { formatTanggalIndo } from "../utils/format.js";
import { CommandPalette } from "@/components/ui/command-palette.jsx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { DIVISION_CONTENT } from "@/features/portal/divisionContent.js";
import { useNotificationStore, badgeText } from "@/features/notifications/notificationStore.js";
import Avatar from "./Avatar.jsx";

const ROUTE_LABELS = {
  // Tanpa entri ini breadcrumb jatuh ke fallback `pathname.replace("/","")`
  // dan menampilkan "portal" huruf kecil apa adanya.
  "/portal":      ["Main Hub"],
  "/dashboard":   ["Dashboard"],
  // "Operasional" DIHAPUS dari sini (30 Agustus 2026) — remah 2-level
  // seperti workspace lain ("Data > Pelanggan") masuk akal kalau remah
  // pertamanya dipakai untuk PINDAH ke workspace lain, tapi Inbox sudah
  // sendirian di section "OPERASIONAL" sidebar (lihat DIVISIONS.growth di
  // Layout.jsx) — tidak ada workspace "Operasional" LAIN untuk dituju, jadi
  // remah itu cuma teks statis tanpa tujuan. Kalau nanti section itu
  // tumbuh isinya, breadcrumb 2-level bisa dikembalikan.
  "/inbox":       ["Inbox"],
  "/customers":   ["Data", "Pelanggan"],
  "/pipeline":    ["Data", "Pipeline"],
  "/products":    ["Data", "Galeri Produk"],
  "/broadcast":   ["Outreach", "Broadcast & Campaign"],
  "/laporan":     ["Analitik", "Laporan"],
  "/automation":  ["AI & Otomasi", "Otomasi"],
  "/pengaturan":  ["Pengaturan"],
  "/pengguna":    ["Pengaturan", "Pengguna & Peran"],

  // Delivery & Fulfillment (Tahap 1). Remah pertama "Delivery" bukan link ke
  // sub-halaman mana pun — ia label divisi; remah pertama yang jadi tautan
  // ke Main Hub ditangani logika `arr.length > 1` di bawah.
  "/armada/dashboard": ["Delivery", "Dashboard"],
  "/armada/jobs":      ["Delivery", "Jadwal & Penugasan"],
  "/armada/routes":    ["Delivery", "Route Planner"],
  "/armada/tracking":  ["Delivery", "Live Tracking"],
  "/armada/resources": ["Delivery", "Driver & Armada"],
  "/armada/pod":       ["Delivery", "Proof of Delivery"],
  "/armada/issues":    ["Delivery", "Kendala & Reschedule"],
  "/armada/returns":   ["Delivery", "Retur"],
  "/armada/reports":   ["Delivery", "Laporan"],
  // Notification Center berdiri di atas semua workspace, seperti Main Hub —
  // jadi remahnya tunggal, tidak bersarang di bawah divisi mana pun.
  "/notifications": ["Notifikasi"],
};

// Wave 1.1: search dominan + profil chip.
//
// ⚠️ prop `unreadCount` SUDAH DIHAPUS dari komponen ini (2 Agustus 2026).
// Dulu dipakai badge lonceng — dan itu justru bug-nya: angka unread Inbox
// Sales CRM dipakai sebagai badge notifikasi GLOBAL. Sekarang badge membaca
// notificationStore. unreadCount Inbox TETAP HIDUP di Layout, dipakai badge
// menu "Inbox" di sidebar, tempat yang memang benar untuknya.
// showMobileMenu: tombol hamburger disembunyikan di halaman yang memang tidak
// punya drawer sidebar (saat ini: /portal). Default true supaya semua pemanggil
// lama berperilaku persis seperti sebelumnya.
export default function Topbar({ onToggleMobileMenu, showMobileMenu = true, user, onLogout }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Badge lonceng = notifikasi GLOBAL, bukan unread Inbox (#21/#22).
  const toggleDrawer = useNotificationStore((s) => s.toggleDrawer);
  const drawerOpen   = useNotificationStore((s) => s.drawerOpen);
  const notifUnread  = useNotificationStore((s) => s.notifications.filter((n) => !n.isRead).length);
  const notifBadge   = badgeText(notifUnread);
  // /portal/:key (command center) py key DINAMIS, tidak bisa didaftar satu-
  // satu di ROUTE_LABELS statis seperti path lain — dicocokkan terpisah di
  // sini, dengan judul divisi ASLI (bukan slug key mentah seperti "bengkel").
  const commandCenterKey = /^\/portal\/([^/]+)/.exec(pathname)?.[1];
  const commandCenterTitle = commandCenterKey && DIVISION_CONTENT[commandCenterKey]?.title;

  // Breadcrumb sebagai daftar objek, bukan string — sejak refactor navigasi
  // 2 Agustus 2026 remah "Main Hub" HARUS bisa diklik. `to` null = teks biasa.
  const crumbs = commandCenterTitle
    ? [{ text: "Main Hub", to: "/portal" }, { text: commandCenterTitle, to: null }]
    : (ROUTE_LABELS[pathname] || [pathname.replace("/", "")]).map((text, i, arr) => ({
        text,
        // Halaman di DALAM sebuah workspace: remah pertama jadi jalan pulang
        // ke Main Hub. Remah terakhir (halaman sekarang) tidak pernah link.
        to: i === 0 && arr.length > 1 ? "/portal" : null,
      }));

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur md:px-6">
      {/* Kiri: hamburger (mobile) + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        {showMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            title="Buka menu"
            aria-label="Buka menu"
            // KOREKSI KEDUA (30 Agustus 2026) — pindah dari `md:hidden` ke
            // class CSS murni di sini. ⚠️ Sesi yang sama sempat menulis di
            // sini bahwa akar masalahnya "TIDAK ADA satu pun variant
            // Tailwind yang ter-compile di project ini" — itu KELIRU, sudah
            // dikoreksi di CLAUDE.md §3 (ditemukan lewat grep bash yang
            // cacat escaping-nya; diverifikasi ulang byte-exact via Node,
            // `md:hidden` DKK TERBUKTI compile normal). Root cause ASLI
            // laporan owner ("tombol ini tidak berfungsi") jadi TIDAK
            // PERNAH benar-benar ketemu — keputusan pindah ke CSS murni di
            // sini dipertahankan karena TERBUKTI benar secara fungsional
            // (breakpoint 768px, sama dgn CSS drawer sidebar), bukan karena
            // teori Tailwind di atas.
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink2 transition-colors hover:bg-hovertint topbar-hamburger-btn"
          >
            <MenuIcon size={20} />
          </button>
        )}
        <nav className="flex min-w-0 items-center gap-1 text-[13.5px]">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-ink3" />}
              {c.to ? (
                <button
                  type="button"
                  onClick={() => navigate(c.to)}
                  className="hidden truncate rounded text-ink3 transition-colors hover:text-accent hover:underline sm:inline"
                >
                  {c.text}
                </button>
              ) : (
                <span
                  className={
                    i === crumbs.length - 1
                      ? "truncate font-semibold text-ink"
                      : "hidden truncate text-ink3 sm:inline"
                  }
                >
                  {c.text}
                </span>
              )}
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
        {/* `topbar-date` (D-051) — penanda supaya bisa disembunyikan
            per-divisi lewat CSS scoped (lihat styles/delivery-dark.css),
            TANPA mengubah tampilannya di divisi lain. */}
        <span className="topbar-date hidden text-[13px] text-ink3 lg:block">{formatTanggalIndo()}</span>

        {/* LONCENG — MEMBUKA DRAWER, TIDAK BERNAVIGASI (ketentuan #1/#2).
            Sebelum refactor 2 Agustus 2026 tombol ini `navigate("/inbox")`
            dan badge-nya memakai unread Inbox Sales CRM. Dua-duanya salah:
            lonceng jadi pintu kedua ke Inbox, dan kejadian dari Produksi/
            Gudang/Armada tidak pernah punya tempat sama sekali.
            Angkanya sekarang dari notificationStore — LINTAS workspace, dan
            TIDAK ADA hubungannya dengan unread Inbox (yang tetap punya badge
            sendiri di menu Inbox di sidebar). */}
        <button
          onClick={toggleDrawer}
          title={notifBadge ? `${notifBadge} notifikasi belum dibaca` : "Notifikasi"}
          aria-label={notifBadge ? `Notifikasi, ${notifBadge} belum dibaca` : "Notifikasi"}
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink2 transition-transform hover:bg-hovertint active:scale-95"
        >
          <Bell size={17} />
          {/* Aturan #23: null saat 0 → badge tidak dirender sama sekali.
              `topbar-notif-badge` (D-051) — dipakai delivery-dark.css untuk
              mengecilkan badge ini jadi titik polos di Delivery Hub (mockup
              tidak menampilkan angka). Angkanya TETAP ada di DOM (dan di
              aria-label tombol ini) — cuma disembunyikan visual, supaya
              screen reader tetap dapat info lengkap. */}
          {notifBadge && (
            <span className="topbar-notif-badge absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {notifBadge}
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
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  <span className="hidden max-w-[120px] truncate text-[13px] font-semibold text-ink md:block">
                    {user.name?.split(" ")[0]}
                  </span>
                  {/* `topbar-account-chevron` (D-051) — mockup Delivery cuma
                      avatar+nama, tanpa panah dropdown. Disembunyikan lewat
                      CSS scoped; menu tetap bisa dibuka (klik area yang sama),
                      cuma indikator visualnya yang hilang di Delivery Hub. */}
                  <ChevronDown size={14} className="topbar-account-chevron hidden text-ink3 md:block" />
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
