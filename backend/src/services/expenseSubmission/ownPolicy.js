// Kebijakan "akun own-only" (Driver/Helper/Leader Driver dengan delivery:expense:own:*, TANPA jalur pengajuan lama).
// File murni tanpa dependency ke service supaya bisa dipakai service.js dan ownAccess.js tanpa impor melingkar.
import { hasPermission } from "../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../constants/permissions.js";

export const JALUR_LAMA = [P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT, P.FINANCE_ADMIN];

/** Aktor tidak punya jalur pengajuan lama; hanya izin biaya milik sendiri. Selalu diturunkan dari izin server-side. */
export function ownOnly(user) {
  return !JALUR_LAMA.some((p) => hasPermission(user, p))
    && (hasPermission(user, P.DELIVERY_EXPENSE_OWN_READ) || hasPermission(user, P.DELIVERY_EXPENSE_OWN_WRITE));
}
