import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils.js";

// Dropdown menu aksesibel di atas Radix (keyboard nav, fokus, aria otomatis).
// API tipis: <Menu trigger={<button/>}><MenuItem/>…</Menu>. Dipakai untuk menu
// kontekstual/aksi & menu profil user. Lihat sano-components.md §B.4.
export function Menu({ trigger, children, align = "end", sideOffset = 6, className }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-[150] min-w-[180px] rounded-xl border border-black/5 bg-white p-1.5 shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
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
        "data-[highlighted]:bg-slate-100",
        destructive
          ? "text-chart-rose data-[highlighted]:bg-chart-rose-soft"
          : "text-slate-600",
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
    <DropdownMenu.Label className={cn("px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400", className)}>
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator({ className }) {
  return <DropdownMenu.Separator className={cn("my-1 h-px bg-slate-100", className)} />;
}
