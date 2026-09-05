import { titleCaseNama } from "@/utils/format.js";
import { hariSejak } from "@/utils/formatDate.js";

// Peta status & tipe job NYATA — dari enum backend (prisma/schema.prisma),
// BUKAN dari data contoh.
//
// ⚠️ SENGAJA TERPISAH dari features/armada/data/deliveryMock.js. File itu
// berisi status versi SPESIFIKASI (10 status, 4 tipe job) yang dipakai
// dashboard contoh. File INI berisi yang benar-benar ada di database hari ini
// (8 status, 2 tipe). Menggabungkannya akan membuat halaman berdata nyata
// menampilkan pilihan filter yang tidak akan pernah cocok dengan baris mana
// pun — filter yang selalu mengembalikan kosong terbaca sebagai sistem rusak.
//
// Kalau backend nanti menambah INSTALLATION/RETURN atau status baru,
// tambahkan DI SINI dan hapus catatan selisihnya di bawah.

// enum JobType — backend baru punya dua.
export const JOB_TYPE_REAL = {
  PICKUP:   { label: "Pengambilan" },
  DELIVERY: { label: "Pengiriman" },
};

// enum JobStatus — PRD §6.3, apa adanya di schema.
export const JOB_STATUS_REAL = {
  UNSCHEDULED: { label: "Belum Dijadwalkan", tone: "neutral" },
  SCHEDULED:   { label: "Terjadwal",         tone: "accent" },
  ASSIGNED:    { label: "Driver Ditugaskan", tone: "accent" },
  EN_ROUTE:    { label: "Menuju Lokasi",     tone: "accent" },
  ARRIVED:     { label: "Tiba di Lokasi",    tone: "accent" },
  COMPLETED:   { label: "Selesai",           tone: "green" },
  FAILED:      { label: "Gagal",             tone: "red" },
  RESCHEDULED: { label: "Dijadwalkan Ulang", tone: "orange" },
};

// Status yang dianggap masih berjalan — sama dengan ACTIVE_JOB_STATUSES di
// backend/src/routes/armada.js. Dipakai tab "Aktif".
export const ACTIVE_STATUSES = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

// Job boleh diedit (driver/kendaraan/tanggal/alamat) lewat PATCH /jobs/:id
// SELAMA statusnya salah satu ini — sama persis dengan guard backend di
// armada.js PATCH /jobs/:id. Dipakai Armada.jsx (JobCard) DAN
// JobDetailDrawer.jsx (30 Agustus 2026, D-036) — satu sumber kebenaran
// supaya dua tempat itu tidak diam-diam beda syarat.
export const EDITABLE_JOB_STATUSES = new Set(["UNSCHEDULED", "SCHEDULED", "ASSIGNED"]);

/**
 * SELISIH SPESIFIKASI vs DATABASE — ditulis di sini supaya tidak hilang.
 *
 * Belum ada di backend, jadi TIDAK ditampilkan sebagai filter di halaman
 * berdata nyata (menampilkannya = filter yang selalu kosong):
 *   · jobType INSTALLATION & RETURN
 *   · status "Sedang Diproses" & "Dibatalkan"
 *   · field `area`, `priority`, `slaStatus`
 *
 * Ketiganya ADA di data contoh dashboard karena di sana memang ilustrasi.
 * Menambahkannya ke sistem nyata butuh migrasi enum + kolom baru — keputusan
 * terpisah, bukan diselundupkan lewat UI.
 */
export const FIELDS_NOT_IN_BACKEND = ["area", "priority", "slaStatus"];

/** Nama customer sebuah job — ada di dua tempat, tergantung endpoint.
 *
 * Dirapikan lewat titleCaseNama() (D-050, 4 September 2026) — sebagian sales
 * mengetik nama pelanggan ALL-CAPS ("HOTEL DISCOVERY ANCOL") sehingga di
 * daftar job ia berteriak lebih keras daripada nama lain di sekitarnya dan
 * merusak ritme baca kolom. Normalisasi ditaruh DI SINI, bukan di tiap
 * pemanggil, karena fungsi ini satu-satunya sumber nama pelanggan untuk
 * seluruh Delivery Hub (dashboard, drawer, JobBadges, RouteCard) — kalau
 * dipasang per-tempat, cepat atau lambat ada layar yang terlewat.
 *
 * TAMPILAN SAJA: nilai di database tidak disentuh, dan helper-nya hanya
 * bertindak pada string yang benar-benar tanpa huruf kecil (lihat catatan di
 * utils/format.js) supaya "Esty Bagus [Cs vina/BDG]" tidak ikut diubah.
 */
export function customerOf(job) {
  return titleCaseNama(
    job?.order?.customer?.name ||
    job?.units?.[0]?.unit?.order?.customer?.name ||
    null
  );
}

// Nomor HP customer — pola fallback SAMA dengan customerOf (job.order
// langsung dulu, jatuh ke jalur berlapis units[].unit.order kalau job.order
// belum ke-load). Dipakai CustomerProfileCard (JobBadges.jsx) untuk tombol
// telepon langsung di kartu identitas pelanggan.
export function customerPhoneOf(job) {
  return (
    job?.order?.customer?.phone ||
    job?.units?.[0]?.unit?.order?.customer?.phone ||
    null
  );
}

export function orderNumberOf(job) {
  return job?.order?.orderNumber || job?.units?.[0]?.unit?.order?.orderNumber || null;
}

export function unitCountOf(job) {
  return job?.units?.length || 0;
}

// Kota tujuan (D-058, 4 September 2026 — laporan owner: bantu dispatcher
// mengelompokkan job searah di Route Planner). Dari Order.deliveryCity
// (dropdown kota tetap yang diisi sales) — BUKAN dari Job.addressText, yang
// teks bebas snapshot alamat lengkap, tidak konsisten dijadikan kunci
// pengelompokan. Pola fallback SAMA dengan customerOf/orderNumberOf.
export function cityOf(job) {
  return job?.order?.deliveryCity || job?.units?.[0]?.unit?.order?.deliveryCity || null;
}

// ─── Route Planner card identification (redesain Sep 2026) ─────────────────
// Pola fallback SAMA dengan cityOf/customerOf di atas — job.order langsung
// dulu, jatuh ke jalur berlapis units[].unit.order kalau job.order belum
// ke-load (backend jobInclude/GET-jobs order.select ditambahkan field yang
// sama di kedua jalur, lihat armada.js).

// Order kategori SEWA (kasur sewa, prefix ID "SWS") — alur retur/pengambilan
// beda dari LAYANAN/BARU biasa, dispatcher perlu tahu sekilas dari kartu
// tanpa buka drawer. Lihat CLAUDE.md §7D untuk arti kategori ini.
export function isRentalOrder(job) {
  return (job?.order?.category || job?.units?.[0]?.unit?.order?.category) === "SEWA";
}

// Label layanan/produk ringkas ("apa yang dikerjakan di order ini") — dari
// OrderItem pertama (sortOrder asc), bukan rincian lengkap add-on (kartu
// Route Planner ruang sempit, cukup satu baris untuk konteks cepat).
export function serviceLabelOf(job) {
  return job?.order?.items?.[0]?.layananName || job?.units?.[0]?.unit?.order?.items?.[0]?.layananName || null;
}

// Tanggal PASTI pengambilan/pengiriman — dari Order.pickupConfirmedDate/
// deliveryConfirmedDate (DateTime asli, diisi BELAKANGAN setelah dispatcher
// konfirmasi ke customer), BUKAN dari pickupEstimate/deliveryEstimate (teks
// bebas, "Agustus 2026" dsb — tidak bisa dijadikan tanggal presisi, sama
// disiplin dengan isJobOverdue soal timeWindow). null = belum dikonfirmasi,
// pemanggil yang putuskan mau tampil apa (bukan dipaksa tampil tanggal kosong).
export function confirmedDateOf(job) {
  const order = job?.order || job?.units?.[0]?.unit?.order;
  if (!order) return null;
  return job?.type === "PICKUP" ? (order.pickupConfirmedDate || null) : (order.deliveryConfirmedDate || null);
}

// Sales yang pegang order ini (D-043, 2 September 2026 — laporan owner:
// dispatcher perlu tahu siapa sales-nya buat koordinasi). Pola fallback
// SAMA dengan customerOf/orderNumberOf — job.order langsung dulu, jatuh ke
// jalur berlapis units[].unit.order kalau job.order belum ke-load.
export function salesPersonOf(job) {
  return (
    job?.order?.customer?.assignedSales?.name ||
    job?.units?.[0]?.unit?.order?.customer?.assignedSales?.name ||
    null
  );
}

// Label ringkas estimasi durasi ("~30 menit", "~2 jam", "~1,5 jam") dari
// Job.estimatedDurationMinutes (D-043). null/0 -> null (biar pemanggil
// putuskan sendiri mau tampil apa saat belum diisi, bukan dipaksa "-").
export function estimasiDurasiLabel(minutes) {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `~${minutes} menit`;
  const jam = minutes / 60;
  const dibulatkan = Math.round(jam * 2) / 2; // kelipatan 0,5 jam
  const teks = Number.isInteger(dibulatkan) ? `${dibulatkan}` : dibulatkan.toFixed(1).replace(".", ",");
  return `~${teks} jam`;
}

// Preset durasi umum untuk chip picker (D-043) — dalam menit. Dipakai
// JobDetailDrawer supaya dispatcher tinggal ketuk, bukan ketik angka manual
// untuk kasus paling umum (custom tetap bisa lewat input angka).
export const ESTIMASI_DURASI_PRESET = [
  { menit: 30, label: "30 menit" },
  { menit: 60, label: "1 jam" },
  { menit: 90, label: "1,5 jam" },
  { menit: 120, label: "2 jam" },
  { menit: 180, label: "3 jam" },
  { menit: 240, label: "Setengah hari" },
];

// Link Google Maps satu sumber kebenaran (D-040, 31 Agustus 2026 — sebelum
// ini disalin 2x persis sama di Armada.jsx & DriverJobs.jsx, gampang diam-
// diam beda kalau salah satu diubah). Utamakan koordinat hasil geocode
// (akurat, pin persis) — fallback ke pencarian teks alamat kalau job belum
// sempat di-geocode (tetap berfungsi, cuma Google yang mencari sendiri).
// TIDAK butuh API key/billing — ini URL publik `maps/dir` biasa.
export function mapsUrl(job) {
  if (job?.lat && job?.lng) return `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`;
  if (job?.addressText) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.addressText)}`;
  return null;
}

// Label ringkas manusiawi untuk 1 job (D-037 lanjutan, 31 Agustus 2026 —
// laporan owner: kolom "Job" cuma tampil 8 karakter acak dari cuid,
// "a4d74468" dst, tidak bisa disebut ke driver/customer). Job SELALU
// menempel ke 1 order (lihat Job.orderId, RESTRICT), jadi cukup pinjam
// nomor urut order + jenis job — TIDAK bikin counter/migrasi baru.
// Contoh: order "RES-31082026-218" tipe PICKUP -> "218-Ambil".
const JOB_TYPE_SINGKAT = { PICKUP: "Ambil", DELIVERY: "Kirim" };

export function jobLabelOf(job) {
  const orderNumber = orderNumberOf(job);
  const jenis = JOB_TYPE_SINGKAT[job?.type] || job?.type || "?";
  if (!orderNumber) return job?.id ? job.id.slice(0, 8) : "—"; // fallback data lawas tanpa orderNumber
  const urut = orderNumber.split("-").pop(); // segmen terakhir "NNN" dari PREFIX-DDMMYYYY-NNN
  return `${urut}-${jenis}`;
}

// ─── SLA — job terlambat (redesain Sep 2026, docs/ARMADA-REDESIGN-2026.md) ──
//
// BEDA dari panel "Perlu Dijadwalkan" Dashboard (hariMenunggu, ambang 7 hari,
// D-050): itu menandai job yang BELUM PERNAH punya scheduledDate sama sekali
// — backlog penjadwalan. Ini menandai job yang SUDAH dapat scheduledDate,
// hari itu SUDAH LEWAT, tapi statusnya masih aktif (bukan COMPLETED/FAILED/
// RESCHEDULED) — janji yang sudah dibuat ke tanggal tertentu tapi tidak
// pernah dituntaskan. Dua sinyal berbeda, jangan digabung jadi satu.
//
// SENGAJA cuma level HARI (scheduledDate, DATE column), bukan intraday
// terhadap timeWindow — timeWindow adalah teks bebas ("pagi", "10-12"),
// tidak ada kolom jam target terstruktur untuk dibandingkan (catatan sama
// dengan disclaimer "Ketepatan waktu" di ArmadaDeliveryReport.jsx). Memaksa
// presisi jam dari field yang tidak presisi akan mengarang data, bukan
// mengukurnya.
export function isJobOverdue(job) {
  if (!job?.scheduledDate || !job?.status) return false;
  if (!ACTIVE_STATUSES.includes(job.status)) return false;
  return hariSejak(job.scheduledDate) > 0;
}

// Jumlah hari sejak scheduledDate — cuma valid dipanggil kalau isJobOverdue()
// sudah true (tidak divalidasi ulang di sini, biar tidak dihitung dua kali).
export function overdueDays(job) {
  return hariSejak(job.scheduledDate);
}