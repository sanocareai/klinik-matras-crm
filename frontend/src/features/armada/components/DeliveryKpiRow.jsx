import React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils.js";

// Baris KPI dashboard Delivery.
//
// Tiap kartu BISA DIKLIK dan membawa ke /armada/jobs dengan filter status yang
// sesuai. KPI yang tidak bisa diklik memaksa orang mencari ulang di halaman
// lain apa yang baru saja dilihatnya — dan itu justru pekerjaan yang mau
// dihilangkan modul ini.
//
// Warna dipakai HANYA pada angka + badge ikon, bukan seluruh kartu. Aturan
// design system-nya eksplisit: "Jangan mewarnai seluruh card merah atau hijau."
//
// Badge ikon bulat berwarna (D-047, 4 September 2026 — laporan owner: "buat
// seperti artifacts", mockup redesain punya ikon dibungkus lingkaran tint
// per-tone, bukan cuma titik kecil) — dot lama DIGANTI, bukan ditambah:
// dua penanda warna untuk satu angka jadi berlebihan begitu badge ikon ada.
// KOREKSI D-050 (4 September 2026) — angka SEKARANG selalu `text-ink` (netral),
// warna tinggal di badge ikon saja. Sebelumnya badge DAN angka dua-duanya
// diwarnai per-tone: itu justru melanggar aturan yang ditulis di komentar tepat
// di atas ini (satu penanda warna per nilai, bukan dua), dan bikin 4 dari 6
// kartu jadi biru semua sehingga hilang kontras antara "sedang berjalan" dan
// "butuh dilihat" (hijau/merah). Di mockup artifact semua angka memang putih.
const TONE = {
  neutral: { badge: "bg-inset text-ink3" },
  accent:  { badge: "bg-accentbg text-accent" },
  green:   { badge: "bg-greenbg text-green" },
  orange:  { badge: "bg-orangebg text-orange" },
  red:     { badge: "bg-redbg text-red" },
};

export default function DeliveryKpiRow({ items }) {
  const navigate = useNavigate();

  return (
    // 2 kolom di mobile → 3 di tablet → 6 di desktop, sesuai ketentuan responsif.
    //
    // `lg:` (1024px), BUKAN `xl:` (1280px) — D-050. Breakpoint Tailwind diukur
    // dari lebar VIEWPORT, sementara baris ini hidup di kolom konten yang sudah
    // dipotong sidebar ~260px + padding halaman. Dengan `xl:`, jendela
    // 1280–1400px (laptop paling umum di tim ini) tidak pernah dapat 6 kolom
    // dan KPI-nya patah jadi 3x2 — persis yang terlihat di screenshot
    // produksi, padahal mockup-nya satu baris penuh.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((k) => {
        const tone = TONE[k.tone] || TONE.neutral;
        return (
          <button
            key={k.key}
            type="button"
            onClick={() => navigate(`/armada/jobs?status=${k.key}`)}
            aria-label={`${k.label}: ${k.value} job. Buka daftar job.`}
            className={cn(
              "flex flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5 text-left transition-all",
              "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            )}
          >
            {k.icon && (
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone.badge)}>
                <k.icon size={16} strokeWidth={2} aria-hidden />
              </span>
            )}
            <span>
              {/* dh-figure (D-045) — cahaya halus di angka besar, HANYA aktif di
                  dark mode Delivery (lihat styles/delivery-dark.css); di light
                  mode kelas ini tidak punya aturan sama sekali = tidak berefek. */}
              <strong className="dh-figure block text-[26px] font-extrabold leading-none tracking-tight text-ink">
                {k.value}
              </strong>
              {/* TANPA `truncate` (D-050) — di 6 kolom, "Belum Dijadwalkan" dan
                  "Driver Ditugaskan" lebih lebar dari kartunya dan terpotong
                  jadi "Belum Dijadwal…". Label KPI yang tidak terbaca utuh
                  meniadakan gunanya. Dibiarkan membungkus 2 baris; tinggi kartu
                  tetap rata karena item grid otomatis stretch. */}
              <span className="mt-1 block text-[11px] font-semibold leading-snug text-ink2">{k.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
