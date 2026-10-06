// PENGAMAN NOMINAL PEMBAYARAN YANG DICATAT DI LAPANGAN (driver, POST /api/armada/jobs/:id/payment).
//
// Kasus nyata 6 Okt 2026: driver mengetik "1" pada pembayaran TUNAI untuk order bertagihan Rp1.200.000. Jalur ini hanya mensyaratkan "angka bulat > 0" dan langsung membukukan ke
// kas, jadi satu salah ketik langsung menggeser saldo Uang Kas. Dua pengaman (keputusan Owner 6 Okt 2026):
//   1. NOMINAL_MELEBIHI_SISA  — ditolak bila nominal > sisa tagihan order (tagihan − SEMUA Payment aktif, terverifikasi atau belum, supaya input ganda juga tertahan).
//                               Order bertagihan Rp0 (mis. sewa/titipan) tidak dibatasi — tidak ada angka pembanding yang bisa dipercaya.
//   2. NOMINAL_KECIL_PERLU_KONFIRMASI — nominal < Rp10.000 hanya diterima bila klien mengirim konfirmasi eksplisit (layar driver menampilkan "Anda memasukkan Rp1, benar?").
//                               Tidak berlaku bila sisa tagihan memang kurang dari batas itu (pelunasan kecil yang sah).
import { moneyToNumber } from "./money.js";
import { PILIH_TAGIHAN, tagihanOrder } from "./tagihanOrder.js";
import { paidForOrder } from "./allocation.js";

export const NOMINAL_KECIL_BATAS = 10_000;
const rp = (n) => `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

export class NominalPembayaranError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.code = code; this.statusCode = statusCode; }
}

/** Murni (tanpa DB): keputusan untuk satu nominal. Mengembalikan null bila boleh, atau { code, pesan }. */
export function periksaNominal({ amount, tagihan, dibayar, konfirmasiNominalKecil = false }) {
  const sisa = Math.max(Number(tagihan) - Number(dibayar), 0);
  if (tagihan > 0 && amount > sisa) {
    return {
      code: "NOMINAL_MELEBIHI_SISA",
      pesan: sisa > 0
        ? `Nominal ${rp(amount)} melebihi sisa tagihan order ini (${rp(sisa)}). Periksa kembali angkanya.`
        : `Order ini sudah tertagih penuh (${rp(tagihan)}) — tidak ada sisa untuk dibayar. Bila ini pembayaran yang sama, jangan dicatat dua kali.`,
    };
  }
  const batasKecil = tagihan > 0 && sisa < NOMINAL_KECIL_BATAS ? sisa : NOMINAL_KECIL_BATAS;
  if (amount < batasKecil && !konfirmasiNominalKecil) {
    return {
      code: "NOMINAL_KECIL_PERLU_KONFIRMASI",
      pesan: `Nominal ${rp(amount)} sangat kecil${sisa > 0 ? ` dibanding sisa tagihan ${rp(sisa)}` : ""}. Yakin angkanya benar?`,
    };
  }
  return null;
}

/** Periksa ke DB. Lempar NominalPembayaranError (422) bila ditolak. Panggil di dalam transaksi setelah mengunci order (kunciKanonis). */
export async function pastikanNominalPembayaranLapangan(db, { orderId, amount, konfirmasiNominalKecil = false }) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: PILIH_TAGIHAN });
  if (!order) return;
  const tagihan = tagihanOrder(order);
  const dibayar = moneyToNumber(await paidForOrder(db, orderId, { enabled: false }));
  const tolak = periksaNominal({ amount, tagihan, dibayar, konfirmasiNominalKecil: konfirmasiNominalKecil === true });
  if (tolak) throw new NominalPembayaranError(tolak.pesan, tolak.code);
}
