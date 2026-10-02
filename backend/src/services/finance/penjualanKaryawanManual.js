// BACA PENJUALAN KARYAWAN MANUAL — satu sumber query untuk layar Finance, kartu Laporan, dan (nanti) export, supaya angkanya tidak mungkin berbeda.
// Modul input manual di luar Order (lihat model FinPenjualanKaryawan di schema.prisma dan posting/penjualanKaryawan.js). Murni baca + hitung.
//
// Angka SELALU dihitung di server dengan Decimal: total = Σ(qty × harga satuan) dari item; terbayar = Σ pembayaran yang belum dibatalkan; sisa = total − terbayar
// (nol untuk dokumen dibatalkan). Klien tidak menghitung apa pun.

import { toMoney, sumMoney, moneyToNumber, ZERO } from "./money.js";
import { toBookDate } from "./journal.js";

export const penjualanInclude = {
  seller: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: { orderBy: { sortOrder: "asc" } },
  payments: {
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { cashAccount: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
  },
};

/** Validasi + total item. `err(msg, status)` dari pemanggil supaya kode status konsisten dengan router. Mengembalikan { items, total }. */
export function hitungItems(items, err) {
  if (!Array.isArray(items) || items.length === 0) throw err("Minimal satu item penjualan");
  if (items.length > 50) throw err("Terlalu banyak item (maksimal 50)");
  const baris = items.map((it, i) => {
    const name = String(it?.name ?? "").trim();
    if (!name) throw err(`Nama item ke-${i + 1} wajib diisi`);
    const quantity = Number(it?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw err(`Jumlah item "${name}" harus bilangan bulat 1–1000`);
    const unitPrice = toMoney(it?.unitPrice, { field: `Harga item "${name}"` });
    if (unitPrice.lessThanOrEqualTo(0)) throw err(`Harga item "${name}" harus lebih dari 0`);
    return { name: name.slice(0, 200), quantity, unitPrice, sortOrder: i };
  });
  const total = sumMoney(baris.map((b) => b.unitPrice.times(b.quantity)));
  return { items: baris, total };
}

export const STATUS_LABEL = { DIBATALKAN: "Dibatalkan", LUNAS: "Lunas", SEBAGIAN: "Dibayar sebagian", BELUM_BAYAR: "Belum dibayar" };

/** Bentuk tampil satu dokumen: angka sebagai number, status turunan (bukan kolom — tidak bisa tidak sinkron dengan pembayaran). */
export function bentukPenjualan(p) {
  const aktif = p.payments.filter((x) => !x.cancelledAt);
  const terbayar = aktif.length ? sumMoney(aktif.map((x) => x.amount)) : ZERO;
  const total = toMoney(p.total);
  const batal = p.status === "DIBATALKAN";
  const sisa = batal ? ZERO : total.minus(terbayar);
  const status = batal ? "DIBATALKAN" : sisa.lessThanOrEqualTo(0) ? "LUNAS" : terbayar.greaterThan(0) ? "SEBAGIAN" : "BELUM_BAYAR";
  return {
    ...p,
    total: moneyToNumber(total),
    terbayar: moneyToNumber(batal ? ZERO : terbayar),
    sisa: moneyToNumber(sisa),
    statusTampil: status,
    statusLabel: STATUS_LABEL[status],
    items: p.items.map((i) => ({ ...i, unitPrice: moneyToNumber(i.unitPrice), subtotal: moneyToNumber(toMoney(i.unitPrice).times(i.quantity)) })),
    payments: p.payments.map((x) => ({ ...x, amount: moneyToNumber(x.amount) })),
  };
}

export function whereDaftar({ q, status, sellerId, from, to } = {}) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return {
    ...(sellerId && { sellerId }),
    ...(status === "DIBATALKAN" && { status: "DIBATALKAN" }),
    ...(status && status !== "DIBATALKAN" && { status: "AKTIF" }),
    ...((from || to) && { date: { ...(from && { gte: toBookDate(from) }), ...(to && { lte: toBookDate(to) }) } }),
    AND: kata.map((k) => ({ OR: [
      { nomor: { contains: k, mode: "insensitive" } }, { buyerName: { contains: k, mode: "insensitive" } }, { notes: { contains: k, mode: "insensitive" } },
      { seller: { name: { contains: k, mode: "insensitive" } } }, { items: { some: { name: { contains: k, mode: "insensitive" } } } },
    ] })),
  };
}

export async function ambilDaftar(db, filter = {}, { take = 500 } = {}) {
  const rows = await db.finPenjualanKaryawan.findMany({ where: whereDaftar(filter), orderBy: [{ date: "desc" }, { createdAt: "desc" }], take, include: penjualanInclude });
  const bentuk = rows.map(bentukPenjualan);
  // Filter status turunan (Lunas/Sebagian/Belum) dilakukan setelah angka dihitung — statusnya tidak disimpan di kolom.
  return ["LUNAS", "SEBAGIAN", "BELUM_BAYAR"].includes(filter.status) ? bentuk.filter((p) => p.statusTampil === filter.status) : bentuk;
}

/**
 * Ringkasan per karyawan penjual atas dokumen AKTIF (tidak dibatalkan). Periode (from/to, tanggal dokumen) opsional; tanpa periode = semua.
 * Dipakai layar Finance (kartu) dan kartu Penjualan Karyawan di Laporan Sales.
 */
export async function ringkasanPerKaryawan(db, { from = null, to = null } = {}) {
  const rows = await db.finPenjualanKaryawan.findMany({
    where: { status: "AKTIF", ...(from && to ? { date: { gte: toBookDate(from), lte: toBookDate(to) } } : {}) },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: penjualanInclude,
  });
  const per = new Map();
  let nilai = ZERO, terbayar = ZERO;
  for (const r of rows) {
    const b = bentukPenjualan(r);
    const cur = per.get(r.sellerId) || { sellerId: r.sellerId, nama: r.seller.name, jumlah: 0, nilai: ZERO, terbayar: ZERO, dokumen: [] };
    cur.jumlah += 1;
    cur.nilai = cur.nilai.plus(toMoney(b.total));
    cur.terbayar = cur.terbayar.plus(toMoney(b.terbayar));
    cur.dokumen.push({ id: r.id, nomor: r.nomor, tanggal: r.date.toISOString().slice(0, 10), pembeli: r.buyerName, nilai: b.total, terbayar: b.terbayar, sisa: b.sisa });
    per.set(r.sellerId, cur);
    nilai = nilai.plus(toMoney(b.total));
    terbayar = terbayar.plus(toMoney(b.terbayar));
  }
  const karyawan = [...per.values()]
    .map((c) => ({ ...c, nilai: moneyToNumber(c.nilai), terbayar: moneyToNumber(c.terbayar), sisa: moneyToNumber(c.nilai.minus(c.terbayar)) }))
    .sort((a, b) => b.sisa - a.sisa);
  return { jumlah: rows.length, nilai: moneyToNumber(nilai), terbayar: moneyToNumber(terbayar), sisa: moneyToNumber(nilai.minus(terbayar)), karyawan };
}
