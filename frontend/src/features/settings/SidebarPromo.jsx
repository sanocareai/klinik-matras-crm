import React from "react";
import { Sparkles, LifeBuoy } from "lucide-react";
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
export default function SidebarPromo({ collapsed }) {
  const navigate = useNavigate();
  if (collapsed) return null;

  return (
    <div className="mx-3 mb-2 flex flex-col gap-2">
      <div
        className="relative overflow-hidden rounded-btn p-3.5"
        style={{ background: "linear-gradient(140deg, var(--blue-600) 0%, var(--blue-800) 100%)" }}
      >
        {/* Bulatan dekoratif tipis — memberi kedalaman tanpa gambar/aset. */}
        <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -bottom-8 -left-4 h-16 w-16 rounded-full bg-white/[0.07]" />

        <span className="relative flex h-8 w-8 items-center justify-center rounded-chip bg-white/20 text-white">
          <Sparkles size={16} />
        </span>
        <p className="relative mt-2.5 text-[13px] font-bold leading-snug text-white">
          Tanya Sano
        </p>
        <p className="relative mt-1 text-[11px] leading-relaxed text-white/70">
          Asisten AI untuk bantu jawab chat & cari info produk lebih cepat.
        </p>
        <button
          onClick={() => navigate("/copilot")}
          className="relative mt-2.5 w-full rounded-chip bg-white px-3 py-1.5 text-[12px] font-semibold text-blue-700 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          Buka Sano
        </button>
      </div>

      {/* Kartu bantuan — permukaan inset, tenang, tidak bersaing dgn promo. */}
      <div className="flex items-start gap-2.5 rounded-btn bg-inset p-3">
        <LifeBuoy size={15} className="mt-0.5 shrink-0 text-ink3" />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink">Butuh bantuan?</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">
            Hubungi admin kalau ada kendala pemakaian CRM.
          </p>
        </div>
      </div>
    </div>
  );
}
