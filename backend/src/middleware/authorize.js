// Otorisasi Sano Hub — lapisan yang menggantikan RLS Postgres (D-001, D-010).
//
// Dipakai BERSAMA requireAuth dari auth.js, bukan menggantikannya:
//   router.get("/units", requireAuth, requirePermission(P.UNIT_READ), handler)
//
// STATUS PHASE 0: modul ini dibangun dan diuji, tapi BELUM dipasang di route
// mana pun. Memasangnya ke route CRM yang sudah jalan akan mengubah perilaku
// untuk 7 orang yang sedang bekerja — itu pekerjaan Phase 1, bukan Phase 0.

import { PERMISSIONS, ROLE_PERMISSIONS, PORTALS } from "../constants/permissions.js";

/**
 * Ambil daftar role dari payload JWT.
 *
 * ⚠️ KOMPATIBILITAS TOKEN LAMA — jangan dihapus. Token berlaku 7 hari, jadi
 * setelah deploy masih ada user yang memegang token TANPA field `roles`
 * (dibuat sebelum multi-role ada). Tanpa fallback ke `role` tunggal, semua
 * orang itu kehilangan akses sampai login ulang — persis jenis kejutan yang
 * tidak boleh terjadi di jam kerja.
 *
 * Fallback ini bisa dibuang setelah semua token lama pasti kedaluwarsa
 * (7 hari setelah deploy), bukan sebelumnya.
 */
export function rolesOf(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
  return user.role ? [user.role] : [];
}

/** Gabungan permission dari SEMUA role yang dipegang (aditif). */
export function permissionsOf(user) {
  const set = new Set();
  for (const role of rolesOf(user)) {
    for (const perm of ROLE_PERMISSIONS[role] || []) set.add(perm);
  }
  return set;
}

export function hasPermission(user, permission) {
  return permissionsOf(user).has(permission);
}

export function hasAnyPermission(user, permissions) {
  const owned = permissionsOf(user);
  return permissions.some((p) => owned.has(p));
}

/** Portal yang boleh dibuka user ini (PRD §4). */
export function portalsFor(user) {
  const roles = rolesOf(user);
  return PORTALS.filter((portal) => portal.roles.some((r) => roles.includes(r)));
}

/** Middleware: wajib punya SATU permission tertentu. */
export function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Belum login" });
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: "Anda tidak punya akses untuk aksi ini" });
    }
    next();
  };
}

/** Middleware: cukup punya SALAH SATU dari beberapa permission. */
export function requireAnyPermission(...permissions) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Belum login" });
    if (!hasAnyPermission(req.user, permissions)) {
      return res.status(403).json({ error: "Anda tidak punya akses untuk aksi ini" });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Penyaringan field
// ---------------------------------------------------------------------------
// CATATAN ARSITEKTUR: cara yang LEBIH BAIK adalah tidak pernah mengambil field
// terlarang dari database sama sekali (pakai `select` Prisma per permission).
// Fungsi di bawah adalah jaring pengaman LAPIS KEDUA untuk response yang
// terlanjur dirakit dari query bersama — bukan izin untuk malas memilih field.
// Data yang sudah keluar dari DB bisa bocor lewat log sebelum sempat disaring.

/** Hilangkan PII customer kalau user tidak berhak melihatnya. */
export function sanitizeCustomer(customer, user) {
  if (!customer) return customer;
  if (hasPermission(user, PERMISSIONS.CUSTOMER_PII_READ)) return customer;

  const { phone, email, instagramHandle, ...safe } = customer;
  return safe;
}

/** Hilangkan angka harga kalau user tidak berhak melihatnya. */
export function sanitizeOrder(order, user) {
  if (!order) return order;
  if (hasPermission(user, PERMISSIONS.ORDER_PRICE_READ)) return order;

  const { value, ...safe } = order;
  // Item layanan tetap tampil (pekerja produksi PERLU tahu layanan apa yang
  // dikerjakan) — yang dibuang cuma angka harganya.
  if (Array.isArray(order.items)) {
    safe.items = order.items.map(({ harga, ...item }) => item);
  }
  return safe;
}

export { PERMISSIONS };
