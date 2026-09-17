// ALOKASI PEMBAYARAN — "uang yang masuk ini sebenarnya untuk order yang mana".
//
// ATURAN INTI, dan ini yang membuat SELURUH data lama tetap sah tanpa
// backfill: kalau sebuah Payment TIDAK punya satu pun baris
// FinPaymentAllocation, seluruh nominalnya dianggap milik Payment.orderId —
// persis perilaku sebelum tabel alokasi ada. Alokasi eksplisit hanya lahir
// kalau finance benar-benar memecah satu pembayaran ke beberapa order
// (transfer gabungan, invoice gabungan lintas order yang memang sudah ada
// di sistem lewat Invoice.combinedIntoId).
//
// DUA hal yang TIDAK dilakukan di sini, sengaja:
//   - TIDAK menulis ke tabel Payment. Payment append-only sejak D-023.
//   - TIDAK menebak-nebak. Pembayaran yang nominalnya melebihi sisa tagihan
//     TIDAK otomatis dilempar ke order lain milik customer yang sama — itu
//     keputusan manusia (kelebihan bayar bisa saja memang mau direfund).

import { toMoney, sumMoney, ZERO, MoneyError } from "./money.js";

export class AllocationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AllocationError";
    this.statusCode = statusCode;
  }
}

/**
 * Alokasi EFEKTIF satu payment → [{ orderId, amount: Decimal }].
 * `payment` harus sudah menyertakan relasi finAllocations.
 */
export function effectiveAllocations(payment) {
  const alokasi = payment.finAllocations || [];
  if (alokasi.length === 0) {
    return [{ orderId: payment.orderId, amount: toMoney(payment.amount) }];
  }
  return alokasi.map((a) => ({ orderId: a.orderId, amount: toMoney(a.amount) }));
}

/**
 * Apakah sebuah payment IKUT DIHITUNG sebagai "uang yang sudah masuk"
 * menurut gerbang verifikasi.
 *
 * ⚠️ BACA INI SEBELUM MENGUBAH. Perilaku LAMA (dan tetap default hari ini):
 * SEMUA payment dihitung, terverifikasi atau belum — alasannya ditulis
 * panjang di services/paymentLedger.js ("uangnya sudah diterima begitu
 * Payment tercatat; verifikasi cuma mencocokkan setoran driver").
 *
 * Gerbang ini menambahkan pilihan KEDUA yang bisa dinyalakan admin: hanya
 * payment terverifikasi yang menggerakkan status bayar di CRM. Kalau
 * dinyalakan, ia HANYA berlaku untuk payment yang dibuat SEJAK tanggal
 * penyalaan (`gate.since`) — payment lama TIDAK PERNAH berubah arti secara
 * surut. Tanpa aturan "since" itu, menyalakan gerbang akan membuat ratusan
 * order yang sales anggap sudah DP mendadak balik jadi "Belum Bayar" di hari
 * yang sama, untuk uang yang sebenarnya memang sudah diterima.
 *
 * @param payment  harus menyertakan relasi `verifications`
 * @param gate     hasil getVerificationGate() dari settings.js
 */
export function isPaymentCounted(payment, gate) {
  if (payment.cancelledAt) return false;
  if (!gate?.enabled) return true;
  // Gerbang menyala tapi tanggal mulainya tidak pernah diisi = konfigurasi
  // setengah jadi. Pilih sisi AMAN: hitung apa adanya (perilaku lama),
  // jangan diam-diam menganggap semua order belum dibayar.
  if (!gate.since) return true;
  if (new Date(payment.createdAt) < gate.since) return true;
  return (payment.verifications?.length || 0) > 0;
}

/**
 * Total yang sudah dibayar untuk SATU order, menurut ledger + alokasi.
 *
 * Dua sumber yang dijumlahkan, dan keduanya perlu:
 *   (a) payment yang orderId-nya order ini DAN belum pernah dialokasikan
 *       eksplisit — nominal penuh masuk ke sini (aturan default di atas);
 *   (b) baris alokasi eksplisit yang menunjuk order ini, DARI PAYMENT MANA
 *       PUN (termasuk payment yang tercatat di order lain).
 *
 * Payment yang SUDAH punya alokasi eksplisit sengaja dikeluarkan dari (a) —
 * kalau tidak, nominalnya terhitung DUA KALI.
 */
export async function paidForOrder(db, orderId, gate = { enabled: false }) {
  const [paymentsLangsung, alokasiMasuk, refundDisetujui] = await Promise.all([
    db.payment.findMany({
      where: { orderId, cancelledAt: null },
      select: {
        id: true, amount: true, createdAt: true, cancelledAt: true,
        verifications: { select: { id: true } },
        finAllocations: { select: { id: true } },
      },
    }),
    db.finPaymentAllocation.findMany({
      where: { orderId },
      select: {
        amount: true,
        payment: {
          select: {
            id: true, createdAt: true, cancelledAt: true,
            verifications: { select: { id: true } },
          },
        },
      },
    }),
    // REFUND yang sudah DISETUJUI mengurangi "uang yang kita pegang untuk
    // order ini". Tanpa baris ini, order yang uangnya sudah dikembalikan
    // penuh akan tetap berstatus LUNAS di CRM selamanya — sales melihat
    // order lunas untuk uang yang sudah tidak ada di kas.
    //
    // Refund MENUNGGU_APPROVAL/DITOLAK sengaja TIDAK dihitung: uangnya
    // belum keluar, jadi belum mengubah apa pun.
    db.finRefund.findMany({
      where: { orderId, status: "DISETUJUI" },
      select: { amount: true },
    }),
  ]);

  const dariPaymentLangsung = paymentsLangsung
    .filter((p) => p.finAllocations.length === 0 && isPaymentCounted(p, gate))
    .map((p) => p.amount);

  const dariAlokasi = alokasiMasuk
    .filter((a) => isPaymentCounted(a.payment, gate))
    .map((a) => a.amount);

  const masuk = [...dariPaymentLangsung, ...dariAlokasi];
  const diterima = masuk.length === 0 ? ZERO : sumMoney(masuk);
  const dikembalikan = refundDisetujui.length === 0 ? ZERO : sumMoney(refundDisetujui.map((r) => r.amount));

  const bersih = diterima.minus(dikembalikan);
  // Tidak pernah negatif: refund melebihi penerimaan mustahil lolos validasi
  // pembuatan refund, tapi kalau toh terjadi (mis. pembayaran dibatalkan
  // SETELAH refundnya disetujui), "sudah dibayar minus" tidak punya arti
  // apa pun untuk status bayar — yang benar adalah BELUM_BAYAR.
  return bersih.greaterThan(0) ? bersih : ZERO;
}

/**
 * Nominal payment yang BELUM dialokasikan ke order mana pun — dipakai UI
 * "sisa yang bisa dialokasikan" dan divalidasi ulang di sini supaya alokasi
 * tidak pernah melebihi uang yang benar-benar diterima.
 */
export function unallocatedAmount(payment) {
  const total = toMoney(payment.amount);
  const alokasi = payment.finAllocations || [];
  if (alokasi.length === 0) return ZERO; // implisit penuh ke orderId asalnya
  const terpakai = sumMoney(alokasi.map((a) => a.amount));
  return total.minus(terpakai);
}

/**
 * Tetapkan ULANG alokasi sebuah payment. Menerima daftar lengkap
 * [{ orderId, amount }] — bukan tambahan parsial: alokasi adalah pembagian
 * SATU nominal, jadi menyimpannya sebagai "tambah satu baris" akan gampang
 * meninggalkan sisa yang tidak pernah dibereskan.
 *
 * Σ amount WAJIB PERSIS sama dengan Payment.amount. Menerima kurang berarti
 * ada uang yang hilang dari pembukuan; menerima lebih berarti mengarang uang.
 */
export async function setAllocations(tx, { paymentId, allocations, userId = null }) {
  if (!tx?.finPaymentAllocation) {
    throw new Error("setAllocations butuh `tx` (klien transaksi Prisma)");
  }

  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, orderId: true, cancelledAt: true },
  });
  if (!payment) throw new AllocationError("Pembayaran tidak ditemukan", 404);
  if (payment.cancelledAt) {
    throw new AllocationError("Pembayaran ini sudah dibatalkan — alokasinya tidak bisa diubah", 409);
  }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new AllocationError("Daftar alokasi tidak boleh kosong");
  }

  const bersih = allocations.map((a, i) => {
    if (!a?.orderId) throw new AllocationError(`Baris alokasi ke-${i + 1}: order wajib dipilih`);
    let amount;
    try {
      amount = toMoney(a.amount, { field: `Nominal alokasi baris ke-${i + 1}` });
    } catch (e) {
      throw new AllocationError(e.message);
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new AllocationError(`Baris alokasi ke-${i + 1}: nominal harus lebih dari 0`);
    }
    return { orderId: a.orderId, amount, note: a.note || null };
  });

  const orderIds = bersih.map((b) => b.orderId);
  if (new Set(orderIds).size !== orderIds.length) {
    throw new AllocationError("Satu order tidak boleh muncul dua kali dalam satu alokasi");
  }

  const total = sumMoney(bersih.map((b) => b.amount));
  const nominalPayment = toMoney(payment.amount);
  if (!total.equals(nominalPayment)) {
    throw new AllocationError(
      `Total alokasi ${total.toFixed(2)} tidak sama dengan nominal pembayaran ${nominalPayment.toFixed(2)}. ` +
      "Seluruh nominal pembayaran wajib teralokasi — tidak boleh ada sisa yang menggantung."
    );
  }

  // Order tujuan harus ADA (dan bukan order yang sudah dibatalkan).
  const orders = await tx.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, status: true, customerId: true },
  });
  if (orders.length !== orderIds.length) {
    throw new AllocationError("Ada order tujuan yang tidak ditemukan", 404);
  }
  const dibatalkan = orders.filter((o) => o.status === "CANCELLED");
  if (dibatalkan.length > 0) {
    throw new AllocationError(
      "Pembayaran tidak boleh dialokasikan ke order yang dibatalkan — pakai Refund kalau uangnya harus dikembalikan"
    );
  }

  // Ganti total, bukan tambah — lihat alasan di docstring.
  await tx.finPaymentAllocation.deleteMany({ where: { paymentId } });
  for (const b of bersih) {
    await tx.finPaymentAllocation.create({
      data: { paymentId, orderId: b.orderId, amount: b.amount, note: b.note, createdById: userId },
    });
  }

  // Order yang TERDAMPAK = tujuan baru + order asal payment (kalau uangnya
  // dipindah keluar dari sana, status bayarnya ikut turun).
  return [...new Set([...orderIds, payment.orderId])];
}

export { MoneyError };
