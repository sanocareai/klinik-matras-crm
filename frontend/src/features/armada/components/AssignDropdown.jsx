import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { UserPlus, ChevronDown, X, Check } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";

// AssignDropdown (D-054, 4 September 2026) — satu tombol ringkas untuk
// menugaskan driver+helper, MENGGANTIKAN dua baris ChipPilih (Driver +
// Helper) yang SELALU tampil penuh.
//
// Laporan owner (screenshot langsung, Papan/JobCard): 9 driver + beberapa
// helper dirender sebagai chip yang SELALU terlihat di SETIAP kartu job —
// di grid 3 kolom itu jadi ~10 baris chip berulang identik per kartu,
// "numpuk". Ini persis kegagalan yang sama yang sudah diperbaiki di
// Dashboard lewat TugaskanDropdown (D-036) — pola itu diekstrak jadi
// komponen bersama di sini (bukan disalin ulang) supaya dipakai juga oleh
// JobCard Papan, yang belum pernah memakainya.
//
// BEDA dari TugaskanDropdown Dashboard: Dashboard cuma menugaskan job yang
// MEMANG belum ada driver sama sekali (tombol selalu "Tugaskan" polos).
// JobCard Papan menugaskan job yang BISA SUDAH punya driver/helper — jadi
// tombol di sini menampilkan NAMA yang sedang aktif (bukan cuma ikon),
// centang di baris yang sedang aktif, dan tombol "Lepas driver"/pilihan
// "Tanpa helper" untuk membatalkan penugasan tanpa perlu buka drawer.
//
// KONTRAK onPick(driverId, helperId) SENGAJA SAMA dengan tugaskanCepat di
// ArmadaDashboard.jsx — `helperId` HANYA dikirim kalau memang dipilih lewat
// submenu (undefined kalau tidak), supaya klik nama driver polos TIDAK
// diam-diam menghapus helper yang sudah ada (guard yang sama, bug yang
// sama dihindari, D-037).
export default function AssignDropdown({
  drivers,
  helpers,
  currentDriverId,
  currentHelperId,
  busy,
  onPick,
  className,
}) {
  const driver = drivers.find((d) => d.id === currentDriverId);
  const helper = helpers.find((h) => h.id === currentHelperId);
  const label = driver ? (helper ? `${driver.name} · ${helper.name}` : driver.name) : "Belum ditugaskan";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(
            "group flex h-9 w-full items-center gap-1.5 rounded-btn border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50",
            driver
              ? "border-border bg-inset text-ink2 hover:border-accent hover:bg-accentbg hover:text-accent"
              : "border-dashed border-ink3 bg-inset text-ink3 hover:border-accent hover:text-accent",
            "data-[state=open]:border-accent data-[state=open]:bg-accent data-[state=open]:text-white",
            className
          )}
        >
          {driver
            ? <Avatar name={driver.name} size="sm" gradient className="h-5 w-5 shrink-0 text-[9px]" />
            : <UserPlus size={13} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={12} className="shrink-0 text-ink3 transition-transform group-data-[state=open]:rotate-180 group-data-[state=open]:text-white/80" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start" sideOffset={6}
          className="z-50 min-w-[190px] rounded-btn border border-border bg-surface p-1.5 shadow-popover"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
            Driver
          </p>
          {/* Lepas driver — cuma muncul kalau memang ada driver terpasang,
              supaya menu tidak menawarkan aksi yang sudah tidak berlaku. */}
          {driver && (
            <DropdownMenu.Item
              onSelect={() => onPick(null, null)}
              className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] text-red outline-none data-[highlighted]:bg-redbg"
            >
              <X size={13} className="shrink-0" /> Lepas driver
            </DropdownMenu.Item>
          )}
          {drivers.map((d) => {
            const active = d.id === currentDriverId;
            return (
              <DropdownMenu.Sub key={d.id}>
                <DropdownMenu.SubTrigger
                  onClick={() => onPick(d.id)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-accentbg data-[state=open]:bg-accentbg",
                    active ? "font-semibold text-accent" : "text-ink"
                  )}
                >
                  <Avatar name={d.name} size="sm" gradient className="h-6 w-6 text-[10px]" />
                  <span className="flex-1 truncate">{d.name}</span>
                  {active && <Check size={12} className="shrink-0 text-accent" />}
                  <ChevronDown size={11} className="shrink-0 -rotate-90 text-ink3" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={4}
                    className="z-50 min-w-[170px] rounded-btn border border-border bg-surface p-1.5 shadow-popover"
                  >
                    <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink3">
                      Helper (opsional)
                    </p>
                    <DropdownMenu.Item
                      onSelect={() => onPick(d.id, null)}
                      className="flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] text-ink3 outline-none data-[highlighted]:bg-hovertint"
                    >
                      Tanpa helper
                    </DropdownMenu.Item>
                    {helpers.map((h) => (
                      <DropdownMenu.Item
                        key={h.id}
                        onSelect={() => onPick(d.id, h.id)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-btn px-2 py-1.5 text-[12.5px] outline-none data-[highlighted]:bg-hovertint",
                          h.id === currentHelperId && active ? "font-semibold text-accent" : "text-ink"
                        )}
                      >
                        <Avatar name={h.name} size="sm" gradient className="h-5 w-5 text-[9px]" />
                        <span className="flex-1 truncate">{h.name}</span>
                        {h.id === currentHelperId && active && <Check size={12} className="shrink-0 text-accent" />}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
