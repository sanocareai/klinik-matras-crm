// POSTING SISI PELANGGAN — pembayaran, pengakuan pendapatan, refund.
//
// ════════════════════════════════════════════════════════════════════════
// ATURAN AKUNTANSI YANG DIJALANKAN DI SINI (baca sebelum mengubah apa pun)
// ════════════════════════════════════════════════════════════════════════
//
// ⚠️ DP PELANGGAN BUKAN PENDAPATAN. Ini aturan paling penting di file ini,
// dan yang paling sering dilanggar sistem buatan sendiri. Uang yang masuk
// sebelum barang/jasa diserahkan adalah KEWAJIBAN (kita berutang barang ke
// customer), bukan hak kita. Kalau DP langsung diakui jadi pendapatan,
// Laba Rugi bulan berjalan akan terlihat jauh lebih besar dari kenyataan,
// dan order yang batal akan memaksa "mengurangi pendapatan" bulan berikutnya
// untuk uang yang memang tidak pernah jadi milik kita.
//
// ── TIGA KEJADIAN, TIGA JURNAL ──────────────────────────────────────────
//
// 1. UANG MASUK (Payment tercatat — dari sales saat konfirmasi order, atau
//    dari driver di stop pengiriman):
//
//       SEBELUM pendapatan diakui:
//         Dr  Kas/Bank                      xxx
//             Cr  Uang Muka Pelanggan            xxx   ← KEWAJIBAN
//
//       SESUDAH pendapatan diakui (pelunasan atas tagihan yang sudah lahir):
//         Dr  Kas/Bank                      xxx
//             Cr  Piutang Usaha                  xxx
//
//    Cabangnya ditentukan dari ADA/TIDAKNYA jurnal pengakuan pendapatan
//    untuk order itu — bukan dari status order yang bisa di-override manual.
//
// 2. PENDAPATAN DIAKUI (order benar-benar DISERAHKAN ke customer —
//    Order.status DELIVERED, atau SEWA_DIKIRIM untuk kategori sewa):
//
//         Dr  Piutang Usaha                 total
//             Cr  Pendapatan (Layanan/Produk/Sewa) nilai layanan
//             Cr  Pendapatan Ongkos Kirim        ongkir
//         Dr  Uang Muka Pelanggan           DP yang sudah diterima
//             Cr  Piutang Usaha                  DP yang sudah diterima
//
//    Baris kedua memindahkan uang muka jadi pelunasan piutang. Sisanya
//    (kalau ada) tetap berdiri sebagai Piutang Usaha — dan ITULAH angka
//    piutang yang benar, bukan "total order dikurangi apa pun".
//
//    KENAPA SAAT DISERAHKAN, BUKAN SAAT INVOICE DIKIRIM: invoice di sistem
//    ini lahir OTOMATIS sebagai draft begitu order dibuat (lihat
//    services/invoice.js) — kalau invoice jadi pemicu, seluruh order yang
//    baru masuk antrean akan langsung diakui sebagai pendapatan, termasuk
//    yang belum dikerjakan sama sekali.
//
// 3. REFUND (uang dikembalikan ke customer):
//         Dr  Retur & Potongan Penjualan / Uang Muka Pelanggan   xxx
//             Cr  Kas/Bank                                            xxx
//    Akun debetnya tergantung apakah pendapatannya sudah pernah diakui.
//
// ── YANG SENGAJA TIDAK DILAKUKAN ────────────────────────────────────────
// - `ongkirKlaimGaransi` TIDAK pernah jadi pendapatan. Itu ongkir yang KITA
//   tanggung untuk klaim garansi — biaya, bukan tagihan. Konsisten dengan
//   hitungNominal() di services/invoice.js yang juga tidak menjumlahkannya
//   ke total tagihan.
// - Order lama yang berstatus LUNAS lewat dropdown manual (228 order, lihat
//   CLAUDE.md §19) TIDAK dijurnal otomatis dari sini. Itu tugas backfill
//   terkendali yang dijalankan admin — menjurnalnya diam-diam berarti
//   mengarang tanggal & rekening untuk uang yang detailnya tidak pernah
//   dicatat.

import { postJournal, recordPostingGap, findEntryByKey, todayBookDateWIB, STATUS_DIHITUNG } from "../journal.js";
import { resolveAccount, revenueSystemKeyForOrder, SYSTEM_KEYS, AccountError } from "../accounts.js";
import { resolveCashAccountForPayment } from "../settings.js";
import { toMoney, sumMoney, minMoney, ZERO } from "../money.js";
import { paidForOrder } from "../allocation.js";
import { barisBiayaAdmin } from "../transferFee.js";

export const KEY = {
  payment: (paymentId) => `PEMBAYARAN_ORDER:${paymentId}`,
  revenue: (orderId) => `PENGAKUAN_PENDAPATAN:${orderId}`,
  refund: (refundId) => `REFUND:${refundId}`,
};

// Status order yang berarti "sudah benar-benar diserahkan ke customer".
// SEWA_DIKIRIM ikut: kasur sewa yang sudah di tangan customer berarti jasa
// sewanya sudah mulai diberikan — pendapatannya berhak diakui. SEWA_DIAMBIL
// (sewa selesai) TIDAK dimasukkan supaya tidak menghasilkan pengakuan KEDUA
// untuk order yang sama; idempotencyKey per order sudah mencegahnya, daftar
// ini cuma menjawab "kapan boleh mulai".
export const STATUS_PENGAKUAN = Object.freeze(["DELIVERED", "SEWA_DIKIRIM", "SEWA_DIAMBIL"]);

/** Apakah pendapatan order ini SUDAH diakui (dan jurnalnya belum dibatalkan)? */
async function pendapatanSudahDiakui(tx, orderId) {
  const entry = await findEntryByKey(tx, KEY.revenue(orderId));
  return Boolean(entry && entry.status === "POSTED");
}

/**
 * Jurnal untuk SATU Payment yang baru tercatat.
 *
 * TIDAK PERNAH melempar error karena konfigurasi finance belum siap —
 * pembayaran wajib tetap bisa dicatat sales/driver walau bagan akun atau
 * pemetaan rekening belum disiapkan. Kegagalan seperti itu dicatat sebagai
 * FinPostingGap (tampil di workspace Finance) lalu fungsi ini mengembalikan
 * { posted: false, gap: true }. Error yang BUKAN soal konfigurasi (jurnal
 * tidak seimbang, dsb) tetap dilempar — itu bug, bukan pekerjaan admin.
 */
export async function postPaymentReceived(tx, { paymentId, userId = null }) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, amount: true, method: true, cashAccountId: true, createdAt: true, cancelledAt: true, orderId: true,
      finAllocations: { select: { orderId: true, amount: true } },
      order: {
        select: {
          id: true, orderNumber: true, category: true, customerId: true,
          customer: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!payment) throw new Error(`Payment ${paymentId} tidak ditemukan`);
  if (payment.cancelledAt) return { posted: false, reason: "payment_dibatalkan" };

  const sudahAda = await findEntryByKey(tx, KEY.payment(paymentId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  try {
    const cashAccount = await resolveCashAccountForPayment(tx, payment);
    if (!cashAccount) {
      await recordPostingGap(tx, {
        source: "PEMBAYARAN_ORDER",
        sourceId: paymentId,
        reason: "REKENING_BELUM_DIPETAKAN",
        detail:
          `Pembayaran ${payment.method} sebesar Rp${Number(payment.amount).toLocaleString("id-ID")} ` +
          `untuk order ${payment.order?.orderNumber || payment.orderId} belum bisa dibukukan: ` +
          `rekening kas/bank untuk metode ${payment.method} belum dipilih di Finance > Pengaturan.`,
        metadata: { paymentId, method: payment.method, amount: String(payment.amount), orderId: payment.orderId },
      });
      return { posted: false, gap: true, reason: "rekening_belum_dipetakan" };
    }

    const akunKasBank = await tx.finAccount.findUnique({
      where: { id: cashAccount.accountId },
      select: { id: true },
    });
    const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
    const uangMuka = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN);

    // Alokasi menentukan order MANA yang berkurang piutang/bertambah uang
    // mukanya — satu pembayaran bisa menyentuh beberapa order sekaligus.
    const alokasi = payment.finAllocations.length > 0
      ? payment.finAllocations.map((a) => ({ orderId: a.orderId, amount: toMoney(a.amount) }))
      : [{ orderId: payment.orderId, amount: toMoney(payment.amount) }];

    const lines = [{
      accountId: akunKasBank.id,
      debit: toMoney(payment.amount),
      description: `Penerimaan ${payment.method} — ${cashAccount.name}`,
      cashAccountId: cashAccount.id,
      orderId: payment.orderId,
      customerId: payment.order?.customerId || null,
    }];

    for (const a of alokasi) {
      const diakui = await pendapatanSudahDiakui(tx, a.orderId);
      const order = a.orderId === payment.orderId
        ? payment.order
        : await tx.order.findUnique({ where: { id: a.orderId }, select: { id: true, orderNumber: true, customerId: true } });
      lines.push({
        accountId: diakui ? piutang.id : uangMuka.id,
        credit: a.amount,
        description: diakui
          ? `Pelunasan piutang order ${order?.orderNumber || a.orderId}`
          : `Uang muka pelanggan — order ${order?.orderNumber || a.orderId} (belum diserahkan)`,
        orderId: a.orderId,
        customerId: order?.customerId || null,
      });
    }

    const { entry, created } = await postJournal(tx, {
      // Tanggal buku = kapan uangnya BENAR-BENAR diterima (Payment.createdAt),
      // bukan kapan jurnalnya dibuat. Penting untuk posting susulan/backfill
      // terkendali: uang kemarin tetap masuk buku kemarin.
      date: new Date(Date.UTC(
        payment.createdAt.getUTCFullYear(), payment.createdAt.getUTCMonth(), payment.createdAt.getUTCDate()
      )),
      description: `Penerimaan pembayaran order ${payment.order?.orderNumber || payment.orderId}` +
        (payment.order?.customer?.name ? ` — ${payment.order.customer.name}` : ""),
      source: "PEMBAYARAN_ORDER",
      sourceId: paymentId,
      idempotencyKey: KEY.payment(paymentId),
      lines,
      userId,
      // Pembayaran yang tercatat mundur ke periode yang sudah ditutup tetap
      // HARUS terbukukan — uangnya nyata. Kalau periodenya tertutup, ini
      // akan gagal dan jatuh ke gap; itu memang yang diinginkan (admin
      // membuka periode atau memposting manual ke periode berjalan).
    });
    return { posted: true, entry, created };
  } catch (err) {
    if (err instanceof AccountError) {
      await recordPostingGap(tx, {
        source: "PEMBAYARAN_ORDER",
        sourceId: paymentId,
        reason: "AKUN_SISTEM_BELUM_SIAP",
        detail: `Pembayaran untuk order ${payment.order?.orderNumber || payment.orderId} belum dibukukan: ${err.message}`,
        metadata: { paymentId, amount: String(payment.amount) },
      });
      return { posted: false, gap: true, reason: "akun_belum_siap" };
    }
    throw err;
  }
}

/**
 * Jurnal PENGAKUAN PENDAPATAN untuk satu order. Idempoten per order.
 * Dipanggil saat order mencapai status "sudah diserahkan".
 *
 * Nilai yang diakui diambil dari SUMBER YANG SAMA dengan invoice yang
 * dikirim ke customer (Order.value = SUM(OrderItem.harga), ditambah
 * Order.ongkir) — kalau dua dokumen ke customer yang sama menghasilkan
 * angka berbeda, itu bug yang lebih berbahaya daripada tidak menjurnal
 * sama sekali.
 */
export async function postRevenueRecognition(tx, { orderId, userId = null, date = null }) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, category: true, value: true, ongkir: true,
      status: true, customerId: true,
      customer: { select: { id: true, name: true } },
    },
  });
  if (!order) throw new Error(`Order ${orderId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.revenue(orderId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const nilaiLayanan = toMoney(order.value || 0);
  const ongkir = toMoney(order.ongkir || 0);
  const total = nilaiLayanan.plus(ongkir);

  // Order yang belum punya item sama sekali lahir dengan value 0 (lihat
  // komentar di services/invoice.js). Mengakui pendapatan Rp0 tidak salah
  // secara matematis tapi tidak ada artinya — dan jurnal bernilai nol
  // memang ditolak postJournal. Catat sebagai gap supaya finance tahu ada
  // order yang sudah diserahkan tapi belum pernah dihargai.
  if (total.lessThanOrEqualTo(0)) {
    await recordPostingGap(tx, {
      source: "PENGAKUAN_PENDAPATAN",
      sourceId: orderId,
      reason: "NILAI_ORDER_NOL",
      detail:
        `Order ${order.orderNumber || orderId} sudah berstatus "${order.status}" tapi nilainya masih Rp0 ` +
        "(belum ada item layanan/harga). Pendapatannya belum bisa diakui sampai harganya diisi.",
      metadata: { orderId, status: order.status },
    });
    return { posted: false, gap: true, reason: "nilai_nol" };
  }

  try {
    const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
    const akunPendapatan = await resolveAccount(tx, revenueSystemKeyForOrder(order));
    const uangMuka = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN);

    const lines = [
      {
        accountId: piutang.id,
        debit: total,
        description: `Piutang atas order ${order.orderNumber || orderId}`,
        orderId, customerId: order.customerId,
      },
      {
        accountId: akunPendapatan.id,
        credit: nilaiLayanan,
        description: `Pendapatan order ${order.orderNumber || orderId}`,
        orderId, customerId: order.customerId,
      },
    ];

    if (ongkir.greaterThan(0)) {
      const akunOngkir = await resolveAccount(tx, SYSTEM_KEYS.PENDAPATAN_ONGKIR);
      lines.push({
        accountId: akunOngkir.id,
        credit: ongkir,
        description: `Ongkos kirim order ${order.orderNumber || orderId}`,
        orderId, customerId: order.customerId,
      });
    }

    // Uang muka yang SUDAH diterima untuk order ini — dipindahkan jadi
    // pelunasan piutang. Dibatasi maksimal sebesar total tagihan: kelebihan
    // bayar TETAP berdiri sebagai Uang Muka Pelanggan (kewajiban), karena
    // kelebihan itu memang masih utang kita ke customer sampai direfund
    // atau dialokasikan ke order lain.
    const uangMukaDiterima = await hitungUangMukaOrder(tx, orderId);
    const dipindahkan = minMoney(uangMukaDiterima, total);

    if (dipindahkan.greaterThan(0)) {
      lines.push({
        accountId: uangMuka.id,
        debit: dipindahkan,
        description: `Pemindahan uang muka jadi pelunasan — order ${order.orderNumber || orderId}`,
        orderId, customerId: order.customerId,
      });
      lines.push({
        accountId: piutang.id,
        credit: dipindahkan,
        description: `Piutang dilunasi uang muka — order ${order.orderNumber || orderId}`,
        orderId, customerId: order.customerId,
      });
    }

    const { entry, created } = await postJournal(tx, {
      date: date || todayBookDateWIB(),
      description:
        `Pengakuan pendapatan order ${order.orderNumber || orderId}` +
        (order.customer?.name ? ` — ${order.customer.name}` : ""),
      source: "PENGAKUAN_PENDAPATAN",
      sourceId: orderId,
      idempotencyKey: KEY.revenue(orderId),
      lines,
      userId,
    });
    return { posted: true, entry, created };
  } catch (err) {
    if (err instanceof AccountError) {
      await recordPostingGap(tx, {
        source: "PENGAKUAN_PENDAPATAN",
        sourceId: orderId,
        reason: "AKUN_SISTEM_BELUM_SIAP",
        detail: `Pendapatan order ${order.orderNumber || orderId} belum diakui: ${err.message}`,
        metadata: { orderId, total: total.toFixed(2) },
      });
      return { posted: false, gap: true, reason: "akun_belum_siap" };
    }
    throw err;
  }
}

/**
 * Total uang muka yang TERCATAT DI BUKU BESAR untuk sebuah order —
 * dihitung dari baris jurnal, BUKAN dari SUM(payments).
 *
 * Bedanya penting: pembayaran yang belum berhasil dijurnal (rekening belum
 * dipetakan, lihat gap di postPaymentReceived) TIDAK boleh ikut dipindahkan
 * jadi pelunasan piutang — kalau ikut, jurnalnya akan mendebet Uang Muka
 * yang saldonya tidak pernah ada, dan akun kewajiban itu jadi minus.
 */
async function hitungUangMukaOrder(tx, orderId) {
  const uangMuka = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN);
  const baris = await tx.finJournalLine.findMany({
    where: {
      accountId: uangMuka.id,
      orderId,
      // REVERSED ikut — lihat STATUS_DIHITUNG di journal.js.
      entry: { status: { in: STATUS_DIHITUNG } },
    },
    select: { debit: true, credit: true },
  });
  if (baris.length === 0) return ZERO;
  const kredit = sumMoney(baris.map((b) => b.credit));
  const debit = sumMoney(baris.map((b) => b.debit));
  const saldo = kredit.minus(debit); // saldo normal kewajiban = kredit
  return saldo.greaterThan(0) ? saldo : ZERO;
}

/**
 * Sisa uang yang MASIH BOLEH direfund untuk satu order — SATU tempat,
 * dipakai KEDUANYA oleh `POST /refunds` (create) dan `POST /refunds/:id/
 * approve` (SEBELUM ini diekstrak, dua endpoint itu menghitung ulang
 * rumus yang sama secara terpisah, dan endpoint approve TIDAK menghitungnya
 * sama sekali — celah yang membuat dua refund yang sama-sama MENUNGGU_
 * APPROVAL untuk order yang sama bisa disetujui satu-satu dan bersama-sama
 * mengeluarkan lebih banyak uang daripada yang pernah diterima).
 *
 * `status: "DISETUJUI"` sebagai satu-satunya filter (bukan "semua refund
 * kecuali yang ini") sudah cukup di KEDUA titik pakai: saat CREATE, refund
 * yang sedang dibuat belum punya baris sama sekali; saat APPROVE, refund
 * yang sedang disetujui MASIH berstatus MENUNGGU_APPROVAL sampai baris
 * statusnya benar-benar ditulis setelah pengecekan ini — jadi ia tidak
 * pernah ikut terhitung sebagai "refund lain yang sudah disetujui".
 *
 * WAJIB dipanggil di DALAM transaksi yang sama dengan keputusan approve —
 * lihat komentar di pemanggilnya (routes/financeTransactions.js) soal
 * kenapa ini menutup race dua approval bersamaan.
 *
 * ⚠️ `paidForOrder` SUDAH mengurangi refund yang DISETUJUI di dalam
 * hitungannya sendiri (lihat "bersih = diterima.minus(dikembalikan)" di
 * allocation.js) — jadi hasilnya di sini TIDAK BOLEH dikurangi refund
 * DISETUJUI SEKALI LAGI. Versi sebelumnya melakukan itu (bug nyata,
 * ditemukan lewat financeLedger.integration.test.js 17 Sept 2026: sisa
 * yang dilaporkan jadi NEGATIF setelah SATU SAJA refund disetujui,
 * padahal sisa sebenarnya masih positif) — akibatnya refund susulan yang
 * SAH untuk order yang sudah pernah direfund sebagian akan selalu ditolak
 * "melebihi sisa", walau uangnya jelas masih ada.
 */
export async function sisaBisaDirefund(tx, orderId, gate = { enabled: false }) {
  return paidForOrder(tx, orderId, gate);
}

/**
 * Jurnal REFUND. Akun debetnya tergantung apakah pendapatan order sudah
 * pernah diakui:
 *   - BELUM diakui  → Dr Uang Muka Pelanggan (mengembalikan kewajiban)
 *   - SUDAH diakui  → Dr Retur & Potongan Penjualan (akun kontra
 *                     pendapatan, supaya pendapatan BRUTO periode itu tidak
 *                     diubah surut — laporan yang sudah dibaca tetap utuh,
 *                     dan retur terlihat sebagai angka tersendiri)
 */
export async function postRefund(tx, { refundId, userId = null }) {
  const refund = await tx.finRefund.findUnique({
    where: { id: refundId },
    select: {
      id: true, refundNumber: true, orderId: true, amount: true, date: true, reason: true,
      cashAccountId: true, transferFeeAmount: true,
      cashAccount: { select: { id: true, name: true, accountId: true } },
      order: { select: { id: true, orderNumber: true, customerId: true } },
    },
  });
  if (!refund) throw new Error(`Refund ${refundId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.refund(refundId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const diakui = await pendapatanSudahDiakui(tx, refund.orderId);
  const akunLawan = await resolveAccount(
    tx,
    diakui ? SYSTEM_KEYS.RETUR_PENJUALAN : SYSTEM_KEYS.UANG_MUKA_PELANGGAN
  );
  // Biaya admin transfer refund = beban perusahaan, BUKAN pengurang refund ke pelanggan.
  const biayaAdmin = toMoney(refund.transferFeeAmount || 0);
  const barisAdmin = await barisBiayaAdmin(tx, { fee: biayaAdmin, cashAccount: refund.cashAccount });

  const { entry, created } = await postJournal(tx, {
    date: refund.date,
    description: `Refund ${refund.refundNumber} — order ${refund.order?.orderNumber || refund.orderId}: ${refund.reason}`,
    source: "REFUND",
    sourceId: refundId,
    idempotencyKey: KEY.refund(refundId),
    userId,
    lines: [
      {
        accountId: akunLawan.id,
        debit: toMoney(refund.amount),
        description: diakui ? "Retur penjualan" : "Pengembalian uang muka pelanggan",
        orderId: refund.orderId,
        customerId: refund.order?.customerId || null,
      },
      {
        accountId: refund.cashAccount.accountId,
        credit: toMoney(refund.amount).plus(biayaAdmin),
        description: biayaAdmin.greaterThan(0) ? `Uang keluar — ${refund.cashAccount.name} (termasuk biaya admin transfer)` : `Uang keluar — ${refund.cashAccount.name}`,
        cashAccountId: refund.cashAccountId,
        orderId: refund.orderId,
        customerId: refund.order?.customerId || null,
      },
      ...barisAdmin,
    ],
  });
  return { posted: true, entry, created };
}
