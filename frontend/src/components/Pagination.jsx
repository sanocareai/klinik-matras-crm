import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.js";

// Props:
//   page: nomor halaman saat ini (1-indexed)
//   pageSize: jumlah item per halaman
//   total: total item
//   onPage: (page) => void
//   onPageSize: (size) => void
//   pageSizeOptions: [10, 25, 50] (default)
//
// Wave 5A: reskin ke Tailwind (dari .pagination/.pagination-btn di index.css).
// Perilaku & props TIDAK berubah — logika rentang halaman sama persis.
export default function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizeOptions = [10, 25, 50],
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.min((page - 1) * pageSize + 1, total);
  const end   = Math.min(page * pageSize, total);

  // Tampilkan max 5 halaman di sekitar halaman aktif
  function getPages() {
    const pages = [];
    const delta = 2;
    const left  = Math.max(1, page - delta);
    const right = Math.min(totalPages, page + delta);
    if (left > 1) { pages.push(1); if (left > 2) pages.push("..."); }
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages) { if (right < totalPages - 1) pages.push("..."); pages.push(totalPages); }
    return pages;
  }

  // Target sentuh minimal 32px (h-8 w-8) — sejalan dgn aturan touch target
  // CLAUDE.md; tombol angka melebar sendiri kalau halaman >99.
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-200 " +
    "bg-white px-2 text-[13px] font-semibold text-slate-600 transition-colors duration-150 " +
    "hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-3">
      <span className="mr-1 text-xs text-slate-400">
        {total === 0 ? "0 data" : `${start}–${end} dari ${total}`}
      </span>

      <button className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Halaman sebelumnya">
        <ChevronLeft size={14} />
      </button>

      {getPages().map((p, i) =>
        p === "..." ? (
          <span key={`dot-${i}`} className="px-1 text-[13px] text-slate-300">…</span>
        ) : (
          <button
            key={p}
            className={cn(btn, p === page && "border-brand-600 bg-brand-600 text-white hover:bg-brand-700")}
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        )
      )}

      <button className={btn} onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Halaman berikutnya">
        <ChevronRight size={14} />
      </button>

      <select
        className="ml-1 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        value={pageSize}
        onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
        aria-label="Jumlah data per halaman"
      >
        {pageSizeOptions.map((s) => (
          <option key={s} value={s}>{s} / hal</option>
        ))}
      </select>
    </div>
  );
}
