import React from "react";
import { LinkBukti } from "@/features/finance/receiptMedia.jsx";
import { Foto } from "@/features/finance/shared.jsx";

// BUKTI TERPISAH DARI AKSI (D-XXX, 22 Sep 2026) — thumbnail kecil, bukan
// tombol teks di antara tombol aksi lain (itu yang bikin kolom Aksi
// membengkak & bertumpuk). Dipakai untuk kolom "Bukti" yang PERANNYA cuma
// MELIHAT foto yang sudah ada (mis. bukti pembayaran dari sales/driver di
// Pembayaran & Verifikasi, atau bukti kasbon) — beda dari `SelBukti`
// (features/finance/shared.jsx) yang juga menangani UNGGAH & VERIFIKASI
// nota pengeluaran/pembelian sendiri. Kalau halamannya perlu upload+verify,
// pakai `SelBukti`; kalau cuma perlu "lihat foto yang sudah ada", pakai ini.
//
// `onView` opsional — kalau diisi, klik memanggil itu (mis. buka modal foto
// besar) alih-alih tautan langsung `<a target=_blank>`.
export function BuktiThumb({ url, onView, label = "Lihat bukti" }) {
  if (!url) return <span className="text-ink3">—</span>;
  if (onView) {
    return (
      <button
        type="button"
        onClick={onView}
        title={label}
        aria-label={label}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line transition-colors hover:border-accent"
      >
        <Foto url={url} className="h-full w-full object-cover" />
      </button>
    );
  }
  return (
    <LinkBukti
      url={url}
      className="block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line transition-colors hover:border-accent"
    >
      <Foto url={url} className="h-full w-full object-cover" />
    </LinkBukti>
  );
}

/** Daftar foto bukti sebuah pembayaran: foto lama (proofPhotoUrl) tetap terbaca bila proofPhotoUrls kosong. */
export const daftarBukti = (p) => (p?.proofPhotoUrls?.length ? p.proofPhotoUrls : p?.proofPhotoUrl ? [p.proofPhotoUrl] : []);

/**
 * Bukti BANYAK foto di kolom tabel: maksimal dua thumbnail + "+N"; klik membuka semua foto (lewat onView(daftar)).
 */
export function BuktiBanyak({ urls = [], onView, label = "Lihat foto bukti" }) {
  if (urls.length === 0) return <span className="text-ink3">—</span>;
  const tampil = urls.slice(0, 2);
  const sisa = urls.length - tampil.length;
  return (
    <span className="inline-flex items-center gap-1">
      {tampil.map((u) => <BuktiThumb key={u} url={u} onView={onView ? () => onView(urls) : undefined} label={label} />)}
      {sisa > 0 && (
        <button type="button" onClick={onView ? () => onView(urls) : undefined} className="text-[11px] font-semibold text-accent hover:underline" aria-label={`${sisa} foto lainnya`}>
          +{sisa}
        </button>
      )}
    </span>
  );
}
