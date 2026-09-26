// AKSES Pengajuan Biaya lintas divisi (C1/C2/C2.1) — SATU kebijakan bersama untuk Delivery, Produksi, Gudang, Marketing, Management, HR-GA.
// Ditegakkan di SERVER; klien hanya menampilkan/menyembunyikan menu.
//
// DUA KONSEP TERPISAH:
//   - PERAN (Role/UserRole)  : izin keamanan (Finance, Admin, Driver, ...). Satu-satunya sumber izin Finance.
//   - DIVISI (UserDivision)  : "bekerja di divisi mana" -> workspace Pengajuan Biaya mana yang boleh dibuka. TIDAK menambah izin Finance.
//
// Aturan akses ke sebuah workspace:
//   1. Staf Finance/Admin/Owner (finance:post|approve|admin) -> semua workspace.
//   2. Selain itu: harus ANGGOTA divisi workspace itu = keanggotaan eksplisit (`user.divisi`, dimuat dari DB per permintaan — bukan dari JWT
//      yang bisa basi 7 hari) ATAU adapter peran lama (ADAPTER_PERAN_DIVISI) supaya akun yang sudah berjalan tidak kehilangan akses.
//   3. SALES TIDAK otomatis Marketing. Marketing/Management/HR-GA HANYA lewat keanggotaan eksplisit yang diatur Admin/Owner.
//   4. Tidak ada akses lintas divisi implisit: menjadi anggota satu divisi tidak membuka divisi lain.
// Aturan kepemilikan: pengguna non-Finance hanya melihat/mengelola pengajuan MILIKNYA (pemohon atau pembuat), di semua workspace.

import { hasPermission, rolesOf } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { WORKSPACES } from "./config.js";
import { SubmissionError } from "./errors.js";
import { ownOnly } from "./ownPolicy.js";

/** Nilai enum DivisiKeanggotaan (prisma) — urutan tampil di UI. */
export const DIVISI_KEANGGOTAAN = ["MARKETING", "MANAGEMENT", "HR_GA", "PRODUCTION", "WAREHOUSE", "DELIVERY"];

export const LABEL_DIVISI = {
  MARKETING: "Marketing", MANAGEMENT: "Management", HR_GA: "HR & GA", PRODUCTION: "Produksi", WAREHOUSE: "Gudang", DELIVERY: "Delivery",
};

/**
 * ADAPTER KOMPATIBILITAS peran lama -> divisi. HANYA jalur yang sudah hidup sebelum C2.1 (C1 Produksi/Gudang, Delivery), supaya tidak ada
 * pengguna yang tiba-tiba kehilangan akses. Ini turunan yang dihitung saat permintaan, TIDAK pernah ditulis ke database.
 * SENGAJA tidak ada SALES -> MARKETING.
 */
export const ADAPTER_PERAN_DIVISI = {
  PRODUCTION_LEAD: ["PRODUCTION"],
  WAREHOUSE: ["WAREHOUSE"],
  DISPATCHER: ["DELIVERY"], DRIVER: ["DELIVERY"], HELPER: ["DELIVERY"], LEADER_DRIVER: ["DELIVERY"],
};

/** FinDivision di pengajuan -> kunci workspace (GUDANG dulu tidak terpetakan ke WAREHOUSE sehingga edit/ajukan gagal). */
export function workspaceUntukDivisi(division) {
  if (division === "GUDANG") return "WAREHOUSE";
  return division || null;
}

export const stafFinance = (user) => hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN) || hasPermission(user, P.FINANCE_APPROVE);

/** Boleh MELIHAT pengajuan semua orang (bukan hanya miliknya)? */
export const bolehLihatSemua = (user) => hasPermission(user, P.FINANCE_READ) || hasPermission(user, P.FINANCE_ADMIN);

/** Workspace berkebijakan ketat (C1/C2)? */
export const workspaceStrict = (workspace) => !!WORKSPACES[workspace]?.strict;

/** Keanggotaan divisi yang tersimpan di database (dimuat middleware ke `user.divisi`). */
export async function muatDivisiPengguna(db, userId) {
  const rows = await db.userDivision.findMany({ where: { userId }, select: { division: true } });
  return rows.map((r) => r.division);
}

/** Keanggotaan EKSPLISIT (tanpa adapter) — dipakai untuk menentukan apakah pengguna non-Finance boleh memakai fitur Pengajuan Biaya. */
export const punyaKeanggotaan = (user) => Array.isArray(user?.divisi) && user.divisi.length > 0;

/** Divisi efektif = keanggotaan eksplisit + adapter peran lama. */
export function divisiEfektif(user) {
  const set = new Set(Array.isArray(user?.divisi) ? user.divisi : []);
  for (const r of rolesOf(user)) for (const d of ADAPTER_PERAN_DIVISI[r] || []) set.add(d);
  return set;
}

/** Boleh memakai workspace ini (membuat, membaca daftar, melihat konfigurasi)? */
export function bolehWorkspace(user, workspace) {
  const cfg = WORKSPACES[workspace];
  if (!cfg) return false;
  if (stafFinance(user)) return true;
  return divisiEfektif(user).has(cfg.keanggotaan);
}

/** Divisi (FinDivision) yang TIDAK boleh diakses pengguna ini — dipakai menyaring daftar. */
export function divisiTerlarang(user) {
  return Object.entries(WORKSPACES).filter(([ws]) => !bolehWorkspace(user, ws)).map(([, c]) => c.division);
}

/** Catat atas nama orang lain: Finance/Admin/Owner untuk semua workspace; Dispatcher HANYA untuk Delivery (aturan lama). */
export function bolehCatatAtasNama(user, workspace) {
  if (hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN)) return true;
  return workspace === "DELIVERY" && rolesOf(user).includes("DISPATCHER");
}

/** Pemilik pengajuan = pemohon atau pembuat. */
export const pemilikPengajuan = (row, user) => !!user?.id && (row.requestedById === user.id || row.createdById === user.id);

/**
 * KEBIJAKAN BERSAMA akses ke SATU pengajuan (dipakai semua endpoint :id, semua workspace).
 *   - id tidak valid / tidak ada / workspace bukan haknya  -> 404 (tidak membocorkan keberadaan)
 *   - baca oleh non-pemilik tanpa hak lihat-semua           -> 403
 *   - tulis oleh non-pemilik yang bukan staf Finance        -> 403
 * Keputusan halus per aksi (mis. hanya finance:admin yang boleh mengedit draf orang lain) tetap di service.
 */
export function pastikanAksesBaris(user, row, { tulis = false, sembunyikan = false } = {}) {
  if (!row) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  if (!bolehWorkspace(user, workspaceUntukDivisi(row.division))) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
  if (pemilikPengajuan(row, user)) return;
  if (tulis ? !stafFinance(user) : !bolehLihatSemua(user)) {
    // Kontrak lama dipertahankan: mutasi oleh akun own-only (Driver/Helper/Leader Driver) dan unggah bukti (`sembunyikan`) = 404 (tidak
    // membocorkan keberadaan); pembacaan detail & mutasi lainnya = 403.
    if (sembunyikan || (tulis && ownOnly(user))) throw new SubmissionError("Pengajuan tidak ditemukan", 404);
    throw new SubmissionError("Anda tidak punya akses ke pengajuan ini", 403);
  }
}
