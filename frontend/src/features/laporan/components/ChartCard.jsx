import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";

// Wrapper konsisten utk semua chart Laporan — judul + deskripsi kecil +
// slot children (recharts ResponsiveContainer). `empty` tampilkan pesan
// kosong TANPA mengubah tinggi card (hindari layout shift saat filter ganti).
export default function ChartCard({ title, description, children, empty, className, index = 0 }) {
  return (
    <Card className={cn("animate-fade-rise", className)} style={{ animationDelay: `${index * 70}ms` }}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-slate-400">{empty}</div>
        ) : children}
      </CardContent>
    </Card>
  );
}
