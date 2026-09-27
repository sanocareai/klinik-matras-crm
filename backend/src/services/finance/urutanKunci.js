// URUTAN KUNCI BARIS KANONIS untuk semua perintah uang order (Resi Gabungan Fase 3A hardening, 28 Sep 2026).
//
// Masalah yang ditutup: alur lama mengunci PAYMENT dulu lalu (lewat recompute) memperbarui ORDER, sedangkan alur Resi mengunci GROUP → ORDER.
// Dua transaksi yang saling menunggu dalam urutan terbalik = deadlock sporadis (Postgres membatalkan salah satunya).
//
// ATURAN (semua perintah wajib memakai urutan yang SAMA, sebelum menulis dan sebelum posting jurnal):
//   1. order_groups   — setiap grup dari order yang disentuh, id naik
//   2. "Order"        — setiap order yang disentuh, id naik
//   3. payments       — setiap payment yang disentuh, id naik
//   4. baru kemudian: tulis Payment/alokasi/status, lalu posting jurnal (kunci milik modul jurnal selalu paling akhir)
// Kunci grup berfungsi sebagai mutex Resi: perintah apa pun atas child mana pun dari Resi yang sama berjalan berurutan.

const urut = (xs) => [...new Set(xs.filter(Boolean).map(String))].sort();

async function kunciDaftar(tx, tabel, ids, cast) {
  if (ids.length === 0) return;
  const ph = ids.map((_, i) => `$${i + 1}${cast ? `::${cast}` : ""}`).join(",");
  await tx.$queryRawUnsafe(`SELECT id FROM ${tabel} WHERE id IN (${ph}) ORDER BY id FOR UPDATE`, ...ids);
}

/**
 * Kunci grup → order → payment secara deterministik. Grup diturunkan dari order (plus `groupIds` eksplisit). WAJIB di dalam transaksi.
 * Mengembalikan id yang dikunci (sudah diurutkan) untuk dipakai pemanggil.
 */
export async function kunciKanonis(tx, { groupIds = [], orderIds = [], paymentIds = [] } = {}) {
  if (!tx?.$queryRawUnsafe) throw new Error("kunciKanonis butuh klien transaksi Prisma");
  const orders = urut(orderIds);
  const dariOrder = orders.length
    ? (await tx.order.findMany({ where: { id: { in: orders } }, select: { groupId: true } })).map((o) => o.groupId)
    : [];
  const groups = urut([...groupIds, ...dariOrder]);
  const payments = urut(paymentIds);
  await kunciDaftar(tx, "order_groups", groups, null);
  await kunciDaftar(tx, '"Order"', orders, null);
  await kunciDaftar(tx, "payments", payments, "uuid");
  return { groups, orders, payments };
}

/** Order yang status bayarnya bisa berubah oleh sebuah payment: order induk + semua order tujuan alokasinya. */
export async function orderTerdampakPayment(db, paymentId) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, select: { orderId: true, finAllocations: { select: { orderId: true } } } });
  if (!p) return null;
  return urut([p.orderId, ...p.finAllocations.map((a) => a.orderId)]);
}

/**
 * Kunci kanonis untuk perintah atas SATU payment yang sudah ada (verifikasi, tolak, batal, ubah alokasi). Order terdampak dibaca tanpa kunci,
 * dikunci (grup → order → payment), lalu dibaca ULANG di bawah kunci payment (setelah itu alokasinya tidak bisa berubah: setAllocations juga
 * mengunci payment). Bila set order berubah di antara baca dan kunci, perintah DITOLAK 409 (bukan mengunci order tambahan di luar urutan).
 * `orderTambahan` = order lain yang akan disentuh (mis. tujuan alokasi baru).
 */
export async function kunciUntukPayment(tx, paymentId, { orderTambahan = [] } = {}) {
  const sebelum = await orderTerdampakPayment(tx, paymentId);
  if (!sebelum) return null;
  const target = urut([...sebelum, ...orderTambahan]);
  await kunciKanonis(tx, { orderIds: target, paymentIds: [paymentId] });
  const sesudah = await orderTerdampakPayment(tx, paymentId);
  if (!sesudah || !sesudah.every((id) => target.includes(id))) {
    throw Object.assign(new Error("Alokasi pembayaran ini baru saja berubah. Muat ulang lalu coba lagi."), { statusCode: 409, code: "ALOKASI_BERUBAH" });
  }
  return target;
}
