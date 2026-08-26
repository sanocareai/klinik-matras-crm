import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";

// Wrapper konsisten utk semua chart Laporan — judul + deskripsi kecil +
// slot children (recharts ResponsiveContainer). `empty` tampilkan pesan
// kosong TANPA mengubah tinggi card (hindari layout shift saat filter ganti).
// `actions` (opsional, 26 Agustus 2026) — slot kanan-atas header, dipakai
// mis. dropdown filter yang harus terlihat SEBELUM scroll ke isi chart
// (lihat filter Sumber di "Rincian per Iklan", TrafficTab.jsx). Kalau tidak
// diisi, header tetap kolom biasa seperti sebelumnya — tidak ada perubahan
// visual di chart lain yang belum pakai prop ini.
//
// BUG YANG DIPERBAIKI (26 Agustus 2026): versi pertama SELALU `flex-row` +
// `shrink-0` pada actions, apa pun lebar layar. Di kartu Laporan yang
// sempit (mobile/PWA, atau ChartCard di kolom grid 2-lebar), title +
// deskripsi + search box + select berebut satu baris yang tidak cukup —
// keduanya sama-sama menolak menyusut, jadi actions-nya kepotong/tumpang
// tindih dengan title alih-alih turun ke baris baru. Sekarang default
// TUMPUK vertikal (`flex-col`), baru sejajar mulai breakpoint `sm:` ke atas
// — pola sama dengan grid KPI di TrafficTab.jsx sendiri.
export default function ChartCard({ title, description, children, empty, className, index = 0, actions }) {
  return (
    <Card className={cn("animate-fade-rise", className)} style={{ animationDelay: `${index * 70}ms` }}>
      <CardHeader className={actions ? "flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between" : undefined}>
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="w-full sm:w-auto sm:shrink-0">{actions}</div>}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-ink3">{empty}</div>
        ) : children}
      </CardContent>
    </Card>
  );
}
