import React from "react";
import { useNavigate } from "react-router-dom";
import { Users, Wrench, Package, Truck, Gauge, LayoutGrid, ChevronsUpDown, Check } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { cn } from "@/lib/utils.js";

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
export const WORKSPACES = [
  { key: "growth",    label: "Sales CRM & Omnichannel",    to: "/dashboard", Icon: Users,   roles: ["ADMIN", "SALES"] },
  { key: "bengkel",   label: "Production Operations",      to: "/bengkel",   Icon: Wrench,  roles: ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"] },
  { key: "warehouse", label: "Warehouse & Inventory Control", to: "/gudang", Icon: Package, roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_LEAD"] },
  { key: "armada",    label: "Delivery & Fulfillment",     to: "/armada",    Icon: Truck,   roles: ["ADMIN", "DISPATCHER", "DRIVER"] },
  { key: "kendali",   label: "All Teams Dashboard",        to: "/kendali",   Icon: Gauge,   roles: ["ADMIN", "FINANCE"] },
];

export const WORKSPACE_LABEL = Object.fromEntries(WORKSPACES.map((w) => [w.key, w.label]));

/**
 * @param activeKey  kunci divisi aktif, atau null saat di Main Hub
 * @param collapsed  sidebar sedang menyempit (72px) → tampilkan ikon saja
 */
export default function WorkspaceSwitcher({ activeKey, collapsed = false, userRoles = [], onNavigate }) {
  const navigate = useNavigate();
  const tersedia = WORKSPACES.filter((w) => w.roles.some((r) => userRoles.includes(r)));

  const aktif = WORKSPACES.find((w) => w.key === activeKey) || null;
  const ActiveIcon = aktif?.Icon || LayoutGrid;
  const judul = aktif?.label || "Main Hub";

  function pergi(to) {
    navigate(to);
    onNavigate?.();
  }

  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          title={collapsed ? judul : undefined}
          aria-label={`Workspace aktif: ${judul}. Klik untuk berpindah.`}
          className={cn(
            "mx-3 mb-2 flex items-center gap-2.5 rounded-btn border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-hovertint",
            collapsed && "mx-2 justify-center px-0"
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
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
      <MenuLabel>Pindah workspace</MenuLabel>
      <MenuSeparator />

      {/* Main Hub adalah salah satu tujuan di daftar yang sama, bukan tombol
          terpisah — hub berdiri DI ATAS kelima divisi, dan menaruhnya di sini
          membuat itu terbaca tanpa perlu kontrol tambahan di layar. */}
      <MenuItem icon={LayoutGrid} onSelect={() => pergi("/portal")}>
        <span className="flex w-full items-center justify-between gap-3">
          Main Hub
          {activeKey === null && <Check size={13} className="shrink-0 text-accent" />}
        </span>
      </MenuItem>

      <MenuSeparator />

      {tersedia.map(({ key, label, to, Icon }) => (
        <MenuItem key={key} icon={Icon} onSelect={() => pergi(to)}>
          <span className="flex w-full items-center justify-between gap-3">
            <span className="truncate">{label}</span>
            {key === activeKey && <Check size={13} className="shrink-0 text-accent" />}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
