// JEMBATAN dari workspace LAIN ke buku besar — dipanggil dari routes/orders.js,
// routes/armada.js, services/orderStatusSync.js, dan seterusnya.
//
// ════════════════════════════════════════════════════════════════════════
// ATURAN TUNGGAL FILE INI: FINANCE TIDAK BOLEH MENJATUHKAN OPERASIONAL.
// ════════════════════════════════════════════════════════════════════════
//
// Sales mencatat DP, driver mencatat pembayaran di stop pengiriman, order
// berubah jadi DELIVERED — semua itu WAJIB tetap berhasil walau modul
// finance belum disiapkan sama sekali (bagan akun belum dipasang, rekening
// kas belum dipetakan, periode kebetulan tertutup). Kalau tidak, menyalakan
// Finance Workspace berarti menghentikan pekerjaan 7 orang di jam kerja.
//
// KONSEKUENSINYA, DAN INI YANG MEMBUATNYA TIDAK BERBAHAYA: kegagalan
// KONFIGURASI tidak pernah hilang diam-diam. Ia tercatat sebagai
// FinPostingGap yang tampil sebagai daftar pekerjaan di workspace Finance,
// lengkap dengan kalimat apa yang harus dibereskan, dan bisa diposting
// ulang (idempoten) begitu penyebabnya diperbaiki. Laporan keuangan JUJUR
// menyebut jumlah gap yang masih terbuka alih-alih menyajikan angka yang
// diam-diam kurang.
//
// Yang TETAP dilempar dan menjatuhkan transaksi: bug sungguhan (jurnal
// tidak seimbang, akun tidak ditemukan padahal id-nya dioper kode kita
// sendiri). Itu bukan pekerjaan admin, dan menelannya berarti menyembunyikan
// kerusakan.
//
// ⚠️ CATATAN TRANSAKSI POSTGRES. Fungsi di sini menangkap error yang
// dilempar SEBELUM ada statement SQL yang gagal (JournalError dari validasi
// & pemeriksaan periode, AccountError dari resolver akun) — di titik itu
// transaksi masih sehat, jadi recordPostingGap() sesudahnya pasti bisa
// jalan. Error yang datang DARI Postgres (mis. unique violation) TIDAK
// ditangkap di sini dengan sengaja: transaksi sudah aborted, dan satu-
// satunya jalan yang benar adalah membiarkan seluruh transaksi rollback
// lalu diulang — bukan mencoba menulis apa pun lagi ke transaksi mati.

import { postPaymentReceived, postRevenueRecognition, STATUS_PENGAKUAN, KEY } from "./posting/orderRevenue.js";
import { recordPostingGap, findEntryByKey, reverseJournal, JournalError } from "./journal.js";
import { AccountError } from "./accounts.js";

function bolehDitelan(err) {
  return err instanceof JournalError || err instanceof AccountError;
}

/**
 * Bukukan satu Payment yang baru tercatat. Tidak pernah menjatuhkan
 * pencatatan pembayarannya sendiri.
 */
export async function bukukanPembayaran(tx, { paymentId, userId = null }) {
  try {
    return await postPaymentReceived(tx, { paymentId, userId });
  } catch (err) {
    if (!bolehDitelan(err)) throw err;
    await recordPostingGap(tx, {
      source: "PEMBAYARAN_ORDER",
      sourceId: paymentId,
      reason: "POSTING_DITOLAK",
      detail: `Pembayaran tercatat tapi belum masuk buku besar: ${err.message}`,
      metadata: { paymentId },
    });
    return { posted: false, gap: true, reason: "posting_ditolak" };
  }
}

/**
 * Bukukan pengakuan pendapatan kalau order MEMANG sudah diserahkan.
 * Aman dipanggil dari titik mana pun yang mengubah status order — fungsi
 * ini sendiri yang memutuskan apakah statusnya layak diakui, sehingga
 * pemanggil tidak perlu menyalin daftar status ke banyak tempat (daftarnya
 * satu: STATUS_PENGAKUAN di posting/orderRevenue.js).
 */
export async function bukukanPengakuanPendapatan(tx, { orderId, status = null, userId = null }) {
  let statusOrder = status;
  if (!statusOrder) {
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { status: true } });
    statusOrder = o?.status || null;
  }
  if (!STATUS_PENGAKUAN.includes(statusOrder)) return { posted: false, reason: "belum_diserahkan" };

  try {
    return await postRevenueRecognition(tx, { orderId, userId });
  } catch (err) {
    if (!bolehDitelan(err)) throw err;
    await recordPostingGap(tx, {
      source: "PENGAKUAN_PENDAPATAN",
      sourceId: orderId,
      reason: "POSTING_DITOLAK",
      detail: `Order sudah diserahkan tapi pendapatannya belum masuk buku besar: ${err.message}`,
      metadata: { orderId, status: statusOrder },
    });
    return { posted: false, gap: true, reason: "posting_ditolak" };
  }
}

/**
 * Batalkan jurnal sebuah pembayaran yang baru saja ditandai batal di CRM
 * (POST /orders/:id/payments/:paymentId/cancel).
 *
 * Jurnalnya TIDAK dihapus — dibalik (reversal), sesuai aturan 4 di kepala
 * schema finance. Kalau pembayaran itu memang belum pernah terbukukan
 * (mis. rekening belum dipetakan, jadi cuma ada FinPostingGap), fungsi ini
 * TIDAK melakukan apa pun selain menutup gap-nya: tidak ada yang perlu
 * dibalik, dan gap itu sudah tidak relevan lagi.
 */
export async function batalkanJurnalPembayaran(tx, { paymentId, reason, userId = null }) {
  const entry = await findEntryByKey(tx, KEY.payment(paymentId));

  if (!entry || entry.status !== "POSTED") {
    const gap = await tx.finPostingGap.findUnique({
      where: { source_sourceId: { source: "PEMBAYARAN_ORDER", sourceId: paymentId } },
    });
    if (gap && !gap.resolvedAt) {
      await tx.finPostingGap.update({
        where: { id: gap.id },
        data: {
          resolvedAt: new Date(),
          detail: `${gap.detail} — pembayaran dibatalkan, tidak perlu dibukukan lagi.`,
        },
      });
    }
    return { reversed: false, reason: "belum_pernah_terbukukan" };
  }

  try {
    const reversal = await reverseJournal(tx, {
      entryId: entry.id,
      reason: reason || "Entri pembayaran dibatalkan di CRM",
      userId,
    });
    return { reversed: true, reversal };
  } catch (err) {
    if (!bolehDitelan(err)) throw err;
    // Umumnya: periode jurnal aslinya sudah ditutup DAN periode hari ini
    // juga ditutup. Pembatalan di CRM tetap berlaku; bukunya menyimpan
    // pekerjaan yang harus dibereskan admin.
    await recordPostingGap(tx, {
      source: "REVERSAL",
      sourceId: entry.id,
      reason: "REVERSAL_DITOLAK",
      detail:
        `Pembayaran dibatalkan di CRM tapi jurnal ${entry.entryNumber} belum bisa dibalik: ${err.message}. ` +
        "Buku besar masih memuat penerimaan ini — balikkan manual dari Finance > Jurnal Umum.",
      metadata: { paymentId, entryId: entry.id },
    });
    return { reversed: false, gap: true };
  }
}

export { STATUS_PENGAKUAN };
