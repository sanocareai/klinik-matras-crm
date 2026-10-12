// Kredit closing saat percakapan berpindah tangan — keputusan Owner 11 Okt 2026 (opsi B): "yang penting tidak tertukar lagi, dan jelas".
//
// Masalah lama: order TANPA pemilik tersimpan (88% order) dikreditkan ke pemegang percakapan SEKARANG (services/salesOwner.js#atribusiOrderWhere),
// jadi setiap transfer/ambil alih diam-diam memindahkan kredit SEMUA order pelanggan itu, termasuk yang sudah lama dan sudah dikerjakan orang lain.
// Sebaliknya order yang punya pemilik tersimpan tidak ikut transfer sama sekali, sehingga admin mengira kredit sudah pindah padahal belum.
//
// Aturan baru: saat percakapan berpindah dari sales AKTIF `dari`, setiap order non-batal pelanggan itu yang SEKARANG dikreditkan ke `dari`
// mendapat keputusan eksplisit — IKUT pindah ke penerima (pemilik order = penerima, alasan wajib, diaudit) atau TETAP (pemilik order dikunci ke `dari`,
// diaudit). Setelah ini tidak ada order yang kreditnya bergeser tanpa jejak. Tanpa keputusan (klien lama / takeover) = TETAP: aman, tidak mengubah angka.
// Mengunci order yang kreditnya sudah ke `dari` TIDAK mengubah angka laporan hari ini; hanya mencegah geser di masa depan.
//
// Berlaku untuk SETIAP pemegang lama — termasuk Sales yang sudah NONAKTIF dan Admin/leader (revisi 11 Okt 2026 malam). Laporan per-sales hanya menghitung
// Sales aktif, jadi order milik pemegang nonaktif/Admin hari ini tidak masuk angka siapa pun; tanpa penguncian, begitu chat-nya ditransfer order lama itu
// (mis. 24 order lunas Juli–Agustus milik Mila/Farhan, Rp61 juta) diam-diam menjadi kredit penerima — termasuk di laporan periode yang sudah lewat.
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { tetapkanPemilikSales } from "../services/salesOwner.js";

export const ALASAN_KUNCI = "Dikunci ke pemegang sebelumnya saat percakapan berpindah tangan (kredit closing tidak ikut berpindah)";

async function salesAktif(db, userId) {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, active: true } });
  return u && u.active && u.role === "SALES" ? u : null;
}

/**
 * Order yang kreditnya SEKARANG ada pada `dariUserId` dan akan terpengaruh bila percakapan pelanggan ini berpindah.
 * Kosong hanya bila percakapan belum punya pemegang (tidak ada pihak yang kreditnya bisa "tertukar").
 */
export async function orderTerdampak(db, { customerId, dariUserId }) {
  if (!customerId || !dariUserId) return [];
  const rows = await db.order.findMany({
    where: {
      customerId, status: { not: "CANCELLED" }, penjualanKaryawanId: null, staffSellerId: null,
      OR: [{ salesOwnerId: dariUserId }, { salesOwnerId: null }],
    },
    select: { id: true, orderNumber: true, value: true, status: true, paymentStatus: true, paidAt: true, salesOwnerId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((o) => ({
    id: o.id, orderNumber: o.orderNumber, value: o.value, status: o.status, paymentStatus: o.paymentStatus, paidAt: o.paidAt,
    createdAt: o.createdAt,
    sumber: o.salesOwnerId ? "PEMILIK_ORDER" : "PEMEGANG_PERCAKAPAN",
    // Saran bawaan: order yang BELUM lunas ikut (komisi belum dihitung); yang sudah lunas tetap (komisi sudah terhitung di pemegang lama).
    sarankanIkut: o.paymentStatus !== "LUNAS",
  }));
}

/**
 * Terapkan keputusan DI DALAM transaksi pemanggil. `keputusan` = [{ orderId, ikut }]; order tanpa keputusan = TETAP.
 * @returns {{ikut: number, tetap: number}}
 */
export async function terapkanKeputusanKredit(tx, { daftar, keputusan = [], dariUserId, keUserId, aktorId, alasan }) {
  const penerima = await salesAktif(tx, keUserId); // null bila penerima Admin/non-Sales → "ikut" tidak mungkin, otomatis TETAP
  const ikutIds = new Set(keputusan.filter((k) => k && k.ikut === true).map((k) => String(k.orderId)));
  let ikut = 0; let tetap = 0;
  for (const o of daftar) {
    if (ikutIds.has(o.id) && penerima) {
      await tetapkanPemilikSales(tx, { orderId: o.id, userIdBaru: penerima.id, alasan, aktorId });
      ikut += 1;
    } else {
      if (!o.salesOwnerIdTersimpan && o.sumber === "PEMEGANG_PERCAKAPAN") {
        await tx.order.update({ where: { id: o.id }, data: { salesOwnerId: dariUserId } });
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.ORDER, entityId: o.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktorId,
          metadata: { aksi: "kunci_sales_owner", orderNumber: o.orderNumber, reason: ALASAN_KUNCI, before: { salesOwnerId: null }, after: { salesOwnerId: dariUserId } },
        });
      }
      tetap += 1;
    }
  }
  return { ikut, tetap };
}

/** Normalisasi `daftar` untuk terapkanKeputusanKredit (menandai order yang belum punya pemilik tersimpan). */
export function siapkanDaftar(terdampak) {
  return terdampak.map((o) => ({ ...o, salesOwnerIdTersimpan: o.sumber === "PEMILIK_ORDER" }));
}
