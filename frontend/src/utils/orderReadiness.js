// ─── ORDER READINESS — kesiapan handoff ke Delivery & Fulfillment ──────────
// SATU-SATUNYA tempat aturan "field apa wajib ada sebelum order boleh
// dijadwalkan pengambilan/pengiriman". Dipakai badge di OrderCard (papan
// Kanban) DAN panel blocker di OrderTimelineDrawer — supaya dua tempat itu
// TIDAK PERNAH bisa berbeda pendapat soal satu order sudah siap atau belum.
//
// Data order di sini SAMA PERSIS objek yang sudah dikembalikan GET /orders
// (lihat routes/orders.js) — TIDAK ada panggilan API tambahan. `notes`
// masih JSON mentah (merkKasur/ukuranKasur/keluhanCustomer), diurai lewat
// parseOrderNotes() yang SAMA dipakai OrderTimelineDrawer, bukan parser baru.
//
// DUA STATUS SAJA (disederhanakan 7 Sep 2026, permintaan owner) — SEMPAT ada
// tingkat ketiga "Perlu Dilengkapi"/NEEDS_INFO khusus pembayaran, tapi itu
// duplikat: Order sudah punya kolom Status Pembayaran sendiri (Belum Bayar/
// DP/Lunas), jadi tidak perlu ditandai lagi di sini. Kolom ini sekarang
// murni "data wajib buat handoff ke Delivery sudah lengkap atau belum".
// CANCELLED sengaja TIDAK dinilai sama sekali (`null`) — order batal bukan
// "belum siap", itu memang tidak akan pernah maju ke Delivery.

import { parseOrderNotes } from "./format.js";
import { isUkuranCustom } from "./ukuranKasur.js";

// Ukuran Custom tanpa Lebar/Panjang HANYA menahan order BARU (dibuat sejak penegakan server dinyalakan). Order legacy TIDAK PERNAH ditahan karenanya.
function ukuranCustomDitahan(o, sejak) {
  if (!sejak || !o?.createdAt) return false;
  const dibuat = new Date(o.createdAt).getTime();
  const mulai = new Date(sejak).getTime();
  if (Number.isNaN(dibuat) || Number.isNaN(mulai) || dibuat < mulai) return false;
  const n = parseOrderNotes(o.notes);
  return isUkuranCustom(n.ukuranKasur) && (n.ukuranLebarCm === null || n.ukuranPanjangCm === null);
}

export const READINESS = {
  READY: "READY",
  BLOCKED: "BLOCKED",
};

export const READINESS_META = {
  READY:   { label: "Lengkap",          tone: "green" },
  BLOCKED: { label: "Wajib Dilengkapi", tone: "red" },
};

// PENTING: `label` di SEMUA rule adalah KALIMAT UTUH ("X belum diisi", "Belum
// ada Y") — pemanggil (ReadinessPanel) menampilkannya APA ADANYA, TIDAK
// menempelkan sufiks generik.
const BLOCKER_RULES = [
  { key: "customerName",  label: "Nama pelanggan belum diisi", check: (o) => !!o.customerName },
  { key: "customerPhone", label: "Nomor HP belum diisi",       check: (o) => !!o.customerPhone },
  // Alamat teks ATAU link share lokasi Google Maps (Order.locationUrl) —
  // salah satu cukup, dua-duanya sama-sama menjawab "mau dikirim ke mana".
  {
    key: "address", label: "Alamat pengiriman / link Google Maps belum diisi",
    check: (o) => !!(o.deliveryAddress || "").trim() || !!o.locationUrl,
  },
  { key: "items",         label: "Belum ada layanan/paket dipilih", check: (o) => (o.items?.length || 0) > 0 },
  { key: "price",         label: "Harga (nilai order) belum diisi", check: (o) => (o.value || 0) > 0 },
  // Ukuran kasur cuma relevan utk lini KASUR — Sofa/Divan punya konsep
  // ukuran berbeda (kalau ada) dan TIDAK memakai field ini, jadi jangan
  // ditandai "kurang lengkap" untuk order yang memang bukan kasur.
  {
    key: "ukuranKasur", label: "Ukuran kasur belum diisi",
    relevan: (o) => (o.productLine || "KASUR") === "KASUR",
    check: (o) => !!parseOrderNotes(o.notes).ukuranKasur,
  },
  {
    key: "ukuranCustomAngka", label: "Lebar dan Panjang ukuran custom belum diisi",
    relevan: (o, opsi = {}) => (o.productLine || "KASUR") === "KASUR" && ukuranCustomDitahan(o, opsi.ukuranCustomWajibSejak),
    check: () => false,
  },
  // Cuma relevan utk kategori LAYANAN — itu satu-satunya yang punya tahap
  // pickup (jemput barang LAMA dari customer). BARU (beli baru) & SEWA
  // tidak pernah menjemput apa pun dari customer, jadi tidak butuh jadwal
  // ini — OrderTimelineDrawer.jsx sendiri sudah sengaja tidak menampilkan
  // baris "Jadwal Pick Up" untuk dua kategori itu (lihat komentar di sana),
  // aturan readiness ini WAJIB konsisten dengan itu.
  {
    key: "pickupDate", label: "Jadwal pickup belum diisi",
    relevan: (o) => o.category === "LAYANAN",
    check: (o) => !!(o.pickupConfirmedDate || o.pickupEstimate),
  },
  { key: "salesOwner", label: "Belum ada sales pemegang", check: (o) => !!o.assignedSales },
  {
    key: "complaintNotes", label: "Catatan keluhan belum diisi",
    relevan: (o) => !!o.hasComplaint,
    check: (o) => !!parseOrderNotes(o.notes).keluhanCustomer,
  },
];

/**
 * @returns {null|{state, missingBlockers}} `null` untuk order CANCELLED
 * (readiness tidak berlaku).
 */
export function evaluateReadiness(order, opsi = {}) {
  if (!order || order.status === "CANCELLED") return null;

  const missingBlockers = BLOCKER_RULES
    .filter((r) => (r.relevan ? r.relevan(order, opsi) : true))
    .filter((r) => !r.check(order, opsi));

  const state = missingBlockers.length > 0 ? READINESS.BLOCKED : READINESS.READY;

  return { state, missingBlockers };
}
