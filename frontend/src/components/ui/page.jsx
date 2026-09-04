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
//
// ⚠️ BUG NYATA YANG PERNAH TERJADI DI SINI: dulu `sm:flex-row` (baris di atas
// 640px) dengan judul `min-w-0` TANPA lebar minimum, dan aksi `shrink-0`. Di
// jendela desktop "sedang" (bukan sempit, bukan lebar penuh — mis. ~1000px,
// halaman dengan banyak kontrol seperti Order: pencarian + 2 dropdown + 4
// tombol), total lebar aksi melebihi ruang tersisa. Karena aksi TIDAK BOLEH
// menyusut (shrink-0) sementara judul BOLEH menyusut sampai berapa pun
// (min-w-0 menghapus batas bawaan flex), browser memaksa kolom judul
// menyusut sampai nyaris 0px — hasilnya subjudul yang harusnya satu kalimat
// merender SATU KATA PER BARIS memanjang ke bawah ("85" / "order" / "." /
// "35" / "mandek" / ...), bukan salah CSS wrap biasa tapi kolom yang
// benar-benar sesempit itu.
//
// Perbaikan: TIDAK memakai breakpoint tetap (sm/lg/xl) sama sekali — breakpoint
// tetap hanya memindahkan masalah ke lebar lain (halaman dengan aksi lebih
// banyak akan tetap pecah di breakpoint yang sama). Sebagai gantinya:
//  1. `flex-wrap` di kontainer LUAR — kalau aksi tidak muat di sebelah judul,
//     SELURUH blok aksi pindah ke baris baru (elemen flex tidak diperas
//     sampai gepeng, cuma dibungkus ke baris berikutnya).
//  2. Judul diberi `min-w-[180px]` — batas bawah yang tidak boleh dilanggar
//     apa pun yang terjadi di sebelahnya, jadi 1-2 kata judul tidak akan
//     pernah pecah jadi satu-huruf-per-baris.
//  3. Blok aksi sendiri tetap `flex-wrap` (kontrol di dalamnya boleh
//     membungkus ke baris ke-2/ke-3 kalau memang tidak muat satu baris).
//
// `actionsBelow` (D-050, 4 September 2026) — OPSIONAL, default `false` supaya
// seluruh halaman lain tetap persis seperti sekarang. Kalau true, blok aksi
// turun ke baris sendiri di bawah judul dan rata KIRI, mengikuti mockup
// Delivery Hub: di sana date picker + "Tambah Kendaraan" + "Buat Job" dibaca
// sebagai satu toolbar pembuka halaman, bukan tempelan di pojok kanan yang
// jaraknya jauh dari judul yang menerangkannya.
export function PageHeader({ title, subtitle, actions, actionsBelow = false, className, children }) {
  const blokAksi = actions && (
    <div className="flex flex-wrap items-center gap-2">{actions}</div>
  );

  if (actionsBelow) {
    return (
      <div className={cn("mb-6", className)}>
        {title && (
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">
            {title}
          </h1>
        )}
        {subtitle && <p className="mt-1 max-w-[640px] text-[13px] text-ink2">{subtitle}</p>}
        {children}
        {blokAksi && <div className="mt-4">{blokAksi}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-3",
        className
      )}
    >
      <div className="min-w-[180px] flex-1">
        {title && (
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">
            {title}
          </h1>
        )}
        {subtitle && <p className="mt-1 text-[13px] text-ink2">{subtitle}</p>}
        {children}
      </div>
      {blokAksi}
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
