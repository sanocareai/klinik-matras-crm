import React from "react";
import { Hammer, MapPin, ShoppingBag, Workflow } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { nadaBadge } from "@/features/production/orderProduksiModel.js";
import { teksTahapMeja } from "@/features/production/workspace/workListModel.js";

// Empat makna status yang TIDAK dicampur — selalu berpasangan dengan KATA PENGENAL + IKON + bentuk yang berbeda (bukan hanya warna):
//   Order Sales (tas belanja) · Posisi fisik (pin) · Status kerja (palu) · Tahap Meja (alur).
// Teks pengenal wajib tampil agar jelas "ini status apa" tanpa bergantung warna.
const NADA = {
  neutral: "bg-inset text-ink2", accent: "bg-accentbg text-accent", orange: "bg-orangebg text-orange", green: "bg-greenbg text-green", red: "bg-redbg text-red",
};
export const JENIS_STATUS = Object.freeze({
  order: { label: "Order Sales", Ikon: ShoppingBag, bentuk: "rounded-chip" },
  posisi: { label: "Posisi", Ikon: MapPin, bentuk: "rounded-chip" },
  kerja: { label: "Kerja", Ikon: Hammer, bentuk: "rounded-chip" },
  meja: { label: "Tahap Meja", Ikon: Workflow, bentuk: "rounded-chip" },
});

/** Satu penanda: [ikon KATA PENGENAL] nilai. `nada` = neutral|accent|orange|green|red dari server. */
export function Penanda({ jenis, nilai, nada = "neutral", terkunci = false, padat = false, title, className, ...rest }) {
  const def = JENIS_STATUS[jenis]; const Ikon = def.Ikon;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 px-2 py-1 text-[12px] leading-tight", def.bentuk, NADA[nadaBadge(nada)], className)} title={title ?? `${def.label}: ${nilai}`} data-status-jenis={jenis} {...rest}>
      <Ikon size={12} className="shrink-0 opacity-80" aria-hidden />
      <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.05em] opacity-75">{def.label}</span>
      <span className={cn("min-w-0 font-semibold", padat ? "truncate" : "")}>{nilai}</span>
      {terkunci && <span className="shrink-0 text-[10px] font-medium uppercase opacity-75">· dikunci</span>}
    </span>
  );
}

/** Empat penanda untuk satu unit. `statusOrder` (dari order) boleh dihilangkan untuk baris unit di dalam order (sudah ada di baris order). */
export function EmpatStatus({ statusOrder = null, posisi = null, kerja = null, alurMeja = undefined, padat = false, className }) {
  const meja = alurMeja === undefined ? null : teksTahapMeja(alurMeja);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid="empat-status">
      {statusOrder && <Penanda jenis="order" nilai={statusOrder.label} nada={statusOrder.nada ?? (statusOrder.mentah === "PICKUP" || statusOrder.mentah === "PENDING" ? "orange" : statusOrder.key === "DIPROSES" ? "accent" : statusOrder.key === "SIAP_KIRIM" || statusOrder.key === "TERKIRIM" ? "green" : "neutral")} terkunci={statusOrder.terkunci} padat={padat} />}
      {posisi && <Penanda jenis="posisi" nilai={posisi.label} nada={posisi.tone} padat={padat} title={posisi.detail ? `Posisi: ${posisi.label} — ${posisi.detail}` : undefined} />}
      {kerja && <Penanda jenis="kerja" nilai={kerja.label} nada={kerja.tone} padat={padat} title={kerja.detail ? `Kerja: ${kerja.label} — ${kerja.detail}` : undefined} />}
      {meja && <Penanda jenis="meja" nilai={meja.teks} nada={meja.ada ? "accent" : "neutral"} padat={padat} />}
    </div>
  );
}
