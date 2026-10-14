// "MENUNGGU PENENTUAN ALUR PRODUKSI" + penerapan pemetaan rute KEMUDIAN (14 Okt 2026).
//
// Di mode TRANSISI (services/produksiRuteMode.js) item PKR tanpa rute tetap disimpan dan unitnya dibuat TANPA menebak rute. Status "Menunggu alur" TIDAK disimpan sebagai kolom baru —
// ia TURUNAN dari data unit: BARU → alur produk unit (lini+jenis) = UNCONFIRMED; LAYANAN → unit belum punya layanan produksi. Begitu Admin Produksi memetakan rute di katalog,
// pratinjau di sini menunjukkan unit mana yang akan DISTEMPEL (hanya yang belum mulai) dan penerapan menulisnya, idempoten, dengan audit.
// Penerapan TIDAK mengubah tahap/status Produksi, jurnal, stok, atau harga; unit yang sudah mulai tidak disentuh.
import { classifyProduct } from "../lib/domain/productionBuildTrack.js";
import { produkUnit } from "../lib/domain/unitKategori.js";
import { pemetaanRute } from "../lib/domain/pkrItem.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { tryProvisionUnitRoute } from "./productionRouting.js";

const STATUS_BELUM_MULAI = ["AWAITING_PICKUP", "RECEIVED"];
const TEKS_MENUNGGU = "Menunggu penentuan alur Produksi";

export class RuteTerapkanError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.name = "RuteTerapkanError"; this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}

const untukRute = (c) => ({ code: c.code, name: c.name, productLine: c.productLine ?? null, productType: c.productType ?? null, productionServiceId: c.productionServiceId ?? null });
const untukProduk = (p) => ({ id: p.id, name: p.name, productLine: p.productLine ?? null, productType: p.productType ?? null, productionServiceId: p.productionServiceId ?? null });

/** Apakah SATU unit sedang menunggu alur? Murni (dipakai juga oleh read model). */
export function unitMenungguAlur(unit, order, workKind = null) {
  // Unit yang SUDAH selesai diproduksi/berangkat/terkirim/batal bukan lagi "menunggu alur" (rutenya tidak lagi menentukan apa pun) — jangan menempelkan label yang menyesatkan.
  if (["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"].includes(unit.status)) return false;
  const jenis = workKind ?? unit.workCategory ?? order?.category ?? null;
  if (jenis === "LAYANAN") return !unit.serviceId;
  const { productLine, productType } = produkUnit(unit, order);
  return classifyProduct({ productLine, productType }).flow === "UNCONFIRMED";
}

const ITEM_INCLUDE = {
  units: { include: { unit: { select: { id: true, unitCode: true, seq: true, status: true, currentStageId: true, productLine: true, productType: true, serviceId: true, workCategory: true } } } },
};

async function ruteSekarang(db, row) {
  const [kategori, produk] = await Promise.all([
    db.pkrItemCategory.findUnique({ where: { id: row.categoryId } }),
    row.productId ? db.pkrItemProduct.findUnique({ where: { id: row.productId } }) : null,
  ]);
  if (!kategori) return { ok: false, kode: "KATEGORI_HILANG", pesan: "Kategori katalog tidak ditemukan." };
  return pemetaanRute({ kategori: untukRute(kategori), produk: produk && untukProduk(produk), jenisKerja: row.workKind }, classifyProduct);
}

/** Pratinjau per order: item/unit yang menunggu, apa yang akan distempel, dan yang dilewati (sudah mulai / rute masih kosong). TIDAK menulis. */
export async function pratinjauTerapkanAlur(db, { orderId }) {
  const order = await db.order.findUnique({ where: { id: String(orderId ?? "") }, select: { id: true, orderNumber: true, status: true, category: true, productLine: true, productType: true, penjualanKaryawanId: true, penjualanKaryawan: { select: { nomor: true } } } });
  if (!order || !order.penjualanKaryawanId) throw new RuteTerapkanError("Order Penjualan Karyawan tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  const rows = await db.pkrOrderItem.findMany({ where: { orderId: order.id, removedAt: null }, orderBy: { seq: "asc" }, include: ITEM_INCLUDE });
  const item = [];
  for (const row of rows) {
    const unit = row.units.map((x) => x.unit).filter((u) => u.status !== "CANCELLED").sort((a, b) => a.seq - b.seq);
    const menunggu = unit.filter((u) => unitMenungguAlur(u, order, row.workKind));
    if (menunggu.length === 0) continue;
    const rute = await ruteSekarang(db, row);
    const bisaMulai = (u) => u.currentStageId == null && STATUS_BELUM_MULAI.includes(u.status);
    item.push({
      no: row.seq, produk: row.productName || row.categoryName, kategori: row.categoryName, jenisKerja: row.workKind,
      rute: { ok: rute.ok, pesan: rute.ok ? null : rute.pesan, kode: rute.kode ?? null, productLine: rute.productLine ?? null, productType: rute.productType ?? null, alurLabel: rute.alurLabel ?? null },
      akanDiterapkan: rute.ok ? menunggu.filter(bisaMulai).map((u) => u.unitCode) : [],
      dilewati: [
        ...(rute.ok ? menunggu.filter((u) => !bisaMulai(u)).map((u) => ({ unit: u.unitCode, alasan: "Produksi sudah mulai mengerjakan unit ini — alur tidak diubah." })) : menunggu.map((u) => ({ unit: u.unitCode, alasan: "Rute di katalog masih belum dipetakan." }))),
      ],
      tindakan: rute.ok ? null : "Buka Pengaturan Produksi › Katalog Item PKR, petakan rute Produksinya, lalu terapkan di sini.",
    });
  }
  const total = item.reduce((n, i) => n + i.akanDiterapkan.length, 0);
  return {
    order: { id: order.id, nomor: order.orderNumber, pkr: order.penjualanKaryawan?.nomor ?? null, status: order.status },
    status: item.length === 0 ? "ALUR_JELAS" : "MENUNGGU_ALUR", statusLabel: item.length === 0 ? "Alur Produksi sudah jelas" : TEKS_MENUNGGU,
    item, bisaDiterapkan: total > 0, jumlahUnitAkanDiterapkan: total,
    catatan: "Penerapan hanya menstempel lini/jenis produk (atau layanan produksi) pada unit yang BELUM mulai. Tidak mengubah tahap Produksi, status unit, jurnal, stok, atau harga.",
  };
}

/** Daftar order PKR yang unitnya menunggu alur (untuk layar Admin Produksi). */
export async function daftarMenungguAlur(db, { batas = 100 } = {}) {
  const orders = await db.order.findMany({
    where: { penjualanKaryawanId: { not: null }, status: { notIn: ["CANCELLED", "DELIVERED"] }, units: { some: { status: { not: "CANCELLED" } } } },
    select: { id: true, orderNumber: true, penjualanKaryawan: { select: { nomor: true } }, customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(batas) || 100, 1), 300),
  });
  const hasil = [];
  for (const o of orders) {
    const p = await pratinjauTerapkanAlur(db, { orderId: o.id });
    if (p.status === "MENUNGGU_ALUR") hasil.push({ orderId: o.id, nomor: o.orderNumber, pkr: o.penjualanKaryawan?.nomor ?? null, customer: o.customer?.name ?? null, jumlahItem: p.item.length, jumlahUnit: p.item.reduce((n, i) => n + i.akanDiterapkan.length + i.dilewati.length, 0), bisaDiterapkan: p.bisaDiterapkan, jumlahUnitAkanDiterapkan: p.jumlahUnitAkanDiterapkan, item: p.item.map((i) => ({ no: i.no, produk: i.produk, ruteOk: i.rute.ok, pesan: i.rute.pesan })) });
  }
  return hasil;
}

/** Terapkan pemetaan (satu order, atomik di transaksi pemanggil). Idempoten: unit yang sudah distempel dilewati; tanpa perubahan → { diterapkan: [] }. */
export async function terapkanAlur(tx, { orderId, userId = null, alasan = null }) {
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', String(orderId ?? ""));
  const order = await tx.order.findUnique({ where: { id: String(orderId ?? "") }, select: { id: true, status: true, penjualanKaryawanId: true, orderNumber: true, penjualanKaryawan: { select: { nomor: true } } } });
  if (!order || !order.penjualanKaryawanId) throw new RuteTerapkanError("Order Penjualan Karyawan tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  if (order.status === "CANCELLED") throw new RuteTerapkanError("Order sudah dibatalkan", 409, "ORDER_DIBATALKAN");
  await tx.$queryRawUnsafe('SELECT id FROM units WHERE order_id = $1 ORDER BY id FOR UPDATE', order.id);
  const p = await pratinjauTerapkanAlur(tx, { orderId: order.id });
  const diterapkan = []; const dilewati = [];
  const rows = await tx.pkrOrderItem.findMany({ where: { orderId: order.id, removedAt: null }, orderBy: { seq: "asc" }, include: ITEM_INCLUDE });
  for (const it of p.item) {
    for (const d of it.dilewati) dilewati.push({ item: it.no, ...d });
    if (!it.rute.ok || it.akanDiterapkan.length === 0) continue;
    const row = rows.find((r) => r.seq === it.no);
    const unit = row.units.map((x) => x.unit).filter((u) => it.akanDiterapkan.includes(u.unitCode));
    const ids = unit.map((u) => u.id);
    if (row.workKind === "LAYANAN") {
      const svc = it.rute.serviceId ?? (await ruteSekarang(tx, row)).serviceId;
      const layanan = svc ? await tx.serviceCatalog.findUnique({ where: { id: svc } }) : null;
      if (!layanan) { for (const u of unit) dilewati.push({ item: it.no, unit: u.unitCode, alasan: "Layanan produksi di katalog tidak ditemukan." }); continue; }
      await tx.unit.updateMany({ where: { id: { in: ids } }, data: { serviceId: layanan.id, serviceLine: layanan.serviceLine } });
      for (const id of ids) await tryProvisionUnitRoute(tx, id, layanan.id, userId);
    } else {
      await tx.unit.updateMany({ where: { id: { in: ids } }, data: { productLine: it.rute.productLine ?? null, productType: it.rute.productType ?? null } });
    }
    diterapkan.push(...unit.map((u) => u.unitCode));
  }
  if (diterapkan.length > 0) {
    const meta = { aksi: "alur_diterapkan", nomorPkr: order.penjualanKaryawan?.nomor ?? null, penjualanId: order.penjualanKaryawanId, orderId: order.id, unit: diterapkan, dilewati: dilewati.map((d) => d.unit), alasan: alasan ? String(alasan).slice(0, 500) : null };
    await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: order.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: order.penjualanKaryawanId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  }
  return { orderId: order.id, nomor: order.orderNumber, diterapkan, dilewati, berubah: diterapkan.length > 0 };
}
