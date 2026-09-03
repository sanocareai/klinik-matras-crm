import React from "react";
import { Clock } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import { salesPersonOf, estimasiDurasiLabel } from "../jobStatus.js";

// ─── Badge Sales Person & Estimasi Durasi (D-043, 2 September 2026) ──────────
// Laporan owner: dispatcher perlu tahu SIAPA sales pemilik order (buat
// koordinasi) + estimasi berapa lama job berlangsung, ditampilkan di 3 tempat
// (tabel Jadwal & Penugasan, JobDetailDrawer, kartu Route Planner) — dibuat
// SEKALI di sini supaya ketiganya identik, bukan 3 gaya berbeda yang gampang
// diam-diam menyimpang.
//
// Kenapa avatar (bukan cuma teks "Sales: Nama") — konsisten dengan pola
// "siapa" di seluruh Delivery Hub (ChipPilih driver/helper, TugaskanDropdown)
// yang sudah dibangun pakai Avatar berwarna, bukan teks polos.
export function SalesBadge({ job, className }) {
  const nama = salesPersonOf(job);
  if (!nama) return null;
  return (
    <span
      title={`Sales: ${nama}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-inset py-1 pl-1 pr-2.5 text-[11px] font-medium text-ink2",
        className
      )}
    >
      <Avatar name={nama} size="sm" className="h-4 w-4 text-[8px]" />
      <span className="truncate">{nama}</span>
    </span>
  );
}

// Amber/oranye SENGAJA dipilih beda dari palet biru/accent chip lain di
// halaman ini (driver/status) — estimasi itu ANGKA PERKIRAAN, bukan fakta
// tercatat seperti status job, jadi nuansanya sengaja "hangat/sementara".
export function EstimasiBadge({ job, className }) {
  const label = estimasiDurasiLabel(job?.estimatedDurationMinutes);
  if (!label) return null;
  return (
    <span
      title="Estimasi durasi pengerjaan"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-orangebg px-2.5 py-1 text-[11px] font-semibold text-orange",
        className
      )}
    >
      <Clock size={11} className="shrink-0" />
      {label}
    </span>
  );
}

// Baris gabungan dua badge di atas, dipakai kalau keduanya wajar tampil
// berdampingan (kartu Route Planner) — return null total kalau dua-duanya
// kosong, supaya tidak menyisakan baris kosong ber-gap di layout flex.
export function JobMetaRow({ job, className }) {
  const nama = salesPersonOf(job);
  const durasi = estimasiDurasiLabel(job?.estimatedDurationMinutes);
  if (!nama && !durasi) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <SalesBadge job={job} />
      <EstimasiBadge job={job} />
    </div>
  );
}
