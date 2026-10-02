// BERSAMA — Rekonsiliasi Bank V2: galat, sakelar rollout, helper uang/tanggal.
// Tidak ada fungsi di folder ini yang membuat/mengubah jurnal, Payment, order, atau dokumen keuangan. Satu-satunya yang ditulis: tabel fin_bank_* / fin_cash_counts + catatan aktivitas.
import { toMoney, ZERO } from "../money.js";
import { SETTING_KEYS, getSettingRaw, parseBool } from "../settings.js";

export class RekonError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "RekonError";
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

export const STATUS_BANK = Object.freeze({
  COCOK_OTOMATIS: "Cocok otomatis",
  DISARANKAN: "Disarankan",
  COCOK_MANUAL: "Cocok manual",
  BELUM_ADA_DI_BUKU: "Belum ada di buku",
  DIKECUALIKAN: "Dikecualikan",
});
export const STATUS_BUKU = Object.freeze({
  COCOK_OTOMATIS: "Cocok otomatis",
  DISARANKAN: "Disarankan",
  COCOK_MANUAL: "Cocok manual",
  BELUM_ADA_DI_BANK: "Belum ada di bank",
  DIKECUALIKAN: "Dikecualikan",
});
export const KATEGORI = Object.freeze({
  TRANSFER_ANTAR_REKENING: "Transfer antar-rekening",
  BIAYA_BANK: "Biaya bank",
  BUNGA: "Bunga",
  PAJAK_BUNGA: "Pajak bunga",
  BEDA_TANGGAL: "Beda tanggal",
  LAINNYA: "Lainnya",
});

export const PESAN_SAKELAR_MATI = "Rekonsiliasi Bank V2 belum diaktifkan. Minta Admin/Owner menyalakannya di Finance › Pengaturan (bank_reconciliation_v2_active).";

/** Sakelar rollout (default MATI). Dipakai SEMUA endpoint tulis (impor, pencocokan, pengecualian, opname, penyelesaian periode). */
export async function rekonV2Aktif(db) {
  return parseBool(await getSettingRaw(db, SETTING_KEYS.BANK_RECONCILIATION_V2_ACTIVE));
}
export async function wajibRekonV2Aktif(db) {
  if (!(await rekonV2Aktif(db))) throw new RekonError(PESAN_SAKELAR_MATI, 403, "SAKELAR_MATI");
}

export const uang = (v) => toMoney(v ?? 0).toFixed(2);
export const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
export const waktu = (d) => (d ? new Date(d).toISOString() : null);
export const tanggalKolom = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(`${v}T00:00:00.000Z`) : null);
export const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hariAntara = (a, b) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

/** Nilai bank bertanda dari sudut pandang REKENING: + masuk, − keluar (sama arah dengan debit−kredit baris jurnal pada akun kas/bank). */
export const nilaiBank = (b) => toMoney(b.credit).minus(toMoney(b.debit));
/** Nilai baris jurnal pada akun kas/bank: debit = masuk (+), kredit = keluar (−). */
export const nilaiBuku = (l) => toMoney(l.debit).minus(toMoney(l.credit));
export const jumlahkan = (arr, f) => arr.reduce((t, x) => t.plus(f(x)), ZERO);

/** Rekening wajib ada; kembalikan ringkasnya. */
export async function ambilRekening(db, id) {
  if (!POLA_UUID.test(String(id || ""))) throw new RekonError("Rekening tidak valid", 400, "REKENING_TIDAK_VALID");
  const r = await db.finCashAccount.findUnique({ where: { id }, select: { id: true, name: true, kind: true, bankName: true, accountNumber: true, accountId: true, active: true } });
  if (!r) throw new RekonError("Rekening tidak ditemukan", 404, "REKENING_TIDAK_ADA");
  return r;
}

/** Maskir nomor rekening untuk tampilan ringkas (data sensitif): 1230013546272 → ••••6272. */
export const maskNomor = (n) => (n ? `••••${String(n).slice(-4)}` : null);
