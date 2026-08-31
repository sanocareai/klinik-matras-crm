import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils.js";

// Dropdown menu aksesibel di atas Radix (keyboard nav, fokus, aria otomatis).
// API tipis: <Menu trigger={<button/>}><MenuItem/>…</Menu>. Dipakai untuk menu
// kontekstual/aksi & menu profil user. Lihat sano-components.md §B.4.
//
// BUG YANG DIPERBAIKI (26 Agustus 2026): z-index Content SEBELUMNYA 150 —
// lebih RENDAH dari sidebar mobile (`.sidebar.mobile-open`, index.css,
// z-index:400). Content di-Portal ke document.body sebagai SIBLING dari
// <aside class="sidebar">, bukan child-nya, jadi menang/kalahnya murni
// angka z-index, TIDAK peduli trigger-nya ada di dalam sidebar atau tidak.
// Akibatnya WorkspaceSwitcher (trigger-nya DI DALAM sidebar) — begitu
// sidebar mobile dibuka lalu tombol Workspace diklik — menu pilihannya
// ter-render, tapi KETUTUP oleh panel sidebar sendiri (400 > 150). Dinaikkan
// ke 1100 — di atas SEMUA overlay interaktif lain yang pernah dipasang di
// codebase ini (drawer Customer 360 z-100, dialog Radix z-200/201, sidebar
// mobile z-400, bottom sheet z-500, context-menu chat z-999, modal lama
// z-1000) — TAPI tetap di bawah lapisan "selalu paling atas" yang memang
// harus menang mutlak (tooltip z-1200, image viewer z-1300, toast z-9999).
export function Menu({ trigger, children, align = "end", sideOffset = 6, className }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-[1100] min-w-[180px] rounded-xl bg-surface p-1.5 shadow-popover outline-none",
            // BUG DIPERBAIKI (31 Agustus 2026, laporan owner: "animasi
            // perpindahan sangat patah" di dropdown status/driver Armada) —
            // sebelumnya CUMA kelas animasi MASUK yang diberi (fade-in-0,
            // zoom-in-95). `data-[state=closed]:animate-out` sendirian tidak
            // menganimasikan apa pun tanpa kelas fade-out/zoom-out yang
            // menyertainya (persis pola lengkap di modal.jsx) — jadi menutup
            // selalu terasa mendadak/patah walau membuka sudah mulus.
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "duration-150 ease-out",
            className
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Item menu. `destructive` → merah (aksi hapus/keluar berbahaya).
export function MenuItem({ className, destructive, icon: Icon, children, ...props }) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium outline-none",
        "data-[highlighted]:bg-inset",
        destructive
          ? "text-red data-[highlighted]:bg-redbg"
          : "text-ink2",
        className
      )}
      {...props}
    >
      {Icon && <Icon size={15} className="shrink-0 opacity-80" />}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ className, children }) {
  return (
    <DropdownMenu.Label className={cn("px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink3", className)}>
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator({ className }) {
  return <DropdownMenu.Separator className={cn("my-1 h-px bg-inset", className)} />;
}
