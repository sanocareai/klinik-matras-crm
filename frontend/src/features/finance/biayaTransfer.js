// Logika murni biaya admin transfer bank — dipakai SEMUA form uang keluar.
// Ini HANYA pratinjau di layar: server yang menghitung & memvalidasi ulang
// (backend/src/services/finance/transferFee.js) dan angka server yang tersimpan.

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

export function biayaTerpilih(rek, v) {
  if (v?.paymentMethod !== "TRANSFER") return 0;
  if (v.transferFeeType === "LAINNYA") return Math.max(0, Number(v.transferFeeAmount) || 0);
  return presetRekening(rek)[v.transferFeeType] ?? 0;
}

export function pratinjauBiaya(rek, v, nominal) {
  const diterima = Number(nominal) || 0;
  const biayaAdmin = biayaTerpilih(rek, v);
  return { nominalDiterima: diterima, biayaAdmin, totalKeluarRekening: diterima + biayaAdmin };
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
