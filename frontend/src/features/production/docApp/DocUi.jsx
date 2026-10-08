import React, { useEffect, useState } from "react";
import { ImageOff, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { DOC_SOURCE_BADGE, DOC_SOURCE_LABEL, fmtDocTime } from "@/features/production/documentation.js";
import "./doc-app.css";

// Potongan UI kecil bersama Aplikasi Dokumentasi (P12D). Perilaku = P10B: gambar rusak jatuh ke placeholder (bukan ikon pecah), bukti VIDEO dirender sebagai <video>.
export function SafeImage({ src, alt = "", className = "", size = null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (!src || broken) {
    return <div className={`flex items-center justify-center bg-inset text-ink3 ${className}`} style={size ? { width: size, height: size } : undefined} data-testid="image-fallback"><ImageOff size={size ? Math.round(size * 0.32) : 20} aria-hidden /></div>;
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={className} style={size ? { width: size, height: size } : undefined} />;
}

export function SourceBadge({ source, compact = false }) {
  return <Badge variant={DOC_SOURCE_BADGE[source] || "neutral"} data-testid="source-badge" data-source={source} className={compact ? "max-w-full truncate whitespace-nowrap !px-1.5 !py-0 !text-[9.5px]" : ""}>{DOC_SOURCE_LABEL[source] || source}</Badge>;
}

// Bukti tahap bisa berupa VIDEO (uji rasa, uji fondasi, ...): dirender sebagai video, bukan <img> (yang akan tampak "gambar rusak").
export function MediaThumb({ item, alt, className = "h-full w-full object-cover" }) {
  const [broken, setBroken] = useState(false);
  if (item.kind !== "video") return <SafeImage src={item.url} className={className} alt={alt} />;
  if (broken) return <SafeImage src={null} className={className} />;
  return (
    <>
      <video src={item.url} muted playsInline preload="metadata" className={className} onError={() => setBroken(true)} data-testid="video-thumb" />
      <span className="absolute left-1 top-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[9.5px] font-semibold text-white">VIDEO</span>
    </>
  );
}

// Kekurangan dari kontrak server (docs.missing). `limit` memangkas tampilan kartu; sisanya diringkas "+N".
export function MissingChips({ missing, limit = null }) {
  if (!missing?.length) return <p className="m-0 text-[12.5px] font-semibold text-green" data-testid="missing-none">Tidak ada dokumentasi yang kurang saat ini.</p>;
  const shown = limit ? missing.slice(0, limit) : missing; const rest = missing.length - shown.length;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="missing-chips">
      {shown.map((m) => <li key={m.key}><Badge variant="red" data-missing={m.key}>{m.label} · kurang {m.missing}</Badge></li>)}
      {rest > 0 && <li><Badge variant="neutral">+{rest} kategori</Badge></li>}
    </ul>
  );
}

// Pratinjau besar satu foto: sumber, kategori, keterangan, pengunggah, waktu; koreksi hanya untuk pengiriman dokumentasi (correctable) dan bila boleh menulis.
export function Lightbox({ item, onClose, onCorrect, canCorrect }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Pratinjau foto" className="fixed inset-0 z-[70] flex flex-col bg-black/90 p-3" data-testid="lightbox">
      <div className="flex justify-end"><button type="button" onClick={onClose} aria-label="Tutup pratinjau" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"><X size={20} aria-hidden /></button></div>
      <div className="flex min-h-0 flex-1 items-center justify-center">{item.kind === "video"
        ? <video src={item.url} controls playsInline className="max-h-full max-w-full" data-testid="lightbox-video" />
        : <SafeImage src={item.url} className="max-h-full max-w-full object-contain" alt={item.caption || item.categoryLabel} />}</div>
      <div className="mx-auto w-full max-w-[640px] space-y-1.5 rounded-card bg-surface p-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2"><SourceBadge source={item.source} /><span className="font-semibold text-ink">{item.categoryLabel}</span></div>
        {item.caption && <p className="m-0 break-words text-ink2 [overflow-wrap:anywhere]">{item.caption}</p>}
        <p className="m-0 text-[12px] text-ink3" data-testid="lightbox-meta">{item.actorName ? `${item.actorName} · ` : ""}{fmtDocTime(item.createdAt)}</p>
        {canCorrect && item.correctable && <Button size="sm" variant="secondary" data-mutates onClick={() => onCorrect(item)}><Pencil size={14} aria-hidden /> Koreksi pengiriman ini</Button>}
      </div>
    </div>
  );
}
