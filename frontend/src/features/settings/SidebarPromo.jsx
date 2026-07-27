import React from "react";
import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

// ─── KARTU PROMO SIDEBAR (DS v2.1) ───────────────────────────────────────────
// Padanan kartu "Unlock more with Nexora Pro" di referensi — elemen yang
// membuat sidebar tidak terasa seperti daftar link kosong.
//
// BEDA PENTING dari referensi: isinya BUKAN upsell. Klinik Matras adalah CRM
// self-hosted milik sendiri; tidak ada tier berbayar untuk dijual, jadi kartu
// promo langganan akan bohong. Slot yang sama dipakai untuk mengarahkan ke
// Sano AI (fitur pembeda produk ini) — tujuan visual sama, isinya jujur.
//
// Gradien biru DI SINI adalah satu-satunya gradien yang diizinkan: dua shade
// dari TANGGA BIRU yang sama (600→800), bukan hue kedua.
//
// Revisi 28 Jul 2026:
// - Kartu "Butuh bantuan?" DIHAPUS — redundan, tidak menambah aksi apa pun.
// - Di layar sempit (<768px, sidebar jadi overlay mobile — breakpoint SAMA
//   dengan `.sidebar.mobile-open` di index.css), kartu ini dipadatkan jadi
//   1 baris (label + tombol kecil, tanpa deskripsi) — SEBELUMNYA menutupi
//   section nav lain di layar HP/tablet (masih bisa di-scroll, tapi promo
//   tidak seharusnya mendominasi ruang navigasi di layar yang sudah sempit).
export default function SidebarPromo({ collapsed }) {
  const navigate = useNavigate();
  if (collapsed) return null;

  return (
    <div className="mx-3 mb-2">
      <div
        className="relative flex items-center gap-2.5 overflow-hidden rounded-btn p-3.5 max-md:gap-2 max-md:p-2.5"
        style={{ background: "linear-gradient(140deg, var(--blue-600) 0%, var(--blue-800) 100%)" }}
      >
        {/* Bulatan dekoratif tipis — memberi kedalaman tanpa gambar/aset.
            Disembunyikan di versi padat (mobile) supaya tidak terasa penuh. */}
        <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10 max-md:hidden" />
        <span className="pointer-events-none absolute -bottom-8 -left-4 h-16 w-16 rounded-full bg-white/[0.07] max-md:hidden" />

        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-white/20 text-white max-md:h-7 max-md:w-7">
          <Sparkles size={16} className="max-md:h-3.5 max-md:w-3.5" />
        </span>

        {/* Layar biasa: judul + deskripsi + tombol full-width, ditumpuk vertikal. */}
        <div className="relative min-w-0 max-md:hidden">
          <p className="text-[13px] font-bold leading-snug text-white">Tanya Sano</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/70">
            Asisten AI untuk bantu jawab chat & cari info produk lebih cepat.
          </p>
          <button
            onClick={() => navigate("/copilot")}
            className="mt-2.5 w-full rounded-chip bg-white px-3 py-1.5 text-[12px] font-semibold text-blue-700 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            Buka Sano
          </button>
        </div>

        {/* Layar sempit (<768px): 1 baris padat — label + tombol kecil, tanpa
            deskripsi — supaya tidak mendominasi sidebar overlay mobile. */}
        <div className="relative hidden min-w-0 flex-1 items-center justify-between gap-2 max-md:flex">
          <p className="truncate text-[12px] font-bold text-white">Tanya Sano</p>
          <button
            onClick={() => navigate("/copilot")}
            className="shrink-0 rounded-chip bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            Buka
          </button>
        </div>
      </div>
    </div>
  );
}
