import React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils.js";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }) {
  return (
    // `max-w-full overflow-x-auto` — dulu `inline-flex` polos TANPA batas
    // lebar/overflow, jadi di layar sempit dengan banyak tab (mis. Laporan:
    // Ringkasan/Percakapan/Penjualan/Pipeline/Sales) list-nya MELEBAR
    // MELEWATI kontainer dan mendorong seluruh halaman overflow horizontal
    // (bukan cuma tab yang berantakan, tapi seluruh body ikut bisa di-scroll
    // ke samping — halaman "kurang jelas" seperti yang dilaporkan). Sekarang
    // tab list sendiri yang scroll horizontal (pola standar), scrollbar-nya
    // disembunyikan supaya tetap terlihat rapi seperti pill-group biasa.
    <TabsPrimitive.List
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-inset/80 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "shrink-0 rounded-xl px-3.5 py-1.5 text-sm font-medium text-ink2 transition-all",
        "hover:text-accent",
        "data-[state=active]:bg-surface data-[state=active]:text-accent data-[state=active]:shadow-card",
        className
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
