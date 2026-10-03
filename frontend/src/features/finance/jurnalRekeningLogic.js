// Logika murni form Jurnal Manual: baris pada akun yang menjadi akun rekening kas/bank WAJIB memilih rekeningnya (server menegakkan ulang — lihat pastikanRekeningBaris di backend).
/** Rekening aktif yang memakai akun COA ini sebagai akun kas/bank-nya (kosong = akun biasa, tidak perlu rekening). */
export const rekeningUntukAkun = (rekening, accountId) => (rekening || []).filter((r) => r.accountId === accountId);
/** Baris butuh pilihan rekening bila akunnya milik rekening kas/bank. */
export const butuhRekening = (rekening, accountId) => !!accountId && rekeningUntukAkun(rekening, accountId).length > 0;
/** Baris valid: akun kosong dilewati; yang berakun kas/bank wajib punya rekening yang cocok dengan akunnya. */
export const rekeningBarisValid = (rekening, b) => !b.accountId || !butuhRekening(rekening, b.accountId) || rekeningUntukAkun(rekening, b.accountId).some((r) => r.id === b.cashAccountId);
