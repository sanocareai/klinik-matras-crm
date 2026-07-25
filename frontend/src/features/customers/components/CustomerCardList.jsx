import React from "react";
import { AlertTriangle } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import {
  formatRupiah, formatPhoneDisplay, STAGE_LABELS, stageVariant, tagClass, isVIP,
} from "@/utils/format.js";

// Daftar kartu Pelanggan untuk MOBILE — tabel 14 kolom tidak mungkin dibaca di
// layar HP. Spec sano-components.md §B.3: "Mobile: collapses to Customer Cards
// (already the current behavior — keep)".
//
// Sebelumnya visibilitas diatur CSS media query (.customer-card-list display
// none di desktop). Sekarang pakai `md:hidden` di sini + `hidden md:block` di
// CustomersTable — ambangnya sama (768px), tapi aturannya ada DI komponen,
// bukan terpisah di index.css yang mudah lupa dirawat.
export default function CustomerCardList({ rows, loading, emptyMessage, onOpen }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 md:hidden">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-slate-400 md:hidden">{emptyMessage}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:hidden">
      {rows.map((c) => {
        const displayName = c.name || formatPhoneDisplay(c.phone) || c.instagramHandle || "?";
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            className="w-full rounded-2xl border border-slate-100 bg-white p-3 text-left shadow-sm transition-colors duration-100 active:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <div className="flex items-start gap-2.5">
              <Avatar name={displayName} src={c.profilePictureUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-[13px] font-semibold text-slate-800">{displayName}</span>
                  {c.pernahKomplain && (
                    <AlertTriangle size={12} className="shrink-0 text-chart-rose" title="Pernah komplain" />
                  )}
                  {isVIP(c) && <Badge variant="violet">VIP</Badge>}
                </div>
                <p className="mt-0.5 truncate text-[11px] tabular-nums text-slate-400">
                  {formatPhoneDisplay(c.phone) || (c.instagramHandle ? "@" + c.instagramHandle : "—")}
                </p>
              </div>
              <Badge variant={stageVariant(c.pipelineStage)} className="shrink-0">
                {STAGE_LABELS[c.pipelineStage] || c.pipelineStage || "—"}
              </Badge>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-50 pt-2 text-[11px]">
              <span className="truncate text-slate-400">{c.city || "Kota belum diisi"}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {c.orderCount || 0} order · <span className="font-semibold text-slate-700">{formatRupiah(c.orderValue || 0)}</span>
              </span>
            </div>

            {c.tags?.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {c.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className={`tag-chip ${tagClass(tag)}`}>{tag}</span>
                ))}
                {c.tags.length > 3 && (
                  <span className="text-[11px] text-slate-400">+{c.tags.length - 3}</span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
