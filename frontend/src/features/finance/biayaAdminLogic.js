// Logika murni "biaya admin transfer ikut nominal" (2 Okt 2026). Angka total berasal dari server (totalKeluarRekening = nominal + biaya admin); fallback = jumlah dua angka server.
/** { nilai, adaBiaya, biaya, amount } — nilai = yang tampil di daftar (total keluar rekening bila ada biaya admin). */
export function nominalTampil(d) {
  const amount = Number(d?.amount ?? 0);
  const biaya = Number(d?.biayaAdmin ?? d?.transferFeeAmount ?? d?.feeAmount ?? 0);
  if (!(biaya > 0)) return { nilai: amount, adaBiaya: false, biaya: 0, amount };
  return { nilai: Number(d?.totalKeluarRekening ?? amount + biaya), adaBiaya: true, biaya, amount };
}
