// AKSES PER WORKSPACE Pengajuan Biaya (C1/C2) — ditegakkan di SERVER; klien hanya menampilkan/menyembunyikan menu.
// Data-driven: peran pengaju tiap workspace dibaca dari config.js (`peranPengaju`), bukan cabang kode per divisi.
//
//   workspace `strict` (Produksi, Gudang, Marketing, Management, HR-GA): peran di `peranPengaju` + staf Finance/Admin/Owner.
//     `peranPengaju: []` = HANYA staf Finance/Admin/Owner (belum ada peran divisinya di sistem).
//   DELIVERY: perilaku lama TIDAK berubah (jalur pengajuan lama & akun own-only ditangani ownAccess.js).
// Pengguna non-Finance hanya melihat/mengubah pengajuan miliknya sendiri (pemohon atau pembuat) — aturan itu ada di rute & service.
// Tidak ada akses lintas divisi implisit: memegang satu workspace tidak membuka workspace lain.

import { hasPermission, rolesOf } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { WORKSPACES } from "./config.js";

/** FinDivision di pengajuan → kunci workspace (GUDANG dulu tidak terpetakan ke WAREHOUSE sehingga edit/ajukan gagal). */
export function workspaceUntukDivisi(division) {
  if (division === "GUDANG") return "WAREHOUSE";
  return division || null;
}

export const stafFinance = (user) => hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN) || hasPermission(user, P.FINANCE_APPROVE);

/** Workspace berkebijakan ketat (C1/C2)? */
export const workspaceStrict = (workspace) => !!WORKSPACES[workspace]?.strict;

/** Boleh memakai workspace ini (membuat, membaca daftar, melihat konfigurasi)? */
export function bolehWorkspace(user, workspace) {
  const cfg = WORKSPACES[workspace];
  if (!cfg?.strict) return true; // DELIVERY & workspace lain: aturan lama
  if (stafFinance(user)) return true;
  return (cfg.peranPengaju || []).some((r) => rolesOf(user).includes(r));
}

/** Divisi (FinDivision) yang TIDAK boleh diakses pengguna ini — dipakai menyaring daftar. */
export function divisiTerlarang(user) {
  return Object.entries(WORKSPACES).filter(([ws, c]) => c.strict && !bolehWorkspace(user, ws)).map(([, c]) => c.division);
}

/** Catat atas nama orang lain: Finance/Admin/Owner untuk semua workspace baru; Dispatcher HANYA untuk Delivery (aturan lama). */
export function bolehCatatAtasNama(user, workspace) {
  if (hasPermission(user, P.FINANCE_POST) || hasPermission(user, P.FINANCE_ADMIN)) return true;
  return workspace === "DELIVERY" && rolesOf(user).includes("DISPATCHER");
}
