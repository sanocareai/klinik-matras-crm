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
export default function ChartCard({ title, description, children, empty, className, index = 0, actions }) {
  return (
    <Card className={cn("animate-fade-rise", className)} style={{ animationDelay: `${index * 70}ms` }}>
      <CardHeader className={actions ? "flex-row items-start justify-between gap-3" : undefined}>
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-ink3">{empty}</div>
        ) : children}
      </CardContent>
    </Card>
  );
}
