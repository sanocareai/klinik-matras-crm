import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/ThemeProvider.jsx";
import { cn } from "@/lib/utils.js";

// Toggle cepat terang/gelap di topbar (D-064, 4 September 2026) — laporan
// owner: mau ganti tema tanpa buka Pengaturan > Tampilan setiap kali. SATU
// komponen di Topbar.jsx (dipakai semua divisi) = otomatis muncul di semua
// workspace, bukan cuma satu halaman.
//
// SENGAJA switch 2-posisi (terang/gelap), bukan 3-opsi (+ "Sistem") seperti
// AppearanceSection — ini shortcut cepat untuk kasus paling umum; opsi
// "Ikuti perangkat" yang lebih jarang dipakai tetap ada di Pengaturan >
// Tampilan, tidak dihapus. Klik toggle ini SELALU menetapkan pilihan
// eksplisit (light/dark) berdasarkan `resolved` saat ini — kalau tadinya
// "system", klik ini mengambil alih jadi pilihan manual (perilaku yang
// sama seperti kalau user memilih langsung di Pengaturan).
//
// Gaya visual meniru referensi switch terang/gelap yang dipakai kebanyakan
// app: SATU ikon tampil di sisi track yang belum ditempati kenop (Moon di
// track gelap, Sun di track terang), kenopnya sendiri polos.
export default function ThemeToggle({ className }) {
  const { resolved, setTheme } = useTheme();
  const gelap = resolved === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={gelap}
      aria-label={gelap ? "Ganti ke tema terang" : "Ganti ke tema gelap"}
      title={gelap ? "Tema gelap aktif — klik untuk terang" : "Tema terang aktif — klik untuk gelap"}
      onClick={() => setTheme(gelap ? "light" : "dark")}
      className={cn(
        "relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        gelap ? "bg-ink3/60" : "bg-inset",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className
      )}
    >
      <Moon
        size={11}
        className={cn("absolute left-1.5 text-white transition-opacity", gelap ? "opacity-90" : "opacity-0")}
        aria-hidden
      />
      <Sun
        size={11}
        className={cn("absolute right-1.5 text-orange transition-opacity", gelap ? "opacity-0" : "opacity-100")}
        aria-hidden
      />
      {/* D-071 (4 September 2026) — laporan owner: kenop "bergeser ke kiri
          sedikit" waktu diklik, bukan meluncur penuh dari satu sisi ke
          sisi lain. Akar masalahnya: DUA class `translate-x-[...]` sempat
          bisa nempel BERSAMAAN di sini (`translate-x-[3px]` di string
          dasar + `translate-x-[26px]` ditambahkan lewat && saat gelap) —
          keduanya menulis custom property `--tw-translate-x` YANG SAMA,
          jadi mana yang menang murni tergantung urutan definisi di
          stylesheet hasil build (bukan urutan di className ini), TIDAK
          terjamin konsisten. `cn()` (twMerge) SEHARUSNYA membuang salah
          satu, tapi tidak boleh digantungkan ke situ untuk kelas arbitrary
          senilai ini — lebih aman: cuma SATU class translate-x yang
          mungkin ada dalam className kapan pun (ternary, bukan &&),
          sehingga tidak pernah ada dua kandidat yang perlu di-dedupe. */}
      <span
        className={cn(
          "z-10 h-[18px] w-[18px] rounded-full bg-white shadow-card transition-transform duration-200",
          gelap ? "translate-x-[26px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}
