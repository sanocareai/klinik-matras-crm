import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Props:
//   page: nomor halaman saat ini (1-indexed)
//   pageSize: jumlah item per halaman
//   total: total item
//   onPage: (page) => void
//   onPageSize: (size) => void
//   pageSizeOptions: [10, 25, 50] (default)
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

  return (
    <div className="pagination">
      <span className="pagination-info">
        {total === 0 ? "0 data" : `${start}–${end} dari ${total}`}
      </span>

      <button
        className="pagination-btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft size={14} />
      </button>

      {getPages().map((p, i) =>
        p === "..." ? (
          <span key={`dot-${i}`} style={{ padding: "0 4px", color: "var(--text-muted)", fontSize: 13 }}>…</span>
        ) : (
          <button
            key={p}
            className={`pagination-btn ${p === page ? "active" : ""}`}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        )
      )}

      <button
        className="pagination-btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
      >
        <ChevronRight size={14} />
      </button>

      <div className="pagination-size" style={{ marginLeft: 8 }}>
        <select
          value={pageSize}
          onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} / hal</option>
          ))}
        </select>
      </div>
    </div>
  );
}
