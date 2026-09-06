import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Package, Truck, Gauge, LayoutGrid, ChevronsUpDown, Check, ArrowUpDown, GripVertical } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { cn } from "@/lib/utils.js";
import { applyCustomOrder, getWorkspaceOrder, saveWorkspaceOrder } from "@/lib/sidebarOrder.js";

// Pemilih workspace di PUNCAK sidebar — satu-satunya kontrol untuk berpindah
// antar divisi (refactor navigasi 2 Agustus 2026).
//
// MENGGANTIKAN dua hal sekaligus: rail ikon 78px yang dulu berdiri sendiri di
// paling kiri, DAN tombol "badge divisi" di dalam sidebar yang juga melompat
// ke Main Hub. Sebelumnya ada empat jalan berbeda menuju Main Hub (logo rail,
// badge divisi, tombol "Back to hub" di halaman workspace, kartu di Portal) —
// itu yang membuat navigasinya terasa berlebihan. Sekarang tinggal tiga yang
// disengaja: logo, item "Main Hub" di sini, dan breadcrumb.
//
// Daftarnya HARUS cocok dengan PORTALS di backend/src/constants/permissions.js.
// Duplikasi kecil yang disengaja: sidebar perlu tahu daftarnya SEBELUM halaman
// mana pun sempat fetch, dan penegakan aksesnya tetap di backend.
// D-137 (6 September 2026, laporan owner: urutan default diminta jadi
// Sales CRM > Delivery & Fulfillment > Production Operations > Warehouse
// & Inventory Control > All Teams Dashboard) — ini urutan TAMPIL default
// (dipakai kalau user belum pernah menyusun ulang sendiri lewat drag-drop,
// lihat `customizing` di bawah). Urutan array di sini TIDAK berhubungan
// dengan urutan di PORTALS (backend/src/constants/permissions.js) — itu
// daftar hak akses, bukan urutan tampil.
export const WORKSPACES = [
  { key: "growth",    label: "Sales CRM & Omnichannel",    to: "/dashboard", Icon: Users,   roles: ["ADMIN", "SALES"] },
  { key: "armada",    label: "Delivery & Fulfillment",     to: "/armada",    Icon: Truck,   roles: ["ADMIN", "DISPATCHER", "DRIVER", "HELPER", "LEADER_DRIVER"] },
  { key: "bengkel",   label: "Production Operations",      to: "/bengkel",   Icon: Wrench,  roles: ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"] },
  { key: "warehouse", label: "Warehouse & Inventory Control", to: "/gudang", Icon: Package, roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_LEAD"] },
  { key: "kendali",   label: "All Teams Dashboard",        to: "/kendali",   Icon: Gauge,   roles: ["ADMIN", "FINANCE"] },
];

export const WORKSPACE_LABEL = Object.fromEntries(WORKSPACES.map((w) => [w.key, w.label]));

/**
 * @param activeKey  kunci divisi aktif, atau null saat di Main Hub
 * @param collapsed  sidebar sedang menyempit (72px) → tampilkan ikon saja
 */
export default function WorkspaceSwitcher({ activeKey, collapsed = false, userRoles = [], onNavigate }) {
  const navigate = useNavigate();
  const tersediaAsli = WORKSPACES.filter((w) => w.roles.some((r) => userRoles.includes(r)));

  // D-137 (6 September 2026, laporan owner: "buatkan skema urutan
  // workspace bisa di drag and drop, bebas naikkan keatas bawah") — urutan
  // custom dibaca dari localStorage (lihat lib/sidebarOrder.js), disimpan
  // di STATE (bukan dibaca ulang tiap render seperti pola SidebarNavSection
  // di Layout.jsx) karena komponen ini SENDIRI yang memilikinya penuh —
  // tidak ada leluhur lain yang perlu tahu urutannya berubah.
  const [order, setOrder] = useState(() => getWorkspaceOrder());
  const tersedia = applyCustomOrder(tersediaAsli, order);

  const [customizing, setCustomizing] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const aktif = WORKSPACES.find((w) => w.key === activeKey) || null;
  const ActiveIcon = aktif?.Icon || LayoutGrid;
  const judul = aktif?.label || "Main Hub";

  function pergi(to) {
    navigate(to);
    onNavigate?.();
  }

  function handleDrop(idx) {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = tersedia.slice();
    const [pindah] = next.splice(dragIdx, 1);
    next.splice(idx, 0, pindah);
    setDragIdx(null);
    setOverIdx(null);
    const orderedTos = next.map((w) => w.to);
    setOrder(orderedTos);
    saveWorkspaceOrder(orderedTos);
  }

  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          title={judul}
          aria-label={`Workspace aktif: ${judul}. Klik untuk berpindah.`}
          // BUG DITEMUKAN 30 Agustus 2026 (laporan owner: "ga mencok dengan
          // topbar") — `border border-border` di sini melanggar aturan
          // desain sendiri yang ditulis di styles/tokens.css bagian "SIDEBAR:
          // bersih & minimalis": "Border pada card/panel/badge/tombol
          // DILARANG... hierarki dari TONE PERMUKAAN + SPACING, BUKAN
          // border". Kontrol sidebar LAIN (sidebar-brand-icon,
          // sidebar-profile, sidebar-collapse-btn) semuanya SUDAH dibikin
          // transparan tanpa border di sapuan DS v2.2 (lihat tokens.css) —
          // tombol ini terlewat, jadi satu-satunya kotak berbingkai di
          // antara sidebar yang sudah rata/flat, kelihatan "mengambang"
          // sendiri. `bg-surface` (fill terisi) & `hover:bg-hovertint`
          // (variant Tailwind yang TIDAK ter-compile di project ini — lihat
          // CLAUDE.md §3 soal bug scanner Tailwind) diganti class
          // `.workspace-switcher-trigger` (CSS murni, sama pola dgn
          // .sidebar-profile di tokens.css) supaya benar-benar transparan
          // + hover jalan, bukan cuma "kelihatan seperti transparan tapi
          // sebenarnya diam-diam masih terisi".
          // D-125 KOREKSI (6 September 2026, laporan owner: "masih menyatu"
          // setelah `mt-1` 4px + blur diperkecil — TERNYATA belum cukup).
          // Dinaikkan ke `mt-3` (12px, 3x lipat) supaya jarak ke logo di
          // atasnya jelas TANPA AMBIGU, tidak cuma andalkan padding brand
          // yang gampang "ketutup" glow biru-nya.
          className={cn(
            "workspace-switcher-trigger mx-3 mt-3 mb-2 flex items-center gap-2.5 rounded-btn px-2.5 py-2 text-left transition-colors",
            collapsed && "mx-2 justify-center px-0"
          )}
        >
          {/* D-137 (laporan owner: "hilangkan block birunya") — `bg-blue-50
              text-blue-700` SEBELUMNYA warna literal Tailwind, dirancang
              untuk PERMUKAAN TERANG saja — di sidebar gelap tampil sebagai
              kotak biru pucat yang mencolok/salah tempat (tidak pernah
              beradaptasi ke tema gelap). Diganti token aksen tema-aware
              yang SUDAH dipakai pola sama di FilterDropdown.jsx (state
              aktif: `bg-accentbg text-accent`) — otomatis benar di kedua
              tema, bukan warna baru. */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accentbg text-accent">
            <ActiveIcon className="h-4 w-4" strokeWidth={2} />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[9px] font-bold uppercase tracking-wide text-ink3">Workspace</span>
                <span className="block truncate text-[12.5px] font-semibold text-ink">{judul}</span>
              </span>
              <ChevronsUpDown size={13} className="shrink-0 text-ink3" />
            </>
          )}
        </button>
      }
    >
      {/* D-137 — tombol "Susun ulang" TIDAK menutup dropdown-nya sendiri:
          Radix DropdownMenu cuma menutup lewat Escape/klik-luar/`onSelect`
          milik DropdownMenu.Item — tombol polos ini bukan Item, aman diklik
          berkali-kali tanpa dropdown ikut hilang, sama seperti tombol
          "Susun ulang menu" sidebar (Layout.jsx). */}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <MenuLabel className="p-0">Pindah workspace</MenuLabel>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setCustomizing((v) => !v); }}
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold transition-colors",
            customizing ? "bg-accent text-white" : "text-ink3 hover:bg-hovertint hover:text-ink2"
          )}
        >
          {customizing ? <Check size={11} /> : <ArrowUpDown size={11} />}
          {customizing ? "Selesai" : "Susun ulang"}
        </button>
      </div>
      <MenuSeparator />

      {/* Main Hub adalah salah satu tujuan di daftar yang sama, bukan tombol
          terpisah — hub berdiri DI ATAS kelima divisi, dan menaruhnya di sini
          membuat itu terbaca tanpa perlu kontrol tambahan di layar. Main Hub
          SENGAJA tidak ikut disusun ulang (di luar loop drag-drop) — posisi
          "selalu di atas" itu bagian dari perannya, bukan divisi biasa. */}
      <MenuItem icon={LayoutGrid} onSelect={() => pergi("/portal")}>
        <span className="flex w-full items-center justify-between gap-3">
          Main Hub
          {activeKey === null && <Check size={13} className="shrink-0 text-accent" />}
        </span>
      </MenuItem>

      <MenuSeparator />

      {/* D-137 — mode susun: baris JADI draggable (bukan MenuItem lagi,
          supaya klik/Enter tidak ikut ter-trigger onSelect dan menutup
          menu) — pola drag & drop SAMA PERSIS dengan SidebarNavSection.jsx
          (HTML5 native, bukan library baru). Mode normal: MenuItem biasa,
          klik langsung pindah workspace seperti sebelumnya. */}
      {customizing ? (
        tersedia.map(({ key, label, Icon }, idx) => (
          <div
            key={key}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => { e.preventDefault(); if (overIdx !== idx) setOverIdx(idx); }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
            className={cn(
              "flex cursor-grab items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-[13px] font-medium text-ink2 transition-colors active:cursor-grabbing",
              overIdx === idx && dragIdx !== idx && "border-accent bg-accentbg text-accent",
              dragIdx === idx && "opacity-40"
            )}
          >
            <GripVertical size={14} className="shrink-0 text-ink3" aria-hidden />
            <Icon size={15} className="shrink-0 opacity-80" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </div>
        ))
      ) : (
        tersedia.map(({ key, label, to, Icon }) => (
          <MenuItem key={key} icon={Icon} onSelect={() => pergi(to)}>
            <span className="flex w-full items-center justify-between gap-3">
              <span className="truncate">{label}</span>
              {key === activeKey && <Check size={13} className="shrink-0 text-accent" />}
            </span>
          </MenuItem>
        ))
      )}
    </Menu>
  );
}
