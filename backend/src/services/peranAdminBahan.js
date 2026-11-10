// SATU ATURAN PERAN untuk pencatatan pemakaian bahan Produksi (keputusan Owner, Nov 2026): hanya akun berperan ADMIN yang pencatatannya langsung berlaku; selain itu
// (termasuk PRODUCTION_LEAD, OWNER, operator, Gudang di jalur Produksi) mengajukan dahulu dan berlaku sesudah diverifikasi ADMIN yang BERBEDA. Dipakai biaya tanpa stok (HPP order),
// pencatatan pemakaian unit V1, perubahan & koreksi pemakaian, dan bahan run Produksi V2. Berdasarkan PERAN sistem, bukan nama orang.
import { rolesOf } from "../middleware/authorize.js";

export const PERAN_ADMIN_BAHAN = Object.freeze(["ADMIN"]);
export const adminBahan = (u) => rolesOf(u).some((r) => PERAN_ADMIN_BAHAN.includes(r));
