import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils.js";
import {
  NOTIF_WORKSPACES, NOTIF_TYPES, buildTargetUrl, workspaceOf, relativeTime,
} from "./notificationTypes.js";

// Satu baris notifikasi. Dipakai BERSAMA oleh drawer dan halaman
// /notifications supaya keduanya tidak pernah bisa berbeda tampilan —
// dua salinan komponen daftar adalah cara paling cepat membuat drawer dan
// halaman "yang sama" diam-diam menyimpang.
export default function NotificationItem({ notif, onActivate, compact = false }) {
  const ws = NOTIF_WORKSPACES[workspaceOf(notif)] || NOTIF_WORKSPACES.system;
  const tipe = NOTIF_TYPES[notif.type];
  const belumDibaca = !notif.isRead;

  return (
    <button
      type="button"
      onClick={() => onActivate(notif)}
      // Tautan tujuan diumumkan ke screen reader: item ini bernavigasi, dan
      // tanpa ini ia terdengar seperti tombol yang tidak jelas ke mana.
      aria-label={`${ws.label}: ${notif.title}. ${belumDibaca ? "Belum dibaca. " : ""}Buka.`}
      className={cn(
        "relative flex w-full gap-3 border-b border-line px-4 text-left transition-colors last:border-b-0",
        compact ? "py-3" : "py-3.5",
        "hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        // Belum dibaca (#12): latar biru sangat muda + garis kiri biru.
        // Yang dibaca dibiarkan warna surface biasa — kontras antar keduanya
        // yang membuat "belum dibaca" terbaca sekilas tanpa menghitung titik.
        //
        // BUG (fix, dark mode): sebelumnya `bg-[#F5F8FF]` — hex MENTAH, bukan
        // token, jadi TIDAK ikut [data-theme="dark"]. Warna itu (nyaris
        // putih) dipasang di ATAS surface dark (nyaris hitam) dengan teks
        // `text-ink` (nyaris putih di dark mode) di atasnya — hasilnya blok
        // putih penuh dengan tulisan nyaris tak kelihatan, persis laporan
        // user (screenshot notifikasi 21 Agustus 2026). `bg-accentbg` adalah
        // token DS v2 yang SAMA PERSIS dengan #F5F8FF secara visual di light
        // mode (dari --accent-bg light: rgba(20,87,217,0.10)) tapi otomatis
        // jadi tint biru gelap yang benar di dark mode (rgba(10,132,255,0.16)
        // di atas surface gelap) — lihat styles/tailwind.css @theme inline.
        belumDibaca && "bg-accentbg"
      )}
    >
      {belumDibaca && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
      )}

      {/* Titik biru penanda belum dibaca — sama alasan token di atas. */}
      <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
        {belumDibaca && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-chip px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", ws.badge)}>
            {ws.label}
          </span>
          {tipe && <span className="text-[10px] text-ink3">{tipe.label}</span>}

          {/* Prioritas kritis: badge MERAH saja (#14). Kartunya sengaja TIDAK
              dibuat merah seluruhnya — kalau seluruh kartu merah, daftar yang
              berisi beberapa item kritis berubah jadi dinding merah dan
              justru tidak ada yang menonjol. */}
          {notif.priority === "critical" && (
            <span className="inline-flex items-center gap-1 rounded-chip bg-redbg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red">
              <AlertTriangle size={9} /> Kritis
            </span>
          )}

          {/* Perlu tindakan: badge amber (#13) */}
          {notif.actionRequired && (
            <span className="rounded-chip bg-orangebg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange">
              Perlu tindakan
            </span>
          )}

          <time className="ml-auto shrink-0 text-[10px] text-ink3" dateTime={notif.createdAt}>
            {relativeTime(notif.createdAt)}
          </time>
        </div>

        <div className={cn("mt-1 truncate text-[13px] text-ink", belumDibaca ? "font-semibold" : "font-medium")}>
          {notif.title}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-ink2">
          {notif.message}
        </p>

        {!compact && (
          <span className="mt-1.5 block truncate text-[10px] text-ink3">
            {buildTargetUrl(notif)}
          </span>
        )}
      </div>
    </button>
  );
}
