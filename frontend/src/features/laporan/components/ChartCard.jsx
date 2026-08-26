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
// BUG YANG DIPERBAIKI (26 Agustus 2026, DUA PUTARAN):
// Putaran 1 sempat pakai breakpoint tetap (`sm:flex-row`) — TERNYATA
// kambuh lagi di lebar MENENGAH: title+deskripsi (kalimat panjang) tetap
// `flex-row` di atas 640px meski actions (search+select) tidak lagi
// muat di sebelahnya, dan karena TIDAK ADA `flex-wrap` di baris HEADER itu
// sendiri, actions-nya kepotong/tumpang-tindih dengan sudut kartu alih-alih
// turun baris. Ini PERSIS kelas bug yang sudah didokumentasikan panjang di
// `components/ui/page.jsx` (PageHeader) — perbaikannya juga sama: JANGAN
// pakai breakpoint tetap sama sekali, pakai `flex-wrap` supaya blok actions
// pindah ke barisnya sendiri kapan pun tidak muat, di lebar berapa pun.
export default function ChartCard({ title, description, children, empty, className, index = 0, actions }) {
  return (
    <Card className={cn("animate-fade-rise", className)} style={{ animationDelay: `${index * 70}ms` }}>
      <CardHeader className={actions ? "flex-row flex-wrap items-start justify-between gap-3" : undefined}>
        <div className="min-w-[160px] flex-1 flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-ink3">{empty}</div>
        ) : children}
      </CardContent>
    </Card>
  );
}
