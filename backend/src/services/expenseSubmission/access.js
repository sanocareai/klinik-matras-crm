// AKSES PER WORKSPACE Pengajuan Biaya (C1) — ditegakkan di SERVER; klien hanya menampilkan/menyembunyikan menu.
//
//   PRODUKSI  : PRODUCTION_LEAD (untuk Produksi) + staf Finance/Admin/Owner
//   WAREHOUSE : WAREHOUSE (untuk Gudang)         + staf Finance/Admin/Owner
//   DELIVERY  : perilaku lama TIDAK berubah (jalur pengajuan lama & akun own-only ditangani ownAccess.js)
// Pengguna non-Finance hanya melihat/mengubah pengajuan miliknya sendiri (pemohon atau pembuat) — aturan itu ada di rute & service.

import { hasPermission, rolesOf } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";

/** FinDivision di pengajuan → kunci workspace (GUDANG dulu tidak terpetakan ke WAREHOUSE sehingga edit/ajukan gagal). */
export function workspaceUntukDivisi(division) {
  if (division === "GUDANG") return "WAREHOUSE";
  return division || null;
}

export const stafFinance = (user) => hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN) || hasPermission(user, P.FINANCE_APPROVE);

/** Boleh memakai workspace ini (membuat, membaca daftar, melihat konfigurasi)? */
export function bolehWorkspace(user, workspace) {
  if (workspace === "PRODUKSI") return stafFinance(user) || rolesOf(user).includes("PRODUCTION_LEAD");
  if (workspace === "WAREHOUSE") return stafFinance(user) || rolesOf(user).includes("WAREHOUSE");
  return true; // DELIVERY & workspace lain: aturan lama
}

/** Divisi FinDivision yang TIDAK boleh diakses pengguna ini (dipakai menyaring daftar). */
export function divisiTerlarang(user) {
  const t = [];
  if (!bolehWorkspace(user, "PRODUKSI")) t.push("PRODUKSI");
  if (!bolehWorkspace(user, "WAREHOUSE")) t.push("GUDANG");
  return t;
}

/** Catat atas nama orang lain: Finance/Admin untuk semua workspace; Dispatcher HANYA untuk Delivery (aturan lama). */
export function bolehCatatAtasNama(user, workspace) {
  if (hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN)) return true;
  return workspace === "DELIVERY" && rolesOf(user).includes("DISPATCHER");
}
