import React from "react";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";
import MockBadge from "./MockBadge.jsx";

// Aktivitas terbaru modul Delivery.
//
// Titik berwarna dipakai sebagai penekanan, TAPI tiap baris tetap terbaca
// penuh tanpa melihat warnanya — nama pelaku dan kalimatnya sudah menjelaskan
// apa yang terjadi. Ini yang membuat panel tetap berguna di layar dengan
// warna tidak akurat, dan memenuhi ketentuan "jangan hanya mengandalkan
// warna untuk status".
const DOT = {
  green:   "bg-green",
  accent:  "bg-accent",
  orange:  "bg-orange",
  red:     "bg-red",
  neutral: "bg-ink3",
};

export default function RecentActivity({ items }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-bold text-ink">Aktivitas Terbaru</h3>
        <MockBadge />
      </div>

      <ol className="divide-y divide-line">
        {items.map((a) => (
          <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
            <span
              className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", DOT[a.tone] || DOT.neutral)}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-snug text-ink">
                <span className="font-semibold">{a.actor}</span> {a.text}
              </p>
            </div>
            <time className="shrink-0 text-[11px] text-ink3">{a.time}</time>
          </li>
        ))}
      </ol>
    </Card>
  );
}
