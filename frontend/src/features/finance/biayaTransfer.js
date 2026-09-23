// Logika murni biaya admin transfer bank — dipakai SEMUA form uang keluar.
// TIDAK ADA kalkulasi biaya di sini: angka pratinjau datang dari server
// (POST /finance/transfer-fee/preview) yang memakai aturan & preset yang sama
// dengan saat menyimpan (backend/src/services/finance/transferFee.js).

export const JENIS_BIAYA_TRANSFER = [
  { code: "SESAMA_BANK", label: "Sesama Bank" },
  { code: "BI_FAST", label: "BI-FAST" },
  { code: "TRANSFER_ONLINE", label: "Transfer Online / Realtime Online" },
  { code: "LAINNYA", label: "Lainnya / Custom" },
];

// Cermin bawaan server — dipakai bila rekening belum mengirim presetnya.
export const BIAYA_BAWAAN = { SESAMA_BANK: 0, BI_FAST: 2500, TRANSFER_ONLINE: 6500 };

export const BIAYA_KOSONG = { paymentMethod: "", transferFeeType: "", transferFeeAmount: "" };

export const adalahRekeningBank = (rek) => !!rek && rek.kind !== "KAS";

export function presetRekening(rek) {
  return { ...BIAYA_BAWAAN, ...(rek?.presetBiayaTransfer || {}) };
}

/** Nilai awal saat rekening dipilih: kas -> Tunai; bank/e-wallet -> Transfer (metode wajib dipilih). */
export function nilaiAwalBiaya(rek) {
  if (!rek) return { ...BIAYA_KOSONG };
  return adalahRekeningBank(rek)
    ? { paymentMethod: "TRANSFER", transferFeeType: "", transferFeeAmount: "" }
    : { paymentMethod: "TUNAI", transferFeeType: "", transferFeeAmount: "" };
}

/** Form boleh dikirim? Transfer wajib pilih metode; Custom wajib nominal. */
export function biayaTransferLengkap(rek, v) {
  if (!adalahRekeningBank(rek) || v?.paymentMethod !== "TRANSFER") return true;
  if (!v.transferFeeType) return false;
  if (v.transferFeeType === "LAINNYA") {
    return v.transferFeeAmount !== "" && v.transferFeeAmount != null && Number(v.transferFeeAmount) >= 0;
  }
  return true;
}

const KUNCI_BIAYA = ["paymentMethod", "transferFeeType", "transferFeeAmount"];

/** Buang isian biaya dari objek form (state form ikut menyimpan kunci-kunci ini). */
export function tanpaBiaya(f) {
  const b = { ...f };
  for (const k of KUNCI_BIAYA) delete b[k];
  return b;
}

/**
 * Objek siap kirim: field form + isian biaya yang bersih. `aktif=false` dipakai
 * form yang uangnya BELUM keluar (utang/reimbursement): biaya baru dicatat saat Bayar.
 */
export function denganBiaya(f, aktif = true) {
  return aktif ? { ...tanpaBiaya(f), ...bodyBiayaTransfer(f) } : tanpaBiaya(f);
}

/** Bagian body request. Untuk preset, nominal TIDAK dikirim — server yang mengisi. */
export function bodyBiayaTransfer(v) {
  if (v?.paymentMethod === "TRANSFER") {
    return {
      paymentMethod: "TRANSFER",
      transferFeeType: v.transferFeeType,
      ...(v.transferFeeType === "LAINNYA" && { transferFeeAmount: Number(v.transferFeeAmount) }),
    };
  }
  if (v?.paymentMethod === "TUNAI") return { paymentMethod: "TUNAI" };
  return {};
}
