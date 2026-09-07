import React from "react";
import {
  Clock, Phone, PackageOpen, Truck, RotateCcw, CalendarCheck2, MapPinned,
  Wrench, PackageCheck, CheckCircle2, XCircle, Hourglass, MapPinOff,
} from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import {
  salesPersonOf, estimasiDurasiLabel, customerOf, customerPhoneOf,
  isRentalOrder, serviceLabelOf, cityOf, orderStatusOf, orderOf,
  salesLocationUrl, ACTIVE_STATUSES,
} from "../jobStatus.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { ORDER_STATUS_LABELS, orderStatusVariant } from "@/utils/format.js";

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
// Pengiriman = HIJAU TERISI (6 September 2026, perintah eksplisit owner:
// "ubah aja codenya setiap status pengiriman itu dapet badge hijau" — akar
// masalah sesi ini panjang: komponen ini SUDAH ADA dari redesain sebelumnya
// tapi TIDAK PERNAH benar-benar dipasang di RouteCard.jsx/UnroutedJobsPanel.jsx
// [diverifikasi: nol pemanggil di luar file ini], jadi satu-satunya sinyal
// tipe job di Route Planner selama ini cuma glow garis kiri 3px yang HALUS
// [jobAccentBarStyle] — gampang tidak kelihatan sama sekali, itu sebabnya
// owner berkali-kali melaporkan "kok ga ada hijau" walau job Pengiriman
// SEBENARNYA sudah dapat warna di garis kiri). Sekarang badge INI dipasang
// eksplisit di kedua panel (lihat RouteCard.jsx/UnroutedJobsPanel.jsx), dan
// Pengiriman-nya SENGAJA hijau terisi — bukan garis netral lagi seperti
// versi lama (aturan "palet dibatasi" tetap dipegang, cuma tidak lagi
// menghindari hijau untuk Pengiriman — itu keputusan LAMA yang sekarang
// eksplisit ditimpa owner, bukan dilanggar diam-diam).
export function JobTypeBadge({ job, className }) {
  const pickup = job?.type === "PICKUP";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        pickup ? "bg-accentbg text-accent" : "bg-greenbg text-green",
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
//
// Label diperjelas jadi "Pasti Ambil"/"Pasti Kirim" (6 September 2026,
// laporan owner — contoh nyata Cst VERA: badge "Pasti: 1 Sep" datanya SUDAH
// BENAR [ikut job.type di bawah, bukan salah ambil field], tapi teks yang
// KELIHATAN cuma "Pasti" polos — dispatcher yang scan cepat lintas kartu
// Pengambilan+Pengiriman campur tidak bisa tahu ini janji ambil atau janji
// kirim tanpa hover ke tooltip. SEBELUM ini keterangan jenisnya cuma ada di
// `title` (hover), sekarang ikut ada di teks yang langsung kelihatan.
//
// TAMPILKAN KEDUANYA (6 September 2026, laporan owner lanjutan — kartu Cst
// VERA di Route Planner cuma menampilkan "Pasti Ambil", padahal Tanggal
// Kirim-nya JUGA sudah dikonfirmasi (7 Sep) — dispatcher scan kartu tidak
// tahu order ini juga sudah punya janji kirim tanpa buka drawer). Dulu cuma
// SATU badge yang ikut job.type job ini; sekarang KEDUA tanggal [pickup DAN
// delivery confirmed date, kalau ada] dirender berdampingan, sama seperti
// keputusan yang sama di JobDetailDrawer — badge yang ikut tipe job INI
// digarisbawahi (font-bold) supaya tetap jelas mana yang paling relevan
// untuk kartu yang sedang dilihat, tanpa menyembunyikan yang satunya lagi.
export function ConfirmedTimeBadge({ job, className }) {
  const order = orderOf(job);
  const ambil = order?.pickupConfirmedDate || null;
  const kirim = order?.deliveryConfirmedDate || null;
  if (!ambil && !kirim) return null;
  const pickupJob = job?.type === "PICKUP";
  return (
    <span className={cn("inline-flex shrink-0 flex-wrap items-center gap-1", className)}>
      {ambil && (
        <span
          title="Tanggal pengambilan PASTI, sudah dikonfirmasi ke pelanggan"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full bg-greenbg px-2 py-0.5 text-[10.5px] text-green",
            pickupJob ? "font-bold" : "font-semibold"
          )}
        >
          <CalendarCheck2 size={11} className="shrink-0" /> Pasti Ambil: {formatTanggalPendek(ambil)}
        </span>
      )}
      {kirim && (
        <span
          title="Tanggal pengiriman PASTI, sudah dikonfirmasi ke pelanggan"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full bg-greenbg px-2 py-0.5 text-[10.5px] text-green",
            !pickupJob ? "font-bold" : "font-semibold"
          )}
        >
          <CalendarCheck2 size={11} className="shrink-0" /> Pasti Kirim: {formatTanggalPendek(kirim)}
        </span>
      )}
    </span>
  );
}

// Label kota (Order.deliveryCity) — penanda TAMBAHAN per-kartu (laporan
// owner: "setiap card/order customer bisa tambah label kota"), MELENGKAPI
// (bukan menggantikan) pengelompokan per kota di UnroutedJobsPanel — di
// sana kota sudah jadi header section, TAPI RouteCard.jsx (stop rute) dan
// daftar Jadwal & Penugasan TIDAK punya pengelompokan kota sama sekali,
// jadi dispatcher tidak bisa tahu sekilas apakah stop-stop dalam satu rute
// searah tanpa buka alamat lengkap satu-satu. Netral (ink3/inset) SENGAJA
// — ini info kontekstual, bukan status/kategori yang perlu menonjol warna
// seperti JobTypeBadge/RentalBadge. null kalau Order.deliveryCity belum
// diisi (lihat catatan panjang soal Esty Bagus di UnroutedJobsPanel.jsx) —
// TIDAK menampilkan "Kota belum diisi" di sini, itu urusan section "Belum
// Ada Kota" di panel yang memang mengelompokkan berdasarkan kota.
export function CityBadge({ job, className }) {
  const kota = cityOf(job);
  if (!kota) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-inset px-2 py-0.5 text-[10.5px] font-semibold text-ink2",
        className
      )}
    >
      <MapPinned size={11} className="shrink-0" /> {kota}
    </span>
  );
}

// Order BELUM punya link Google Maps (7 September 2026 — investigasi
// laporan owner: "Buat Peta" di Route Planner "mental kemana-mana"). Akar
// masalahnya: rute dibangun dari koordinat hasil TEBAKAN geocoding alamat
// teks (Nominatim/LocationIQ, sering meleset untuk alamat Indonesia
// detail) karena order-nya tidak/belum punya Order.locationUrl — link
// Maps yang sales/admin dapat LANGSUNG dari customer, jauh lebih akurat
// (lihat catatan panjang di services/maps.js#geocodeAddress). Badge ini
// TIDAK memperbaiki koordinatnya sendiri — cuma menandai dispatcher supaya
// tahu job mana yang perlu di-follow-up ke sales untuk minta link Maps-nya,
// SESUAI PERMINTAAN OWNER ("kasih notifikasi, nanti admin delivery akan
// follow up ke sales"), bukan dikira-kira otomatis.
//
// Sengaja HANYA tampil untuk job yang masih AKTIF (ACTIVE_STATUSES) — job
// yang sudah selesai/gagal tidak lagi butuh rute akurat, menandainya juga
// cuma menambah noise di kartu riwayat.
export function MapsLinkMissingBadge({ job, className }) {
  if (salesLocationUrl(job) || !ACTIVE_STATUSES.includes(job?.status)) return null;
  return (
    <span
      title="Order ini belum punya link Google Maps dari customer — rute bisa meleset. Follow up ke sales."
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-orangebg px-2 py-0.5 text-[10.5px] font-semibold text-orange",
        className
      )}
    >
      <MapPinOff size={11} className="shrink-0" /> Tanpa link Maps
    </span>
  );
}

// Status ORDER (Menunggu/Pengambilan/Diproses/Siap Kirim/Pengiriman/
// Terkirim/dst) — 6 September 2026, laporan owner: "bisa tambahkan status
// order nya apakah siap kirim, pengambilan dan lainnya". SENGAJA beda dari
// JobTypeBadge/status Job di atas — itu status ARMADA (Belum Dijadwalkan/
// Ditugaskan/dst), ini status ORDER di sisi produksi/fulfillment, dua alur
// yang beda. Pakai Badge + orderStatusVariant dari utils/format.js (BUKAN
// tone kustom seperti badge lain di file ini) SUPAYA warnanya identik
// dengan tampilan status order di halaman lain (Orders.jsx, Pipeline.jsx,
// dst) — status yang sama harus selalu kelihatan sama di seluruh app.
//
// Ikon per status (6 September 2026, laporan owner: "boleh masing-masing
// label warnanya dibedakan") — JobTypeBadge (Pengambilan/Pengiriman) baru
// saja DICABUT dari kartu-kartu ini karena dobel dengan badge ini (laporan
// owner sebelumnya), jadi badge ini sekarang SATU-SATUNYA penanda status
// yang tampil. Tapi 4 dari 6 status LAYANAN/BARU (PICKUP/PROCESSING/READY/
// SHIPPING) sengaja SATU warna "accent" saja di badgeVariants (aturan Sano
// DS v2: cuma 4 hue boleh — orange/accent/green/neutral, lihat komentar di
// components/ui/badge.jsx) — kalau cuma warna, dispatcher tidak bisa bedakan
// 4 status tengah itu sekilas. TIDAK melanggar aturan 4-hue itu (warnanya
// TETAP sama dengan tampilan status order di halaman lain) — pembedanya
// ikon, bukan warna baru, pola SAMA dengan "jangan andalkan warna sendirian"
// yang sudah dipakai StatusBadge.jsx/JobTypeBadge di file ini.
const ORDER_STATUS_ICON = {
  PENDING: Hourglass,
  PICKUP: PackageOpen,
  PROCESSING: Wrench,
  READY: PackageCheck,
  SHIPPING: Truck,
  DELIVERED: CheckCircle2,
  CANCELLED: XCircle,
  SEWA_DIKIRIM: Truck,
  SEWA_DIAMBIL: RotateCcw,
};

export function OrderStatusBadge({ job, className }) {
  const status = orderStatusOf(job);
  if (!status) return null;
  const Ikon = ORDER_STATUS_ICON[status];
  return (
    <Badge variant={orderStatusVariant(status)} className={cn("shrink-0", className)}>
      {Ikon && <Ikon size={11} className="shrink-0" />}
      {ORDER_STATUS_LABELS[status] || status}
    </Badge>
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
