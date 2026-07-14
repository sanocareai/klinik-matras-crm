import React from "react";
import { cn } from "@/lib/utils.js";

// Kontainer halaman standar Sano — padding konsisten (16px mobile → 32px desktop,
// sesuai skala spacing) + area scroll. Menggantikan pola `.dash-page` yang tersebar
// supaya SEMUA halaman punya padding & perilaku responsif identik (memperbaiki
// bug "halaman kepotong di mobile" di Pengaturan/Laporan/Pengguna).
// Lihat sano-components.md Part A & §B.1.
export function PageContainer({ className, children, ...props }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1400px] p-4 md:p-8", className)} {...props}>
      {children}
    </div>
  );
}

// Header halaman: judul (H1) + subjudul opsional di kiri, aksi di kanan.
// Membungkus rapi di mobile (aksi turun ke bawah judul). `actions` = node.
export function PageHeader({ title, subtitle, actions, className, children }) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {title && (
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-slate-900">
            {title}
          </h1>
        )}
        {subtitle && <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>}
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

// Wrapper konten di bawah header (opsional) — jarak antar-section konsisten.
export function PageBody({ className, children, ...props }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {children}
    </div>
  );
}
