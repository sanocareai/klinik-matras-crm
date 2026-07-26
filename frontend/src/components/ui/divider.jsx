import React from "react";
import { cn } from "@/lib/utils.js";

// ─── DIVIDER (Sano DS v2) ────────────────────────────────────────────────────
// SATU-SATUNYA garis yang diizinkan di sistem ini: hairline 1px, 8% opacity,
// HANYA sebagai pemisah antar baris DI DALAM list/card.
//
// `inset` (default) menarik garis masuk sejauh padding Card (24px) supaya garis
// tidak menabrak tepi kartu — itu yang membuatnya terbaca sebagai pemisah
// baris, bukan sebagai  kartu.
export function Divider({ className, inset = true, ...props }) {
  return (
    <div
      role="separator"
      className={cn("h-px shrink-0 bg-line", inset && "-mx-6 px-6", className)}
      {...props}
    />
  );
}

// Pembungkus list: menyisipkan hairline OTOMATIS antar anak (bukan setelah
// anak terakhir). Lebih aman daripada menaruh <Divider/> manual, karena tidak
// mungkin lupa/kelebihan garis saat jumlah baris berubah.
export function DividedList({ className, children, ...props }) {
  return (
    <div className={cn("[&>*+*]:border-t [&>*+*]:border-line", className)} {...props}>
      {children}
    </div>
  );
}
