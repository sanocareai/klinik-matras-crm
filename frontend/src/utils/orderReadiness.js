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
// DUA TINGKAT KETAT, bukan satu daftar rata:
//   BLOCKER   = order SECARA STRUKTURAL tidak bisa dieksekusi tanpa ini
//               (tidak tahu mau kirim ke siapa/ke mana/apa/berapa harganya).
//   PERHATIAN = penting utk kelancaran tapi bukan penghalang mutlak (order
//               tetap BISA dijadwalkan, cuma berisiko ada yang keliru/
//               terlewat di lapangan kalau tidak dilengkapi).
// CANCELLED sengaja TIDAK dinilai sama sekali (`null`) — order batal bukan
// "belum siap", itu memang tidak akan pernah maju ke Delivery.

import { parseOrderNotes } from "./format.js";

export const READINESS = {
  READY: "READY",
  NEEDS_INFO: "NEEDS_INFO",
  BLOCKED: "BLOCKED",
};

export const READINESS_META = {
  READY:      { label: "Ready",       tone: "green" },
  NEEDS_INFO: { label: "Perlu Info",  tone: "orange" },
  BLOCKED:    { label: "Blocked",     tone: "red" },
};

// PENTING: `label` di SEMUA rule adalah KALIMAT UTUH ("X belum diisi", "Belum
// ada Y") — pemanggil (ReadinessPanel) menampilkannya APA ADANYA, TIDAK
// menempelkan sufiks generik. Alasannya konkret (ditemukan 31 Agustus 2026):
// sufiks generik "{label} belum diisi" salah kalau field-nya SELALU terisi
// tapi nilainya "belum terjadi" (mis. paymentStatus default BELUM_BAYAR itu
// bukan kosong) — user sempat bingung dibilang "belum diisi" padahal dia
// SUDAH pilih "Belum Bayar" secara eksplisit di dropdown.
const BLOCKER_RULES = [
  { key: "customerName",  label: "Nama pelanggan belum diisi", check: (o) => !!o.customerName },
  { key: "customerPhone", label: "Nomor HP belum diisi",       check: (o) => !!o.customerPhone },
  { key: "address",       label: "Alamat pengiriman belum diisi", check: (o) => !!(o.deliveryAddress || "").trim() },
  { key: "items",         label: "Belum ada layanan/paket dipilih", check: (o) => (o.items?.length || 0) > 0 },
  { key: "price",         label: "Harga (nilai order) belum diisi", check: (o) => (o.value || 0) > 0 },
];

const WARNING_RULES = [
  // Ukuran kasur cuma relevan utk lini KASUR — Sofa/Divan punya konsep
  // ukuran berbeda (kalau ada) dan TIDAK memakai field ini, jadi jangan
  // ditandai "kurang lengkap" untuk order yang memang bukan kasur.
  {
    key: "ukuranKasur", label: "Ukuran kasur belum diisi",
    relevan: (o) => (o.productLine || "KASUR") === "KASUR",
    check: (o) => !!parseOrderNotes(o.notes).ukuranKasur,
  },
  {
    key: "pickupDate", label: "Jadwal pickup belum diisi",
    check: (o) => !!(o.pickupConfirmedDate || o.pickupEstimate),
  },
  { key: "salesOwner", label: "Belum ada sales pemegang", check: (o) => !!o.assignedSales },
  // Bukan penghalang mutlak (ada kasus sah COD/bayar di tempat), tapi layak
  // ditinjau sebelum dikirim ke lapangan.
  { key: "payment", label: "Belum ada pembayaran masuk", check: (o) => o.paymentStatus !== "BELUM_BAYAR" },
  {
    key: "complaintNotes", label: "Catatan keluhan belum diisi",
    relevan: (o) => !!o.hasComplaint,
    check: (o) => !!parseOrderNotes(o.notes).keluhanCustomer,
  },
];

/**
 * @returns {null|{state, missingBlockers, missingWarnings}} `null` untuk
 * order CANCELLED (readiness tidak berlaku).
 */
export function evaluateReadiness(order) {
  if (!order || order.status === "CANCELLED") return null;

  const missingBlockers = BLOCKER_RULES.filter((r) => !r.check(order));
  const missingWarnings = WARNING_RULES
    .filter((r) => (r.relevan ? r.relevan(order) : true))
    .filter((r) => !r.check(order));

  const state = missingBlockers.length > 0
    ? READINESS.BLOCKED
    : missingWarnings.length > 0
      ? READINESS.NEEDS_INFO
      : READINESS.READY;

  return { state, missingBlockers, missingWarnings };
}
