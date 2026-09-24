import { Pencil, History, Ban, Undo2, RefreshCw, ShieldAlert } from "lucide-react";
import { adalahAdminKeuangan } from "@/features/finance/matriksAksi.js";

// Jembatan deskriptor matriks aksi (matriksAksi.js) -> item RowActions. Item yang tidak aktif TETAP tampil dengan alasan
// (Bahasa Indonesia) yang terlihat langsung di menu — tooltip tidak ada di layar sentuh, jadi alasan tidak boleh hanya di `title`.

const IKON = { edit: Pencil, koreksi: Pencil, riwayat: History, batal: Ban, catatUlang: RefreshCw, kembali: Undo2, tolak: ShieldAlert };

/** Admin keuangan menurut akun yang sedang login (cerminan; server tetap menjaga). */
export function adminSaatIni() {
  try { return adalahAdminKeuangan(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; }
}

/**
 * @param deskriptor  keluaran fungsi matriksAksi
 * @param handler     { [key]: () => void | Promise } — dipasang hanya untuk item aktif
 */
export function bentukItemMenu(deskriptor, handler = {}) {
  return deskriptor.map((d) => ({
    key: d.key,
    label: d.label,
    icon: IKON[d.aksi],
    destructive: d.destructive,
    disabled: !d.aktif,
    alasan: d.aktif ? null : d.alasan,
    hint: d.aktif ? d.hint : null,
    onClick: d.aktif ? handler[d.key] : undefined,
  }));
}
