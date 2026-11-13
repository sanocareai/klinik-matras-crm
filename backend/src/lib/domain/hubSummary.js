// Main Hub — ringkasan Task & Meeting (Okt 2026). Aturan MURNI (tanpa
// database, tanpa Express) — dites langsung (tests/hubSummary.test.js).
// Bagian yang menyentuh DB/HUB ada di services/hubSummary.js.

import { PERMISSIONS as P } from "../../constants/permissions.js";
import { hasPermission } from "../../middleware/authorize.js";

/** Sama persis dengan enum DivisiKeanggotaan di prisma/schema.prisma (C2.1) —
 *  "leader" dipantau Main Hub memakai penandaan divisi yang SAMA, bukan
 *  daftar terpisah yang bisa diam-diam beda dengan skema. */
export const LEADER_DIVISIONS = Object.freeze([
  "MARKETING",
  "MANAGEMENT",
  "HR_GA",
  "PRODUCTION",
  "WAREHOUSE",
  "DELIVERY",
  "DIGITAL_TECHNOLOGY",
]);

export const MAX_LEADERS_PER_CALL = 50;

/**
 * ?division= dari browser — HANYA MEMPERSEMPIT set leader yang sudah
 * dihitung dari DB (UserDivision.isLeader). Nilai apa pun di luar daftar
 * yang dikenal (termasuk "SEMUA", array, objek, string kosong) menjadi null
 * — "tanpa filter" (seluruh divisi), BUKAN "divisi tak dikenal" yang
 * diam-diam lolos sebagai sesuatu yang lain.
 */
export function normalizeDivisionFilter(input) {
  return typeof input === "string" && LEADER_DIVISIONS.includes(input) ? input : null;
}

/**
 * Boleh membuka "Pantauan Leader" (ringkasan LINTAS leader/divisi)?
 * HUB_LEADER_MONITOR, default-deny, SENGAJA Owner-only di tahap ini — lihat
 * catatan panjang di constants/permissions.js. "Tugas Saya"/"Hasil Meeting"
 * (ringkasan milik sendiri) TIDAK lewat fungsi ini — itu cukup HUB_ACCESS
 * yang sudah ada (lihat hubRoleFor di lib/domain/hubSso.js).
 */
export function canMonitorLeaders(user) {
  return hasPermission(user, P.HUB_LEADER_MONITOR);
}
