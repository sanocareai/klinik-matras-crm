import React from "react";
import { Clock, Phone, PackageOpen, Truck, RotateCcw, CalendarCheck2 } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { cn } from "@/lib/utils.js";
import {
  salesPersonOf, estimasiDurasiLabel, customerOf, customerPhoneOf,
  isRentalOrder, serviceLabelOf, confirmedDateOf,
} from "../jobStatus.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";

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
      <Avatar name={nama} size="sm" gradient className="h-4 w-4 text-[8px]" />
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

// ─── Identifikasi kartu Route Planner (redesain Sep 2026) ───────────────────
// Palet dibatasi (docs/design-system/sano-color-system.md — hanya
// accent/red/orange/green, dekoratif lain SENGAJA dilebur ke accent, lihat
// --color-chart-violet/-ai-violet di tokens.css yang keduanya = var(--accent)
// bukan warna violet sungguhan). Jadi pembeda visual di sini TIDAK menambah
// hue baru — Pengambilan pakai chip TERISI (accent), Pengiriman pakai chip
// GARIS (outline, netral); ikon + label beda juga, bukan warna doang
// (aturan "jangan andalkan warna sendirian" — lihat StatusBadge.jsx).
export function JobTypeBadge({ job, className }) {
  const pickup = job?.type === "PICKUP";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        pickup ? "bg-accentbg text-accent" : "border border-border text-ink2",
        className
      )}
    >
      {pickup ? <PackageOpen size={11} className="shrink-0" /> : <Truck size={11} className="shrink-0" />}
      {pickup ? "Pengambilan" : "Pengiriman"}
    </span>
  );
}

// Order kategori SEWA — orange (bukan warna baru, tone yang sudah ada),
// dipakai TERBATAS di sini karena SEWA memang jarang dibanding LAYANAN/BARU,
// jadi kecil risiko ketuker dengan badge status RESCHEDULED (juga orange)
// di kartu yang sama — bentuknya beda (pil bertitik ikon RotateCcw + teks
// "Sewa" pendek) dan posisinya berdampingan dengan JobTypeBadge, bukan di
// tempat status job.
export function RentalBadge({ job, className }) {
  if (!isRentalOrder(job)) return null;
  return (
    <span
      title="Order kategori Sewa — alur retur/pengambilan ulang beda dari order biasa"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-orangebg px-2 py-0.5 text-[10.5px] font-semibold text-orange",
        className
      )}
    >
      <RotateCcw size={11} className="shrink-0" /> Sewa
    </span>
  );
}

// Tanggal PASTI (Order.pickupConfirmedDate/deliveryConfirmedDate) — hijau,
// beda dari EstimasiBadge (oranye = perkiraan): ini FAKTA yang sudah
// disepakati ke customer, bukan angka perkiraan. null (belum dikonfirmasi)
// = tidak render apa-apa, bukan tempelan "Belum pasti" di setiap kartu.
export function ConfirmedTimeBadge({ job, className }) {
  const tanggal = confirmedDateOf(job);
  if (!tanggal) return null;
  return (
    <span
      title={`Tanggal ${job?.type === "PICKUP" ? "pengambilan" : "pengiriman"} PASTI, sudah dikonfirmasi ke pelanggan`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-greenbg px-2 py-0.5 text-[10.5px] font-semibold text-green",
        className
      )}
    >
      <CalendarCheck2 size={11} className="shrink-0" /> Pasti: {formatTanggalPendek(tanggal)}
    </span>
  );
}

// Label layanan/produk ringkas — teks biasa (BUKAN badge/pil), sengaja
// dipisah dari baris badge di atas: ini konteks ("apa yang dikerjakan"),
// bukan status/penanda yang perlu menonjol dengan warna.
export function ServiceLabel({ job, className }) {
  const label = serviceLabelOf(job);
  if (!label) return null;
  return <p className={cn("truncate text-[10.5px] text-ink3", className)}>{label}</p>;
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

// Kartu identitas pelanggan (D-047, 4 September 2026 — laporan owner: "buat
// seperti artifacts", showcase #2 mockup "Profil Pelanggan"). MENGGANTIKAN
// dua baris `Baris` terpisah (Sales Person, Kontak) di JobDetailDrawer —
// satu kartu avatar-forward, bukan dua baris tabel data yang harus dipindai
// terpisah untuk tahu "siapa yang saya hubungi dan lewat siapa".
//
// Avatar pakai ring accent (bukan polos) supaya kartu ini terasa seperti
// identitas utama panel, sejajar dengan avatar driver/helper di ChipPilih
// — bukan sekadar ikon dekoratif.
export function CustomerProfileCard({ job, className }) {
  const nama = customerOf(job);
  const telepon = customerPhoneOf(job);
  const sales = salesPersonOf(job);
  if (!nama) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-card bg-surface p-3.5 shadow-card",
        className
      )}
    >
      <Avatar
        name={nama}
        gradient
        size="lg"
        className="shadow-[0_0_0_3px_var(--accent-bg)]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-ink">{nama}</p>
        {telepon ? (
          <a
            href={`tel:${telepon}`}
            className="truncate text-[13px] font-medium text-ink2 hover:text-accent hover:underline"
          >
            {telepon}
          </a>
        ) : (
          <p className="text-[13px] text-ink3">Nomor HP belum ada</p>
        )}
        {sales && <SalesBadge job={job} className="mt-1.5" />}
      </div>
      {telepon && (
        <a
          href={`tel:${telepon}`}
          aria-label={`Telepon ${nama}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-transform hover:scale-105 active:scale-95"
        >
          <Phone size={17} strokeWidth={2.25} />
        </a>
      )}
    </div>
  );
}
