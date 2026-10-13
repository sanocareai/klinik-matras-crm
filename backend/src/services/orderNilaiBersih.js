// NILAI BERSIH ORDER — SATU sumber untuk semua laporan penjualan, target, komisi, nilai pelanggan, dan tampilan nilai order.
//
// Definisi (Okt 2026, keputusan Owner setelah kasus Sofyan RES-07102026-037):
//   Nilai bersih = Order.value − Σ Nota Kredit/Keringanan AKTIF pada order itu (FinOrderCredit.status = 'AKTIF').
//
// KENAPA ADA FILE INI. Nota Kredit mengurangi TAGIHAN di sisi keuangan dan sengaja TIDAK mengubah Order.value (nilai item order). Setiap laporan yang menjumlah
// Order.value mentah (omset, "Lunas"/komisi, target sales, nilai pelanggan, pipeline, promo, MCP, webhook…) otomatis memakai angka KOTOR — padahal potongan
// harga yang sah memang mengurangi penjualan. Itu bug nyata: order Sofyan 4,3 jt dengan nota 200 rb masuk komisi Fadlan 4,3 jt, seharusnya 4,1 jt.
//
// ATURAN KERAS: jangan pernah menjumlah/menampilkan `Order.value` mentah untuk makna "nilai penjualan". Pakai:
//   • aggregateBersih / groupByBersih   — pengganti drop-in prisma.order.aggregate / groupBy (bentuk hasil sama; _sum.value & _avg.value sudah bersih),
//   • nilaiBersihPerOrder(db, rows)     — untuk daftar order yang sudah dimuat (tambah `nilaiBersih` & `notaKredit` per baris),
//   • NILAI_BERSIH_SQL                  — fragmen SQL untuk $queryRaw (alias tabel Order WAJIB `o`),
//   • nilaiBersih(order)                — bila select order SUDAH memuat PILIH_KREDIT (orderCredits).
// Pengecualian yang disengaja (nilai KOTOR memang benar, mis. dokumen yang dibuat SEBELUM nota ada) wajib terdaftar di docs/AUDIT-NILAI-BERSIH.md
// dan tes `nilaiBersihRegistry.test.js` menggagalkan build bila ada pemakai Order.value baru yang tidak terdaftar.
import { Prisma } from "@prisma/client";

/** Fragmen select Prisma: memuat nota kredit AKTIF pada order (untuk nilaiBersih()). */
export const PILIH_KREDIT = Object.freeze({ orderCredits: { where: { status: "AKTIF" }, select: { amount: true } } });

/** Σ nota kredit aktif dari relasi `orderCredits` yang sudah dimuat (0 bila relasi tidak dimuat — pemanggil bertanggung jawab memuatnya). */
export function kreditDariRelasi(order) {
  return (order?.orderCredits ?? []).reduce((s, c) => s + (Math.round(Number(c.amount)) || 0), 0);
}

/** Nilai bersih satu order yang select-nya memuat PILIH_KREDIT. Tidak pernah negatif. */
export function nilaiBersih(order) {
  return Math.max(0, (Number(order?.value) || 0) - kreditDariRelasi(order));
}

/**
 * Fragmen SQL nilai bersih per order untuk $queryRaw. Alias tabel Order WAJIB `o` ("Order" o). Subquery terkorelasi — tidak butuh JOIN tambahan, aman dipakai di
 * dalam SUM()/FILTER()/CASE. Contoh: SUM(${NILAI_BERSIH_SQL}) FILTER (WHERE o.status NOT IN (...)).
 */
export const NILAI_BERSIH_SQL = Prisma.sql`GREATEST(0, o.value - COALESCE((SELECT SUM(k.amount) FROM fin_order_credits k WHERE k.order_id = o.id AND k.status = 'AKTIF'), 0))`;

/** Σ nota kredit aktif per order untuk daftar id → Map(orderId → rupiah). */
export async function kreditAktifPerOrder(db, orderIds) {
  const ids = [...new Set((orderIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db.finOrderCredit.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, status: "AKTIF" }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.orderId, Math.round(Number(r._sum.amount ?? 0))]));
}

/** Tambah `notaKredit` & `nilaiBersih` pada tiap baris order (yang punya `id` & `value`). Mengembalikan array baru; baris asli tidak diubah. */
export async function nilaiBersihPerOrder(db, rows) {
  const peta = await kreditAktifPerOrder(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const nk = peta.get(r.id) ?? 0;
    return { ...r, notaKredit: nk, nilaiBersih: Math.max(0, (Number(r.value) || 0) - nk) };
  });
}

/** Σ nota kredit aktif untuk order yang cocok `where` (filter order yang sama persis dengan query nilainya). */
export async function kreditAktifTotal(db, where) {
  const r = await db.finOrderCredit.aggregate({ where: { status: "AKTIF", order: where }, _sum: { amount: true } });
  return Math.round(Number(r._sum.amount ?? 0));
}

/**
 * Pengganti drop-in `db.order.aggregate(args)` — `args.where` + `_count` / `_sum.value` / `_avg.value` memakai NILAI BERSIH. Bentuk hasil identik dengan Prisma.
 * Agregat lain selain value (mis. _sum.quantity) diteruskan apa adanya. Rata-rata (_avg.value) dihitung ulang dari jumlah bersih ÷ jumlah order bernilai-non-null.
 */
export async function aggregateBersih(db, args) {
  const hasil = await db.order.aggregate(args);
  if (!args._sum?.value && !args._avg?.value) return hasil;
  const where = args.where ?? {};
  const kredit = await kreditAktifTotal(db, where);
  const brutoSum = args._sum?.value ? (hasil._sum?.value ?? 0) : null;
  if (args._avg?.value) {
    const n = typeof hasil._count === "number" ? hasil._count : (hasil._count?._all ?? (await db.order.count({ where })));
    const bruto = brutoSum ?? (hasil._avg?.value ?? 0) * n;
    hasil._avg = { ...hasil._avg, value: n > 0 ? Math.max(0, bruto - kredit) / n : null };
  }
  if (args._sum?.value) hasil._sum = { ...hasil._sum, value: Math.max(0, (brutoSum ?? 0) - kredit) };
  return hasil;
}

/**
 * Pengganti drop-in `db.order.groupBy({ by, where, _count, _sum })` — `_sum.value` per grup memakai NILAI BERSIH. `by` HARUS kolom skalar Order.
 */
export async function groupByBersih(db, args) {
  const baris = await db.order.groupBy(args);
  if (!args._sum?.value) return baris;
  const by = Array.isArray(args.by) ? args.by : [args.by];
  const select = Object.fromEntries(by.map((k) => [k, true]));
  const kredit = await db.finOrderCredit.findMany({ where: { status: "AKTIF", order: args.where ?? {} }, select: { amount: true, order: { select } } });
  if (kredit.length === 0) return baris;
  const kunci = (o) => JSON.stringify(by.map((k) => o[k] ?? null));
  const peta = new Map();
  for (const k of kredit) peta.set(kunci(k.order), (peta.get(kunci(k.order)) ?? 0) + Math.round(Number(k.amount)));
  return baris.map((g) => {
    const nk = peta.get(kunci(g)) ?? 0;
    return nk === 0 ? g : { ...g, _sum: { ...g._sum, value: Math.max(0, (g._sum?.value ?? 0) - nk) } };
  });
}
