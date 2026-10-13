// Logika murni "Uang Muka Supplier" (PO). TIDAK ada kalkulasi uang resmi di sini: nilai PO, uang muka dibayar, sisa komitmen, utang, saldo — semuanya dari server
// (services/finance/uangMukaSupplier.js). Yang ada hanya kesiapan formulir, penyusunan body, dan teks bantu.
import { bodyBiayaTransfer } from "./biayaTransfer.js";

export const MIN_ALASAN_MELEBIHI = 5;
export const KALIMAT_UANG_MUKA = "Uang muka adalah aset (Uang Muka Supplier), bukan stok, bukan biaya, dan belum menjadi utang. Stok hanya bertambah saat barang disimpan ke stok.";

/** Apakah nominal (bersama uang muka yang sudah dibayar) melampaui nilai PO? Murni perbandingan untuk PERINGATAN dini — keputusan ada di server. */
export function statusMelebihi({ nilaiPO = 0, uangMukaDibayar = 0, nominal = 0 }) {
  const sesudah = Number(uangMukaDibayar) + Number(nominal || 0);
  const kelebihan = Math.max(0, sesudah - Number(nilaiPO));
  return { melebihi: kelebihan > 0, kelebihan, totalSesudah: sesudah };
}

/** Kesiapan formulir bayar: nominal, tanggal, rekening, bukti wajib; biaya admin sesuai aturan rekening; bila melebihi PO butuh Admin + alasan + konfirmasi. */
export function kesiapanBayarUangMuka({ f, rekeningLengkap = true, melebihi = false, admin = false }) {
  if (!(Number(f.amount) > 0)) return { siap: false, pesan: "Isi nominal uang muka." };
  if (!f.date) return { siap: false, pesan: "Pilih tanggal pembayaran." };
  if (!f.cashAccountId) return { siap: false, pesan: "Pilih rekening sumber pembayaran." };
  if (!rekeningLengkap) return { siap: false, pesan: "Lengkapi cara bayar dan biaya admin." };
  if (!String(f.receiptUrl || "").trim()) return { siap: false, pesan: "Unggah bukti transfer." };
  if (melebihi) {
    if (!admin) return { siap: false, pesan: "Melebihi nilai PO — hanya Admin Finance yang boleh. Kurangi nominal." };
    if (!f.konfirmasiMelebihi) return { siap: false, pesan: "Centang konfirmasi melebihi nilai PO." };
    if (String(f.alasanMelebihi || "").trim().length < MIN_ALASAN_MELEBIHI) return { siap: false, pesan: `Isi alasan melebihi nilai PO (minimal ${MIN_ALASAN_MELEBIHI} karakter).` };
  }
  return { siap: true, pesan: "" };
}

/** Body POST /purchase-orders/:id/uang-muka — hanya kolom yang dikenal server; biaya admin lewat bodyBiayaTransfer (preset dihitung server). */
export function bodyBayarUangMuka(f, { melebihi = false } = {}) {
  return {
    amount: Number(f.amount), date: f.date, cashAccountId: f.cashAccountId, receiptUrl: String(f.receiptUrl || "").trim(),
    reference: String(f.reference || "").trim() || undefined, notes: String(f.notes || "").trim() || undefined,
    ...bodyBiayaTransfer(f),
    ...(melebihi ? { konfirmasiMelebihi: f.konfirmasiMelebihi === true, alasanMelebihi: String(f.alasanMelebihi || "").trim() } : {}),
  };
}

/** Kesiapan penerapan ke faktur: pilih uang muka, nominal ≤ saldo & ≤ sisa faktur, dan konfirmasi Finance. */
export function kesiapanTerapkan({ uangMuka, nominal, sisaFaktur, konfirmasi, konfirmasiBedaPO = false }) {
  if (!uangMuka) return { siap: false, pesan: "Pilih uang muka yang diterapkan." };
  const n = Number(nominal);
  if (!(n > 0)) return { siap: false, pesan: "Isi nominal penerapan." };
  if (n > Number(uangMuka.saldoBelumDiterapkan) + 1e-6) return { siap: false, pesan: "Nominal melebihi saldo uang muka yang belum diterapkan." };
  if (n > Number(sisaFaktur) + 1e-6) return { siap: false, pesan: "Nominal melebihi sisa faktur." };
  if (uangMuka.bedaPO && !konfirmasiBedaPO) return { siap: false, pesan: "Uang muka ini dibayar untuk PO lain — centang konfirmasi pengalihan." };
  if (!konfirmasi) return { siap: false, pesan: "Centang konfirmasi penerapan." };
  return { siap: true, pesan: "" };
}

export function bodyTerapkanUangMuka({ uangMuka, billId, nominal, sisaFaktur, konfirmasiBedaPO = false, catatan = "" }) {
  return {
    advanceId: uangMuka.id, billId, amount: Number(nominal), konfirmasi: true, sisaFakturDilihat: Number(sisaFaktur),
    ...(konfirmasiBedaPO ? { konfirmasiBedaPO: true } : {}), ...(String(catatan).trim() ? { catatan: String(catatan).trim() } : {}),
  };
}

/** Kalimat riwayat PO untuk kejadian uang muka (metadata dari server). */
export function kalimatEventUangMuka(e) {
  const m = e?.metadata || {};
  const rp = (v) => `Rp${Number(v || 0).toLocaleString("id-ID")}`;
  switch (e?.type) {
    case "UANG_MUKA_DIBAYAR": return `Uang muka ${m.dokumen || ""} dibayar ${rp(m.jumlah)}${Number(m.biayaAdmin) > 0 ? ` (+ biaya admin ${rp(m.biayaAdmin)})` : ""}${m.melebihiPO ? " — melebihi nilai PO (izin Admin Finance)" : ""}`.replace("  ", " ");
    case "UANG_MUKA_DITERAPKAN": return `Uang muka ${m.uangMuka || ""} diterapkan ${rp(m.jumlah)} ke faktur ${m.faktur || ""} · sisa faktur ${rp(m.sisaFakturSebelum)} → ${rp(m.sisaFakturSesudah)}`;
    case "UANG_MUKA_PENERAPAN_DIBATALKAN": return `Penerapan uang muka ${m.uangMuka || ""} ke faktur ${m.faktur || ""} (${rp(m.jumlah)}) dibatalkan${e.note ? ` — ${e.note}` : ""}`;
    default: return null;
  }
}
