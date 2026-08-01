import React from "react";
import { cn } from "@/lib/utils.js";

// COMMAND CENTER — panel biru gelap di kepala tiap halaman workspace SANSS
// (redesign 1 Agustus 2026, mengikuti mockup "… command center").
//
// SATU komponen dipakai Bengkel/Armada/Gudang/Kendali supaya kelima
// workspace terasa satu sistem. Yang berbeda cuma isinya, BUKAN cara
// menyusunnya — kalau tiap halaman menulis panelnya sendiri, tiga bulan lagi
// pasti ada yang beda padding/ukuran font tanpa alasan.
//
// ATURAN ANGKA: `stats` HARUS berisi angka nyata dari API halaman itu.
// Mockup desain memakai contoh (86%, 96.8%, 2.4 hari) — itu TIDAK ditiru.
// Kalau sebuah metrik belum bisa dihitung, JANGAN kirim tile-nya sama sekali
// atau kirim value "—"; lebih baik kosong daripada angka karangan yang
// dipercaya orang untuk mengambil keputusan.

const TONE = {
  blue:    "from-[#0A2463] via-[#123C9E] to-[#1D4ED8]",
  amber:   "from-[#7C2D12] via-[#B45309] to-[#D97706]",
  sky:     "from-[#0C4A6E] via-[#0369A1] to-[#0284C7]",
  emerald: "from-[#064E3B] via-[#047857] to-[#059669]",
  violet:  "from-[#4C1D95] via-[#6D28D9] to-[#7C3AED]",
};

/**
 * @param {string}  title    — mis. "Production command center"
 * @param {string}  subtitle — kalimat penjelas satu baris
 * @param {string}  tone     — kunci TONE, samakan dengan warna workspace
 * @param {object}  health   — { label, tone: "ok"|"warn" } badge kanan atas (opsional)
 * @param {Array}   stats    — [{ label, value, hint }] maksimal 4, ANGKA NYATA
 */
export function WorkspaceHero({ title, subtitle, tone = "blue", health, stats = [] }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-gradient-to-br px-6 py-6 text-white sm:px-8 sm:py-7",
        TONE[tone] || TONE.blue
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[240px] flex-1">
          <h2 className="text-[20px] font-bold tracking-tight sm:text-[23px]">{title}</h2>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-white/70">{subtitle}</p>
          )}
        </div>

        {health && (
          <div className="rounded-xl bg-white/12 px-4 py-3 backdrop-blur ring-1 ring-white/15">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/55">
              Current workspace health
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  health.tone === "warn" ? "bg-amber-400" : "bg-emerald-400"
                )}
              />
              {health.label}
            </div>
          </div>
        )}
      </div>

      {stats.length > 0 && (
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl bg-white/10 px-4 py-3.5 backdrop-blur-sm ring-1 ring-white/15"
            >
              <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/55">
                {s.label}
              </div>
              <div className="mt-1.5 text-[26px] font-bold leading-none tabular-nums">{s.value}</div>
              {s.hint && <div className="mt-1.5 text-[11px] text-white/55">{s.hint}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkspaceHero;
