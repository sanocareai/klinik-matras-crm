// Utility format tanggal & uang — konvensi sama dengan versi web (seksi 11 CLAUDE.md)
import dayjs from "dayjs";
import "dayjs/locale/id.js";
import { avatarColors } from "../theme";

dayjs.locale("id");

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Timestamp pintar gaya WhatsApp — SAMA dengan
// frontend/src/features/inbox/utils/formatTime.js#smartTimestamp: "14:30"
// hari ini, "Kemarin", nama hari kalau <7 hari, "12/07/26" kalau lebih lama.
// Dipakai InboxScreen (ChatListScreen.js), beda dari timeAgo() di bawah yang
// masih dipakai layar lama (relatif "5 mnt", "2 jam").
export function smartTimestamp(date) {
  if (!date) return "";
  const d = dayjs(date);
  if (!d.isValid()) return "";

  const now = dayjs();
  const diffHari = now.startOf("day").diff(d.startOf("day"), "day");

  if (diffHari <= 0) return d.format("HH:mm");
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return HARI_ID[d.day()];
  return d.format("DD/MM/YY");
}

export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

// Singkatan untuk ruang terbatas (dipakai OrdersScreen ringkasan) — konvensi
// SAMA PERSIS dengan frontend/src/utils/format.js (CLAUDE.md §11).
export function formatRupiahShort(n) {
  if (n >= 1_000_000) return "Rp" + (n / 1_000_000).toFixed(1) + "jt";
  if (n >= 1_000) return "Rp" + (n / 1_000).toFixed(0) + "rb";
  return "Rp" + (n || 0);
}

// Order/Payment status — SAMA PERSIS dengan frontend/src/utils/format.js
// (dan backend/prisma/schema.prisma enum OrderStatus/PaymentStatus, sumber
// kebenaran). BUG (fix): versi lama CustomerProfileContent.js punya mapping
// SALAH (WAITING_LIST/PENGAMBILAN/PENGERJAAN/FINISH — enum yang sudah tidak
// dipakai), jadi status order tampil mentah ("PENDING" dst, bukan
// "Menunggu") — dipindah ke sini supaya satu sumber dipakai OrderCard.js
// juga, tidak dobel-definisi lagi.
export const ORDER_STATUS_LABELS = {
  PENDING: "Menunggu",
  PICKUP: "Pengambilan",
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
  // Status KHUSUS kategori SEWA (4 Sep 2026, paritas dgn web) — lihat
  // orderStatusesForCategory & ORDER_STATUS_BUCKET di bawah.
  SEWA_DIKIRIM: "Pengiriman",
  SEWA_DIAMBIL: "Pengambilan",
};
export const ORDER_STATUS_BADGE = {
  PENDING:    { backgroundColor: "#fef3c7", color: "#92400e" },
  PICKUP:     { backgroundColor: "#dbeafe", color: "#1e40af" },
  PROCESSING: { backgroundColor: "#ede9fe", color: "#5b21b6" },
  READY:      { backgroundColor: "#ccfbf1", color: "#065f46" },
  DELIVERED:  { backgroundColor: "#dcfce7", color: "#166534" },
  CANCELLED:  { backgroundColor: "#fee2e2", color: "#991b1b" },
  SEWA_DIKIRIM: { backgroundColor: "#dbeafe", color: "#1e40af" },
  SEWA_DIAMBIL: { backgroundColor: "#dcfce7", color: "#166534" },
};
export const ORDER_STATUSES = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

// SEWA (4 Sep 2026) TIDAK ikut sistem status Unit/Bengkel sama sekali (lihat
// guard category==="SEWA" di backend/src/services/orderStatusSync.js) — cuma
// 2 status manual. Cek DULUAN, sebelum cabang BARU.
export function orderStatusesForCategory(category) {
  if (category === "SEWA") return ["SEWA_DIKIRIM", "SEWA_DIAMBIL", "CANCELLED"];
  return category === "BARU" ? ["PROCESSING", "READY", "DELIVERED", "CANCELLED"] : ORDER_STATUSES;
}

// Bucket tampilan ringkas (4 Sep 2026, paritas dgn frontend/src/utils/format.js)
// — status ASLI Order.status TIDAK berubah, ini cuma utk badge/kartu ringkas.
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
export function orderStatusBucket(status) {
  return ORDER_STATUS_BUCKET[status] || status;
}

export const PAYMENT_STATUS_LABELS = { BELUM_BAYAR: "Belum Bayar", DP: "DP", LUNAS: "Lunas" };
export const PAYMENT_STATUS_BADGE = {
  BELUM_BAYAR: { backgroundColor: "#fef2f2", color: "#dc2626" },
  DP:          { backgroundColor: "#fff7ed", color: "#f97316" },
  LUNAS:       { backgroundColor: "#f0fdf4", color: "#16a34a" },
};
export const PAYMENT_STATUSES = ["BELUM_BAYAR", "DP", "LUNAS"];

// Label dilepas dari "Kasur" (29 Agustus 2026, paritas dgn web) — kategori
// ini sekarang berlaku lintas Lini Produk (Kasur/Sofa/Divan), bukan cuma
// kasur lagi. Lihat PRODUCT_LINE_LABELS dkk di bawah.
export const CATEGORY_LABELS = { LAYANAN: "Service/Upgrade", BARU: "Baru", SEWA: "Sewa" };
export const CATEGORY_BADGE = {
  LAYANAN: { backgroundColor: "#ede9fe", color: "#5b21b6" },
  BARU:    { backgroundColor: "#dcfce7", color: "#166534" },
  SEWA:    { backgroundColor: "#dbeafe", color: "#1e40af" },
};

// Lini Produk & Jenis Produk (29 Agustus 2026) — SAMA PERSIS dengan
// frontend/src/utils/format.js. Perluasan bisnis dari kasur-saja ke
// Sofa & Divan (Order.productLine/productType, backend prisma/schema.prisma).
export const PRODUCT_LINE_LABELS = { KASUR: "Kasur", SOFA: "Sofa", DIVAN: "Divan" };
// Dikelompokkan per ProductLine — DIVAN sengaja cuma 1 varian
// (DIVAN_SANDARAN), form tidak menampilkan picker jenis utk Divan.
export const PRODUCT_TYPES_BY_LINE = {
  KASUR: ["KASUR_SPRING", "KASUR_BUSA", "MULTIBED", "KASUR_2IN1_ATAS", "KASUR_2IN1_BAWAH"],
  SOFA:  ["SOFABED", "SOFA_L", "SOFA_1_SEATER", "SOFA_2_SEATER", "SOFA_3_SEATER"],
  DIVAN: ["DIVAN_SANDARAN"],
};
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
  // "Sandaran" saja (dikoreksi 4 Sep 2026 — sinkron dgn fix web 3 Sep 2026,
  // sempat luput di sini): kolom export Excel web "Lini Produk" sudah bilang
  // "Divan" sendiri, jadi "Jenis Produk" tidak perlu mengulang.
  DIVAN_SANDARAN:   "Sandaran",
  // Jenis Kasur khusus kategori BARU (4 Sep 2026) — lihat jenisProdukOptions().
  KASUR_SEHAT:      "Kasur Sehat",
  KASUR_2IN1:       "Kasur 2in1",
  KASUR_LAINNYA:    "Lainnya",
  // Divan itu sendiri, terpisah dari Sandaran — khusus kategori LAYANAN
  // (4 Sep 2026, paritas dgn web, lihat jenisProdukOptions()).
  DIVAN_UTAMA:      "Divan",
};

// Jenis Kasur untuk kategori BARU (4 Sep 2026, paritas dgn web) — lihat
// jenisProdukOptions() di frontend/src/utils/format.js untuk alasan lengkap.
// Divan x LAYANAN (4 Sep 2026) juga di sini — sebelumnya Divan cuma py 1
// jenis (Sandaran) auto-set tanpa ditanya, sekarang Divan & Sandaran jadi
// pilihan eksplisit khusus kategori LAYANAN (katalog harganya TIDAK
// dipecah, masih 1 baris "Service Divan/Sandaran" yang sama).
export function jenisProdukOptions(productLine, category) {
  if (productLine === "KASUR" && category === "BARU") {
    return ["KASUR_SEHAT", "MULTIBED", "KASUR_2IN1", "KASUR_LAINNYA"];
  }
  if (productLine === "DIVAN" && category === "LAYANAN") {
    return ["DIVAN_UTAMA", "DIVAN_SANDARAN"];
  }
  return PRODUCT_TYPES_BY_LINE[productLine] || [];
}

// Kategori baris katalog harga (PriceItem.kind / OrderItem.kind snapshot) —
// SATU sumber label dgn form input & export web.
export const PRICE_ITEM_KIND_LABELS = {
  SERVICE: "Layanan",
  ADDON:   "Tambahan",
  PRODUCT: "Produk",
  RENTAL:  "Sewa",
  FEE:     "Biaya",
};

// Pemetaan label ukuran kasur -> variantKey katalog harga. ⚠️ TERIKAT ke
// UKURAN_KASUR di backend/src/constants/orderOptions.js (dimuat lewat
// GET /master-data/order-options, BUKAN hardcode di sini) — kunci di bawah
// harus sama persis dgn label yang datang dari situ.
export const UKURAN_VARIANT_KEY = {
  "90x200 cm (Single)": "90",
  "100x200 cm (Super Single)": "100",
  "120x200 cm (Single Besar)": "120",
  "160x200 cm (Queen)": "160",
  "180x200 cm (King)": "180",
  "200x200 cm (King Besar)": "200",
  "Ukuran Custom": null,
};

// variantKey utk lookup katalog harga. Sumbunya beda per lini produk:
//   KASUR & DIVAN -> dari ukuran kasur yang dipilih
//   SOFA          -> dari jenis produk (kolom harga sofa memang PERSIS enum
//                    ProductType, tidak ada daftar ukuran terpisah)
export function resolveVariantKey({ productLine, productType, ukuran }) {
  if (productLine === "SOFA") return productType || null;
  if (productLine === "KASUR" || productLine === "DIVAN") return UKURAN_VARIANT_KEY[ukuran] ?? null;
  return null;
}

// "5 mnt", "2 jam", "3 hari", atau tanggal pendek kalau sudah lama
export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mnt = Math.floor(diff / 60000);
  if (mnt < 1) return "baru saja";
  if (mnt < 60) return `${mnt} mnt`;
  const jam = Math.floor(mnt / 60);
  if (jam < 24) return `${jam} jam`;
  const hari = Math.floor(jam / 24);
  if (hari < 7) return `${hari} hari`;
  return shortDate(dateStr);
}

// "1 Jul"
export function shortDate(dateStr) {
  const d = new Date(dateStr);
  const bulan = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${d.getDate()} ${bulan[d.getMonth()]}`;
}

// "22 Agu 2026" — sama pola shortDate() tapi dengan tahun, dipakai untuk
// tanggal "Pasti" (Pick Up/Kirim) di OrderTimelineScreen.js — tanpa tahun,
// tanggal yang beda tahun (mis. Januari tahun depan) jadi ambigu.
export function shortDateWithYear(dateStr) {
  const d = new Date(dateStr);
  const bulan = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

// Kondisi kesehatan & kategori keluhan (D-028) — SAMA PERSIS dengan
// frontend/src/utils/format.js, dipakai OrderTimelineScreen.js.
export const HEALTH_LABELS = {
  SAKIT:       "Sakit",
  TIDAK_SAKIT: "Tidak Sakit",
};
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

// D-029 — merk/ukuran/keluhan kasur disimpan JSON di Order.notes (bukan
// kolom sendiri). SAMA PERSIS dengan parseOrderNotes() di
// frontend/src/utils/format.js — dipusatkan di sini (bukan didefinisikan
// lagi di OrderTimelineScreen.js) karena OrderCard.js & OrderFormModal.js
// SUDAH punya salinan lokal identik (parseNotes()); tempat baru manapun
// yang butuh ini sebaiknya pakai yang di sini, bukan menambah salinan ketiga.
export function parseOrderNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "", jenisKasurLainnya: "" };
  try {
    const p = JSON.parse(notes);
    return {
      merkKasur:       p.merkKasur || "",
      ukuranKasur:     p.ukuranKasur || "",
      keluhanCustomer: p.keluhanCustomer || "",
      jenisKasurLainnya: p.jenisKasurLainnya || "",
    };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes, jenisKasurLainnya: "" };
  }
}

// "MERDEKA17 — Diskon 17% Kemerdekaan" — SAMA PERSIS dengan promoLabel() di
// frontend/src/utils/format.js. Kode voucher didahulukan (D-026, lihat
// catatan di sana) karena satu campaign bisa punya beberapa kode berbeda.
export function promoLabel(p) {
  return `${p.code} — ${p.name}`;
}

// "14:05" untuk timestamp di bubble chat
export function clockTime(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Label divider tanggal di dalam percakapan (gaya WhatsApp) — SAMA dengan
// frontend/src/features/inbox/utils/formatTime.js#dateDividerLabel: "Hari
// Ini", "Kemarin", atau tanggal lengkap ("12 Juli 2026") untuk yang lebih lama.
export function dateDividerLabel(dateStr) {
  const d = dayjs(dateStr);
  if (!d.isValid()) return "";
  const diffHari = dayjs().startOf("day").diff(d.startOf("day"), "day");
  if (diffHari === 0) return "Hari Ini";
  if (diffHari === 1) return "Kemarin";
  return d.format("D MMMM YYYY");
}

// Inisial nama untuk avatar: "Budi Santoso" → "BS"
export function initials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Warna avatar konsisten per nama (hash sederhana)
export function avatarColor(name) {
  let hash = 0;
  for (const ch of name || "?") hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}
