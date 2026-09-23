// BIAYA ADMIN TRANSFER BANK — satu sumber kebenaran untuk SEMUA form uang keluar.
//
// Prinsip:
//  - "Nominal Diterima" = nominal dokumen (amount). "Total Keluar Rekening" =
//    amount + biaya admin. Biaya admin BUKAN pengeluaran kedua: ia hanya baris
//    tambahan (Dr Beban Administrasi Bank) di jurnal YANG SAMA, dan kredit
//    kas/bank-nya sebesar total keluar — supaya saldo buku cocok dengan
//    mutasi koran bank (lihat catatan serupa di posting/cash.js).
//  - SERVER yang memvalidasi dan menghitung. Untuk jenis preset (Sesama Bank,
//    BI-FAST, Transfer Online) nominal dari klien DIABAIKAN — server mengisi
//    dari preset rekening (atau bawaan sistem). Hanya LAINNYA yang membaca
//    nominal dari klien, itupun divalidasi.

import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { toMoney, ZERO } from "./money.js";

export class TransferFeeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "TransferFeeError";
    this.statusCode = statusCode;
  }
}

export const CARA_BAYAR = ["TUNAI", "TRANSFER"];

export const JENIS_BIAYA_TRANSFER = [
  { code: "SESAMA_BANK", label: "Sesama Bank", bawaan: 0 },
  { code: "BI_FAST", label: "BI-FAST", bawaan: 2500 },
  { code: "TRANSFER_ONLINE", label: "Transfer Online / Realtime Online", bawaan: 6500 },
  { code: "LAINNYA", label: "Lainnya / Custom", bawaan: null },
];
const KODE_PRESET = ["SESAMA_BANK", "BI_FAST", "TRANSFER_ONLINE"];
export const BATAS_BIAYA_CUSTOM = 1_000_000;

export function presetBawaan() {
  return Object.fromEntries(JENIS_BIAYA_TRANSFER.filter((j) => j.bawaan != null).map((j) => [j.code, j.bawaan]));
}

/** Preset efektif sebuah rekening = bawaan sistem ditimpa isi `transferFeePresets`. */
export function presetRekening(cashAccount) {
  const hasil = presetBawaan();
  const simpan = cashAccount?.transferFeePresets;
  if (simpan && typeof simpan === "object") {
    for (const kode of KODE_PRESET) {
      if (simpan[kode] != null) hasil[kode] = Number(simpan[kode]);
    }
  }
  return hasil;
}

/** Validasi isian Pengaturan Finance -> objek preset bersih. Melempar 400 kalau tidak sah. */
export function validasiPresets(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TransferFeeError("Preset biaya admin harus berupa objek {SESAMA_BANK, BI_FAST, TRANSFER_ONLINE}");
  }
  const bersih = {};
  for (const kode of KODE_PRESET) {
    if (input[kode] === undefined || input[kode] === null || input[kode] === "") continue;
    let nilai;
    try { nilai = toMoney(input[kode], { field: kode }); } catch { throw new TransferFeeError(`Preset ${kode} bukan angka yang sah`); }
    if (nilai.isNegative()) throw new TransferFeeError(`Preset ${kode} tidak boleh negatif`);
    if (nilai.greaterThan(BATAS_BIAYA_CUSTOM)) throw new TransferFeeError(`Preset ${kode} melebihi batas wajar Rp${BATAS_BIAYA_CUSTOM.toLocaleString("id-ID")}`);
    bersih[kode] = Number(nilai);
  }
  return bersih;
}

/**
 * Hitung & validasi biaya admin untuk satu pembayaran keluar.
 * Mengembalikan {paymentMethod, transferFeeType, transferFeeAmount(Decimal)}.
 * - Tidak ada `paymentMethod` -> perilaku lama (biaya 0, method null); tetapi
 *   kalau klien mengirim jenis/nominal biaya tanpa memilih TRANSFER -> 400.
 * - TUNAI -> biaya wajib 0.
 * - TRANSFER -> rekening harus BANK/EWALLET; jenis wajib; preset diisi server.
 */
export async function hitungBiayaTransfer(db, { cashAccountId, paymentMethod, transferFeeType, transferFeeAmount } = {}) {
  const adaInputBiaya = (transferFeeType != null && transferFeeType !== "")
    || (transferFeeAmount != null && transferFeeAmount !== "" && Number(transferFeeAmount) !== 0);
  const metode = paymentMethod == null || paymentMethod === "" ? null : String(paymentMethod).toUpperCase();

  if (metode && !CARA_BAYAR.includes(metode)) {
    throw new TransferFeeError(`Cara bayar tidak dikenal: ${paymentMethod}. Pilihan: Tunai atau Transfer.`);
  }
  if (metode !== "TRANSFER") {
    if (adaInputBiaya) throw new TransferFeeError("Biaya admin transfer hanya berlaku bila Cara Bayar = Transfer");
    return { paymentMethod: metode, transferFeeType: null, transferFeeAmount: ZERO };
  }

  if (!cashAccountId) throw new TransferFeeError("Pilih rekening bank sumber dana sebelum memilih Cara Bayar Transfer");
  const rek = await db.finCashAccount.findUnique({
    where: { id: cashAccountId },
    select: { id: true, kind: true, name: true, transferFeePresets: true },
  });
  if (!rek) throw new TransferFeeError("Rekening kas/bank tidak ditemukan", 404);
  if (rek.kind === "KAS") {
    throw new TransferFeeError(`"${rek.name}" adalah kas tunai; Cara Bayar Transfer hanya untuk rekening bank/e-wallet`);
  }

  const jenis = String(transferFeeType || "").toUpperCase();
  if (!JENIS_BIAYA_TRANSFER.some((j) => j.code === jenis)) {
    throw new TransferFeeError("Pilih metode transfer: Sesama Bank, BI-FAST, Transfer Online, atau Lainnya");
  }

  let biaya;
  if (jenis === "LAINNYA") {
    if (transferFeeAmount == null || transferFeeAmount === "") {
      throw new TransferFeeError("Isi nominal biaya admin untuk metode Lainnya / Custom");
    }
    try { biaya = toMoney(transferFeeAmount, { field: "biaya admin" }); } catch { throw new TransferFeeError("Nominal biaya admin bukan angka yang sah"); }
    if (biaya.isNegative()) throw new TransferFeeError("Biaya admin tidak boleh negatif");
    if (biaya.greaterThan(BATAS_BIAYA_CUSTOM)) {
      throw new TransferFeeError(`Biaya admin melebihi batas wajar Rp${BATAS_BIAYA_CUSTOM.toLocaleString("id-ID")}`);
    }
  } else {
    biaya = toMoney(presetRekening(rek)[jenis]);
  }
  return { paymentMethod: "TRANSFER", transferFeeType: jenis, transferFeeAmount: biaya };
}

/**
 * Baris jurnal biaya admin (kosong bila biaya 0). Kredit kas/bank pemanggil
 * harus sebesar amount + biaya; baris ini mengimbanginya di sisi debit dan
 * memakai cashAccountId yang sama supaya buku per rekening tetap benar.
 */
export async function barisBiayaAdmin(tx, { fee, cashAccount }) {
  const biaya = toMoney(fee || 0);
  if (!biaya.greaterThan(0)) return [];
  const bebanAdmin = await resolveAccount(tx, SYSTEM_KEYS.BEBAN_ADMIN_BANK);
  return [{
    accountId: bebanAdmin.id,
    debit: biaya,
    description: "Biaya administrasi transfer",
    cashAccountId: cashAccount.id,
  }];
}

/** Ringkasan untuk respons API: nominal diterima vs total keluar rekening. */
export function ringkasBiaya({ amount, transferFeeAmount }) {
  const diterima = toMoney(amount);
  const biaya = toMoney(transferFeeAmount || 0);
  return {
    nominalDiterima: Number(diterima),
    biayaAdmin: Number(biaya),
    totalKeluarRekening: Number(diterima.plus(biaya)),
  };
}

/**
 * Untuk jalur edit/koreksi: hitung ulang biaya HANYA bila body menyentuh field
 * biaya, atau rekening berganti padahal dokumen sudah ber-Cara Bayar Transfer
 * (rekening baru bisa kas tunai / punya preset lain). Mengembalikan objek
 * data yang siap di-merge ke `perubahan` ({} bila tidak ada yang berubah).
 */
export async function siapkanPerubahanBiaya(db, body, asli, cashAccountIdBaru) {
  const menyentuh = ["paymentMethod", "transferFeeType", "transferFeeAmount"].some((k) => body[k] !== undefined);
  const rekeningGanti = cashAccountIdBaru !== undefined && cashAccountIdBaru !== asli.cashAccountId;
  if (!menyentuh && !(rekeningGanti && asli.paymentMethod === "TRANSFER")) return {};

  const efektif = {
    cashAccountId: cashAccountIdBaru !== undefined ? cashAccountIdBaru : asli.cashAccountId,
    paymentMethod: body.paymentMethod !== undefined ? body.paymentMethod : asli.paymentMethod,
    transferFeeType: body.transferFeeType !== undefined ? body.transferFeeType : asli.transferFeeType,
    transferFeeAmount: body.transferFeeAmount !== undefined ? body.transferFeeAmount : asli.transferFeeAmount,
  };
  // Pindah ke Tunai: biaya lama dibuang, bukan ditolak.
  if (String(efektif.paymentMethod || "").toUpperCase() !== "TRANSFER") {
    efektif.transferFeeType = null;
    efektif.transferFeeAmount = 0;
  }
  return hitungBiayaTransfer(db, efektif);
}
