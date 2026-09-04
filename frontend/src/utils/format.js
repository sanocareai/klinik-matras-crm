// ─── TANGGAL: SEMUA DIDELEGASIKAN KE utils/formatDate.js ─────────────────────
// Helper tanggal di file ini dulunya memakai `toLocaleDateString()` langsung,
// artinya hasilnya mengikuti timezone DEVICE. Sekarang semuanya tipis saja —
// meneruskan ke formatDate.js yang men-pin Asia/Jakarta. Nama lama
// DIPERTAHANKAN supaya ~20 pemanggil yang sudah ada tidak perlu diubah dan
// langsung ikut benar. Untuk komponen BARU, impor langsung dari formatDate.js.
import {
  formatTanggalLengkap, formatJam, formatRelatif, formatTanggalPendek,
  formatRentangTanggal, formatLabelBulan, hariSejak, toWIB,
} from "./formatDate.js";
import { makeRange } from "../lib/dateRange.js";

export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

// Singkatan untuk ruang terbatas (dashboard KPI card, chart)
export function formatRupiahShort(n) {
  const v = n || 0;
  if (v >= 1_000_000) return "Rp" + (v / 1_000_000).toFixed(1) + "jt";
  if (v >= 1_000) return "Rp" + (v / 1_000).toFixed(0) + "rb";
  return "Rp" + v;
}

// Format nomor HP untuk tampilan: "6281234567890" → "+62 812-3456-7890"
export function formatPhoneDisplay(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 10) {
    const local = digits.slice(2);
    const a = local.slice(0, 3);
    const b = local.slice(3, 7);
    const c = local.slice(7);
    return "+62 " + [a, b, c].filter(Boolean).join("-");
  }
  return "+" + digits;
}

export function formatTanggalIndo(date = new Date()) {
  return formatTanggalLengkap(date);
}

export function formatWaktu(dateString) {
  return dateString ? formatJam(dateString) : "";
}

export function formatTanggalWaktu(dateString) {
  return dateString ? formatRelatif(dateString) : "";
}

// Timestamp pintar untuk item daftar percakapan (gaya WhatsApp):
// hari ini → jam, minggu ini → nama hari, lebih lama → tanggal pendek.
// Semua perbandingan hari memakai kalender WIB, bukan kalender device.
const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export function formatConvTimestamp(dateString) {
  if (!dateString) return "";
  const d = toWIB(dateString);
  const diffHari = hariSejak(dateString);

  if (diffHari <= 0) return formatJam(dateString);
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return HARI_ID[d.day()];
  return formatTanggalPendek(dateString);
}

// Map "YYYY-MM" → nama bulan Indonesia singkat
export const MONTH_LABELS_ID = [
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
export const labelBulan = formatLabelBulan;

export function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ").filter(Boolean);
  // name bisa berisi spasi/karakter kosong doang (mis. sinkron kontak WA
  // yang pushName-nya blank) — trim+filter di atas jadi array KOSONG,
  // bukan cuma "1 kata". Tanpa guard ini, parts[0][0] error karena
  // parts[0] undefined (bug nyata production 20 Agt 2026: 1 customer
  // bernama " " bikin seluruh tabel Pelanggan blank).
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  { bg: "#ede9fe", text: "#5b21b6" }, // purple
  { bg: "#dbeafe", text: "#1e40af" }, // blue
  { bg: "#dcfce7", text: "#166534" }, // green
  { bg: "#fce7f3", text: "#9d174d" }, // pink
  { bg: "#ffedd5", text: "#9a3412" }, // orange
];

export function avatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Warna chip per tag (deterministic berdasarkan text tag)
const TAG_CLASSES = ["tag-purple", "tag-blue", "tag-green", "tag-pink", "tag-orange"];
export function tagClass(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_CLASSES[Math.abs(hash) % TAG_CLASSES.length];
}

// Revisi 26 Jul 2026: 5 stage (LEAD/QUALIFIED/QUOTED/WON/LOST) → 8 stage yang
// mengikuti exit-criteria operasional nyata. LOST dihapus dari pipeline utama
// (data lama dipetakan ke QUALIFIED lewat migrasi backend).
// Revisi 30 Jul 2026: PAID dihapus (8 → 7 stage) — redundan dengan
// Order.paymentStatus (BELUM_BAYAR/DP/LUNAS) yang sudah ada per-order.
// Revisi 24 Agustus 2026: 7 stage → 4 (NEW/PROSPECT/TRANSACTION/SPAM).
// Order.status sekarang men-track progres operasional secara independen
// (PENDING/PICKUP/PROCESSING/READY/DELIVERED), jadi pipelineStage cukup
// menjawab posisi lead di funnel — QUALIFIED+QUOTED digabung PROSPECT,
// BOOKED/SCHEDULED/COMPLETED/REVIEWED digabung TRANSACTION. SPAM baru:
// chat junk/salah sasaran, DIKECUALIKAN dari perhitungan Closing Rate.
// Revisi 26 Agustus 2026: REVIEWED dikembalikan (permintaan owner) — 4 → 5
// stage. SENGAJA BUKAN definisi lama ("pekerjaan selesai + ditinjau
// internal", yang digabung ke TRANSACTION di atas). Definisi BARU: pelanggan
// yang sudah kasih testimoni/review PUBLIK (Google Maps, atau tag di media
// sosial) — milestone SETELAH TRANSACTION, ditandai manual oleh sales/admin.
// Lihat backend/prisma/schema.prisma untuk mapping data lengkap.
export const STAGE_LABELS = {
  NEW: "New",
  PROSPECT: "Prospek / Potensi",
  TRANSACTION: "Scheduled / Transaksi",
  REVIEWED: "Already Reviewed",
  SPAM: "Spam",
};

export const ORDER_STATUS_LABELS = {
  PENDING: "Menunggu",
  PICKUP: "Pengambilan",
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
  // Status KHUSUS kategori SEWA (4 Sep 2026) — lihat orderStatusesForCategory
  // & ORDER_STATUS_BUCKET di bawah. Order SEWA tidak pernah memakai 5 status
  // di atas.
  SEWA_DIKIRIM: "Pengiriman",
  SEWA_DIAMBIL: "Pengambilan",
};

// ⚠️ "Meta Ads" TANPA embel-embel "(FB/IG)". Facebook & Instagram dipisah
// lewat kolom PLATFORM tersendiri (diturunkan dari leadSourceDetail, lihat
// backend/src/services/platformIklan.js) — bukan dijejalkan ke satu label.
// Menggabungnya jadi "Meta Ads (FB/IG)" membuat laporan terbaca seolah
// keduanya tidak bisa dibedakan sama sekali, padahal untuk lead baru
// (CTWA, sejak 13 Agt 2026) platformnya SUDAH diketahui pasti.
export const SOURCE_LABELS = {
  META_ADS:        "Meta Ads",
  GOOGLE_ADS:      "Google Ads",
  WEBSITE_ORGANIC: "Website Organik",
  INSTAGRAM:       "Instagram Organik",
  WHATSAPP_DIRECT: "WhatsApp Langsung",
  REFERRAL:        "Referral",
  OTHER:           "Lainnya",
  // Enum lama — tetap dipetakan agar data customer lama tampil benar
  ADS:     "Iklan",
  WEBSITE: "Website",
};

// Opsi dropdown untuk customer baru (hanya enum aktif, bukan yang deprecated)
export const LEAD_SOURCES = [
  { value: "META_ADS",        label: "Meta Ads" },
  { value: "GOOGLE_ADS",      label: "Google Ads" },
  { value: "WEBSITE_ORGANIC", label: "Website Organik" },
  { value: "INSTAGRAM",       label: "Instagram Organik" },
  { value: "WHATSAPP_DIRECT", label: "WhatsApp Langsung" },
  { value: "REFERRAL",        label: "Referral" },
  { value: "OTHER",           label: "Lainnya" },
];

export const PAYMENT_STATUS_LABELS = {
  BELUM_BAYAR: "Belum Bayar",
  DP:          "DP",
  LUNAS:       "Lunas",
};

export const PAYMENT_STATUS_BADGE = {
  BELUM_BAYAR: { background: "#fef2f2", color: "#dc2626" },
  DP:          { background: "#fff7ed", color: "#f97316" },
  LUNAS:       { background: "#f0fdf4", color: "#16a34a" },
};

export const PAYMENT_STATUSES = ["BELUM_BAYAR", "DP", "LUNAS"];

export const PIPELINE_STAGES = Object.entries(STAGE_LABELS).map(([v, l]) => ({ value: v, label: l }));

export const ORDER_STATUSES = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

// Order kategori BARU (D-051, 4 September 2026 — laporan owner: "layanan
// baru itu bikin produk/kasur baru, prosesnya beda dari service/upgrade,
// statusnya cuma 3: Diproses/Siap Kirim/Terkirim"). MENGGANTI/PICKUP tidak
// masuk akal untuk order ini — tidak ada barang fisik lama yang diambil
// dari customer, unit-nya lahir langsung "diterima" di workshop (lihat
// backend unitProvisioning.js#createUnitsForOrder). CANCELLED tetap
// disediakan sebagai jalan keluar (order boleh dibatalkan kapan pun,
// terlepas kategorinya), bukan bagian dari 3 tahap normal.
//
// Dipakai KHUSUS untuk dropdown "Ubah Status" per-order (OrderSection.jsx)
// — filter GLOBAL di tabel Order (Orders.jsx) TETAP pakai ORDER_STATUSES
// penuh, karena tabel itu menampilkan order LINTAS kategori sekaligus dan
// semua 6 nilai tetap valid untuk DICARI (order LAYANAN/SEWA lama masih
// bisa berstatus PENDING/PICKUP).
// SEWA (4 Sep 2026) TIDAK ikut sistem status Unit/Bengkel sama sekali (lihat
// guard category==="SEWA" di backend/src/services/orderStatusSync.js) — cuma
// 2 status manual: kasur sedang dipakai customer (Pengiriman), atau sudah
// diambil kembali (Pengambilan). Dicek DULUAN, sebelum cabang BARU.
export function orderStatusesForCategory(category) {
  if (category === "SEWA") return ["SEWA_DIKIRIM", "SEWA_DIAMBIL", "CANCELLED"];
  return category === "BARU" ? ["PROCESSING", "READY", "DELIVERED", "CANCELLED"] : ORDER_STATUSES;
}

// ── WARNA STATUS DOMAIN — SATU SUMBER KEBENARAN (Sano Design System v1) ──────
// Sebelumnya warna badge status di-hardcode tersebar di banyak halaman (rawan
// drift, mis. label "Penawaran" nyangkut di satu tempat). Sekarang setiap
// domain memetakan nilai enum → NAMA VARIANT komponen <Badge> (lihat
// components/ui/badge.jsx). Halaman yang sudah migrasi cukup:
//   <Badge variant={stageVariant(stage)}>{STAGE_LABELS[stage]}</Badge>
// Pemetaan warna mengikuti sano-color-system.md §4 & CLAUDE.md §10.
// PENTING: kunci ORDER_STATUS_VARIANT mengikuti enum NYATA di kode
// (PENDING/PICKUP/... dari ORDER_STATUS_LABELS), bukan daftar lama di CLAUDE.md.
// Hanya 4 hue (aturan Sano DS v2 §badge.jsx): orange = baru/butuh perhatian,
// accent (biru) = sedang berjalan (4 stage tengah, sengaja SATU warna supaya
// progres tidak terasa "loncat-loncat"), green = benar-benar berhasil.
export const STAGE_VARIANT = {
  NEW:         "warning", // oranye — baru masuk, belum diproses
  PROSPECT:    "info",    // biru — sedang berjalan (negosiasi/follow up)
  TRANSACTION: "success", // hijau — berhasil (pesan sudah dipastikan jadi order)
  REVIEWED:    "success", // hijau — sama seperti TRANSACTION, cuma sudah lebih maju (kasih review publik). Tetap 4-hue, tidak nambah warna baru.
  SPAM:        "neutral", // abu-abu — dikecualikan dari performa, bukan status "sedang berjalan"
};

export const CONV_STATUS_LABELS = {
  OPEN:     "Terbuka",
  PENDING:  "Pending",
  RESOLVED: "Selesai",
};
export const CONV_STATUS_VARIANT = {
  OPEN:     "info",
  PENDING:  "warning",
  RESOLVED: "neutral",
};

export const HEALTH_LABELS = {
  SAKIT:       "Sakit",
  TIDAK_SAKIT: "Tidak Sakit",
};
export const HEALTH_VARIANT = {
  SAKIT:       "danger",
  TIDAK_SAKIT: "success",
};

export const ORDER_STATUS_VARIANT = {
  PENDING:   "warning",
  PICKUP:    "violet",
  PROCESSING:"info",
  READY:     "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
  SEWA_DIKIRIM: "info",
  SEWA_DIAMBIL: "success",
};

// Bucket tampilan ringkas (4 Sep 2026) — laporan owner: 5 status LAYANAN/BARU
// (Menunggu/Pengambilan/Diproses/Siap Kirim/Terkirim) terlalu granular untuk
// dilihat sales sehari-hari, mau disederhanakan jadi 3 tahap. Status ASLI di
// Order.status TIDAK berubah/disederhanakan (tetap dihitung otomatis dari
// Unit lewat orderStatusSync.js, tetap dipakai di riwayat/OrderTimelineDrawer)
// — bucket ini CUMA untuk badge & Kanban ringkas. Dropdown override manual
// (orderStatusesForCategory) juga TIDAK ikut berubah — sales yang perlu
// override paksa tetap melihat status granular aslinya.
// SEWA sengaja TIDAK dipetakan di sini — statusnya sendiri (SEWA_DIKIRIM/
// SEWA_DIAMBIL) sudah cuma 2 tahap, tidak perlu dibucket lagi; tampilkan
// label aslinya langsung.
export const ORDER_STATUS_BUCKET = {
  PENDING: "PROCESSING",
  PICKUP: "PROCESSING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};
export const ORDER_STATUS_BUCKET_LABELS = {
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
};
// Kembalikan status ASLI kalau tidak ada di peta bucket (mis. SEWA_DIKIRIM/
// SEWA_DIAMBIL) — pemanggil lalu jatuh ke ORDER_STATUS_LABELS untuk label,
// bukan blank/undefined.
export function orderStatusBucket(status) {
  return ORDER_STATUS_BUCKET[status] || status;
}

export const PAYMENT_STATUS_VARIANT = {
  BELUM_BAYAR: "danger",
  DP:          "warning",
  LUNAS:       "success",
};

// Helper aman — kembalikan variant "neutral" kalau enum tak dikenal, jadi UI
// tidak pernah blank/crash untuk data lama/tak terduga.
const pick = (map, key) => map[key] || "neutral";
export const stageVariant      = (s) => pick(STAGE_VARIANT, s);
export const convStatusVariant = (s) => pick(CONV_STATUS_VARIANT, s);
export const healthVariant     = (s) => pick(HEALTH_VARIANT, s);
export const orderStatusVariant = (s) => pick(ORDER_STATUS_VARIANT, s);
export const paymentStatusVariant = (s) => pick(PAYMENT_STATUS_VARIANT, s);

// Format range tanggal untuk label di UI (e.g. "1 Jun – 30 Jun 2026")
export const formatDateRange = formatRentangTanggal;

// Helper cepat: apakah pelanggan VIP (total nilai order >= Rp5jt)
export function isVIP(customer) {
  return (customer.orderValue || 0) >= 5_000_000;
}

// Hitung hari sejak last message (butuh field lastMessageAt dari backend).
// Sekarang selisih HARI KALENDER WIB, bukan selisih 24 jam — "tidak aktif 30
// hari" jadi cocok dengan yang dilihat user di kolom tanggal.
export const daysSinceLastChat = hariSejak;

// Durasi RELATIF & ringkas — satu satuan saja, dibulatkan.
// "45 mnt" · "3 jam" · "25 hari" · "2 bln"
//
// Dipakai untuk WAKTU TUNGGU (antrean follow-up). formatDuration() di bawah
// menghasilkan "615 jam 9 mnt" untuk kasus lama — presisi menit tidak ada
// gunanya pada angka sebesar itu, dan justru menyembunyikan fakta
// sesungguhnya ("sudah 25 hari"). Untuk durasi kerja yang pendek (mis. avg
// response time) formatDuration() tetap yang benar.
export function formatDurasiRelatif(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt`;
  const jam = Math.floor(m / 60);
  if (jam < 24) return `${jam} jam`;
  const hari = Math.floor(jam / 24);
  if (hari < 60) return `${hari} hari`;
  return `${Math.floor(hari / 30)} bln`;
}

// Format durasi menit ke "X jam Y mnt" atau "X mnt"
export function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} jam ${rem} mnt` : `${h} jam`;
}

// Helper untuk baca/tulis nilai dari tag dengan prefix (misal: "ukuran:160x200", "merk:Comforta")
export function getTagPrefix(tags, prefix) {
  const tag = (tags || []).find((t) => t.toLowerCase().startsWith(prefix.toLowerCase() + ":"));
  return tag ? tag.slice(prefix.length + 1) : "";
}
export function setTagPrefix(tags, prefix, value) {
  const filtered = (tags || []).filter((t) => !t.toLowerCase().startsWith(prefix.toLowerCase() + ":"));
  if (value?.trim()) filtered.push(`${prefix}:${value.trim()}`);
  return filtered;
}
// Filter tag biasa (buang yang pakai prefix khusus)
export function publicTags(tags) {
  const PREFIXES = ["ukuran", "merk"];
  return (tags || []).filter((t) => !PREFIXES.some((p) => t.toLowerCase().startsWith(p + ":")));
}

export const KOTA_LIST = [
  "Jakarta Selatan", "Jakarta Barat", "Jakarta Utara", "Jakarta Pusat", "Jakarta Timur",
  "Bekasi", "Tangerang", "Bogor", "Depok", "Bandung", "Sukabumi", "Karawang",
];

// D-028 (20 Agustus 2026, revisi multi-pilih) — dipakai di Order.complaintCategory
// DAN Customer.complaintCategory (dua field independen, sama enum). Dipindah ke
// sini (sebelumnya duplikat di OrderSection.jsx & InfoSection.jsx) supaya cuma
// ada SATU daftar label, juga dipakai export Excel di Orders.jsx.
export const HEALTH_COMPLAINT_LABELS = {
  KEPALA_PUSING:  "Kepala Pusing",
  SAKIT_PINGGANG: "Sakit Pinggang",
  SAKIT_PUNGGUNG: "Sakit Punggung",
  SAKIT_LEHER:    "Sakit Leher",
  BAHU:           "Bahu",
  PEGAL_PEGAL:    "Pegal-pegal",
  SARAF_KEJEPIT:  "Saraf Kejepit",
  SKOLIOSIS:      "Skoliosis",
  LAINNYA:        "Lainnya",
};
export const HEALTH_COMPLAINT_OPTIONS = Object.keys(HEALTH_COMPLAINT_LABELS);

// Lini Produk & Jenis Produk (29 Agustus 2026) — perluasan bisnis dari
// kasur-saja ke Sofa & Divan (Order.productLine/productType, backend
// prisma/schema.prisma). SATU daftar di sini (bukan diduplikasi di
// OrderSection.jsx/Orders.jsx/OrderTimelineDrawer.jsx) supaya label yang
// tampil di form input, export Excel, dan drawer riwayat order TIDAK PERNAH
// beda kata untuk nilai enum yang sama.
export const PRODUCT_LINE_LABELS = {
  KASUR: "Kasur",
  SOFA:  "Sofa",
  DIVAN: "Divan",
};
export const PRODUCT_LINE_ICONS = {
  KASUR: "🛏️",
  SOFA:  "🛋️",
  DIVAN: "🛌",
};
// Dikelompokkan per ProductLine — dipakai OrderSection.jsx utk menampilkan
// HANYA jenis yang relevan dgn lini produk yang sudah dipilih. DIVAN sengaja
// cuma 1 varian (DIVAN_SANDARAN) — form tidak menampilkan step pemilihan
// jenis utk Divan, langsung di-set nilai ini.
export const PRODUCT_TYPES_BY_LINE = {
  KASUR: ["KASUR_SPRING", "KASUR_BUSA", "MULTIBED", "KASUR_2IN1_ATAS", "KASUR_2IN1_BAWAH"],
  SOFA:  ["SOFABED", "SOFA_L", "SOFA_1_SEATER", "SOFA_2_SEATER", "SOFA_3_SEATER"],
  DIVAN: ["DIVAN_SANDARAN"],
};
// Pemetaan label ukuran kasur → variantKey katalog harga (29 Agustus 2026).
// ⚠️ TERIKAT ke UKURAN_KASUR di backend/src/constants/orderOptions.js —
// kunci di bawah HARUS sama persis dengan label di sana. Kalau ada ukuran
// baru/di-rename, UBAH KEDUANYA.
//
// Pakai peta eksplisit, BUKAN parsing angka depan dari label: "Ukuran
// Custom" tidak punya angka sama sekali, dan parsing diam-diam akan
// menghasilkan variantKey ngawur begitu ada label baru yang formatnya beda.
// null = ukuran ini memang tidak punya kolom harga (harga diisi manual).
export const UKURAN_VARIANT_KEY = {
  "90x200 cm (Single)": "90",
  "100x200 cm (Super Single)": "100",
  "120x200 cm (Single Besar)": "120",
  "160x200 cm (Queen)": "160",
  "180x200 cm (King)": "180",
  "200x200 cm (King Besar)": "200",
  "Ukuran Custom": null,
};

// variantKey untuk lookup harga. Sumbunya beda per lini produk:
//   KASUR & DIVAN → dari ukuran kasur yang dipilih
//   SOFA          → dari jenis produk (kolom harga sofa memang PERSIS enum
//                   ProductType, tidak ada daftar ukuran terpisah)
export function resolveVariantKey({ productLine, productType, ukuran }) {
  if (productLine === "SOFA") return productType || null;
  if (productLine === "KASUR" || productLine === "DIVAN") return UKURAN_VARIANT_KEY[ukuran] ?? null;
  return null;
}

export const PRODUCT_TYPE_LABELS = {
  KASUR_SPRING:     "Kasur Spring",
  KASUR_BUSA:       "Kasur Busa",
  MULTIBED:         "Multibed",
  KASUR_2IN1_ATAS:  "Kasur 2in1 Atas",
  KASUR_2IN1_BAWAH: "Kasur 2in1 Bawah",
  SOFABED:          "Sofabed",
  SOFA_L:           "Sofa L",
  SOFA_1_SEATER:    "Sofa 1 Seater",
  SOFA_2_SEATER:    "Sofa 2 Seater",
  SOFA_3_SEATER:    "Sofa 3 Seater",
  // "Sandaran" saja (3 Sep 2026, dulu "Divan - Sandaran") — konsisten dgn
  // entri lain di map ini yang tidak mengulang nama Lini Produk-nya sendiri
  // ("Kasur Spring" bukan "Kasur - Spring", dst). Bug nyata: kolom export
  // Excel "Lini Produk" sudah bilang "Divan", jadi "Jenis Produk" ikut
  // menulis "Divan - Sandaran" kelihatan seperti 1 nilai gabungan padahal
  // dua kolom itu memang harus terpisah bersih.
  DIVAN_SANDARAN:   "Sandaran",
  // Jenis Kasur khusus kategori BARU (4 Sep 2026) — lihat jenisProdukOptions().
  KASUR_SEHAT:      "Kasur Sehat",
  KASUR_2IN1:       "Kasur 2in1",
  KASUR_LAINNYA:    "Lainnya",
};

// Jenis Kasur untuk kategori BARU (D-051 lanjutan, 4 Sep 2026 — laporan
// owner: daftar konstruksi Kasur Spring/Busa/2in1 Atas/Bawah relevan untuk
// SERVICE kasur existing customer, bukan untuk BELI kasur baru dari nol).
// Cuma berlaku utk KASUR x BARU; kombinasi lain (KASUR x LAYANAN, atau lini
// SOFA/DIVAN apapun kategorinya) tetap pakai PRODUCT_TYPES_BY_LINE seperti
// biasa. KASUR_LAINNYA membuka input teks bebas (lihat OrderSection.jsx,
// disimpan sbg field `jenisKasurLainnya` di Order.notes).
export function jenisProdukOptions(productLine, category) {
  if (productLine === "KASUR" && category === "BARU") {
    return ["KASUR_SEHAT", "MULTIBED", "KASUR_2IN1", "KASUR_LAINNYA"];
  }
  return PRODUCT_TYPES_BY_LINE[productLine] || [];
}

// Kategori baris katalog harga (PriceItem.kind / OrderItem.kind snapshot,
// 29 Agustus 2026). Dipindah ke sini (sebelumnya lokal di OrderSection.jsx)
// supaya form input & export Excel (Orders.jsx) pakai kata yang SAMA PERSIS
// — tidak ada drift antara "Layanan" di form vs istilah lain di laporan.
export const PRICE_ITEM_KIND_LABELS = {
  SERVICE: "Layanan",
  ADDON:   "Tambahan",
  PRODUCT: "Produk",
  RENTAL:  "Sewa",
  FEE:     "Biaya",
};

// D-029 (20 Agustus 2026) — merk/ukuran/keluhan kasur dulu disimpan JSON di
// Order.notes (bukan kolom sendiri, migrasi database dianggap tidak sepadan
// saat itu). Dipindah ke sini dari OrderSection.jsx (sebelumnya lokal, tidak
// bisa dipakai export Excel di Orders.jsx).
export function parseOrderNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "", jenisKasurLainnya: "" };
  try {
    const p = JSON.parse(notes);
    return {
      merkKasur:       p.merkKasur || "",
      ukuranKasur:     p.ukuranKasur || "",
      keluhanCustomer: p.keluhanCustomer || "",
      // Jenis Kasur "Lainnya" (4 Sep 2026, kategori BARU) — lihat OrderSection.jsx.
      jenisKasurLainnya: p.jenisKasurLainnya || "",
    };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes, jenisKasurLainnya: "" };
  }
}
export function buildOrderNotes(info) {
  return JSON.stringify({
    merkKasur:       info.merkKasur || "",
    ukuranKasur:     info.ukuranKasur || "",
    keluhanCustomer: info.keluhanCustomer || "",
    jenisKasurLainnya: info.jenisKasurLainnya || "",
  });
}

// D-026 fix (20 Agustus 2026): satu campaign (mis. "MDSP-Aug") sering punya
// BEBERAPA kode voucher berbeda (MERDEKA10, MERDEKA8, dst) sebagai promo
// TERPISAH dengan `name` yang sama persis — kode SELALU ditaruh duluan
// (paling menonjol) karena itu satu-satunya pembeda antar promo serupa.
export function promoLabel(p) {
  return `${p.code} — ${p.name}`;
}

// Preset date range — KOMPATIBILITAS. Definisi kanonik seluruh preset sekarang
// ada di lib/dateRange.js (skema tanggal, dipakai DateRangePicker gaya Google
// Ads). Fungsi ini cuma memetakan key lama ("7d"/"30d"/"3m") ke id preset baru
// supaya pemanggil lama tidak perlu diubah dan tidak ada DUA definisi "30 hari
// terakhir" yang bisa saling drift.
//
// Kode BARU sebaiknya langsung pakai makeRange() dari lib/dateRange.js.
const KEY_LAMA_KE_PRESET = {
  today: "today",
  "7d":  "last_7_days",
  "30d": "last_30_days",
  "3m":  "last_3_months",
};
export function getDatePreset(preset) {
  const id = KEY_LAMA_KE_PRESET[preset];
  if (!id) return { from: "", to: "" };
  const { from, to } = makeRange(id);
  return { from, to };
}

// ─── Avatar gradien + nama TERIAK (D-050, 4 September 2026) ─────────────────
// Dua helper kecil untuk menutup gap terakhir antara Delivery Hub dan mockup
// artifact-nya (laporan owner: "sudah hampir mirip tapi belum sempurna").

// Versi PEKAT dari AVATAR_COLORS di atas, urutan hue-nya SENGAJA sama persis
// (purple, blue, green, pink, orange) supaya satu orang dapat hue yang sama
// baik dirender datar (pastel, dipakai lintas app) maupun bergradien (dipakai
// di Delivery Hub) — kalau urutannya beda, Risel bisa jadi ungu di tabel
// Pelanggan tapi oranye di Delivery, dan avatar berhenti berfungsi sebagai
// penanda identitas yang bisa dihafal.
const AVATAR_GRADIENTS = [
  { from: "#8B5CF6", to: "#6D28D9" }, // purple
  { from: "#3B82F6", to: "#1D4ED8" }, // blue
  { from: "#22C55E", to: "#15803D" }, // green
  { from: "#EC4899", to: "#BE185D" }, // pink
  { from: "#F97316", to: "#C2410C" }, // orange
];

export function avatarGradient(seed) {
  if (!seed) return AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

// Nama pelanggan yang diketik ALL-CAPS oleh sales ("HOTEL DISCOVERY ANCOL")
// dirapikan jadi Title Case untuk TAMPILAN saja — data di database tidak
// disentuh.
//
// Syaratnya SENGAJA ketat: hanya kalau string itu tidak punya SATU PUN huruf
// kecil. Nama yang sudah campur ditinggalkan apa adanya, karena huruf besar
// di tengah nama biasanya memang disengaja dan title-case buta akan merusaknya
// — mis. "Esty Bagus [Cs vina/BDG]" (kode cabang BDG) atau "PT XYZ".
// Singkatan yang TETAP kapital penuh — badan usaha & institusi yang memang
// selalu ditulis begitu. Tanpa daftar ini "PT XYZ" jadi "Pt Xyz", yang salah
// dan justru terlihat seperti kesalahan sistem, bukan perbaikan.
const NAMA_TETAP_KAPITAL = new Set([
  "PT", "CV", "UD", "PD", "TB", "RS", "RSU", "RSUD", "TK", "SD", "SMP", "SMA", "SMK", "PAUD",
]);

export function titleCaseNama(nama) {
  if (!nama || /[a-z]/.test(nama)) return nama;
  // Tanda hubung SENGAJA di luar pola kata (bukan bagian dari [\p{L}'’]),
  // jadi ia dihitung sebagai batas kata: "AL-FATIH" -> "Al-Fatih", bukan
  // "Al-fatih" — nama majemuk berhubung itu umum di sini.
  return nama.replace(/\p{L}[\p{L}'’]*/gu, (kata) =>
    NAMA_TETAP_KAPITAL.has(kata) ? kata : kata[0] + kata.slice(1).toLowerCase()
  );
}
