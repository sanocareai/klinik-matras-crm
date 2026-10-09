// SINKRONISASI PENJUALAN KARYAWAN (PKR Finance) → ORDER CRM → UNIT PRODUKSI → DELIVERY.
//
// PRINSIP (jangan dilanggar):
//   1. PKR (fin_penjualan_karyawan) tetap SATU-SATUNYA sumber nominal, cicilan, pembayaran, piutang, dan jurnal. Order CRM hasil sinkronisasi HANYA dokumen operasional:
//      value = 0, tanpa OrderItem, tanpa Payment, tanpa invoice, tanpa jurnal, salesOwnerId = null. Trigger DB (migrasi 20261031090000) menolak payments / invoices / baris
//      jurnal / OrderItem baru yang menunjuk order ini; kode aplikasi menolak lebih dulu dengan pesan yang jelas.
//   2. Tautan PKR ↔ Order 1:1: UNIQUE pada Order.penjualanKaryawanId. Pembuatan di bawah KUNCI BARIS PKR (lockRowForUpdate) dan idempoten: permintaan ulang / paralel mengembalikan
//      order yang sama, tidak pernah membuat order, customer, atau unit kedua. Karyawan penjual ditautkan lewat PKR.sellerId (ID akun stabil), bukan email.
//   3. Unit lahir lewat jalur BAKU createOrderForCustomer → createUnitsForOrder (unitProvisioning.js); job pickup/delivery lewat ensurePickup/DeliveryJob yang SUDAH idempoten.
//      Tidak ada jalur Produksi/Delivery baru.
//   4. Spesifikasi produksi (merk, ukuran, dikirim/diambil, alamat bila dikirim) dihitung dinamis (lib/domain/pkrSpesifikasi.js). Belum lengkap = "Perlu dilengkapi" dan
//      startStageInTx menolak memulai tahap. Delivery job otomatis HANYA bila order ditandai perlu dikirim (suggestDeliveryJob).
//   5. Pembatalan PKR setelah Produksi/Delivery berjalan DIBLOKIR; sebelum itu order, unit, dan job (yang belum berjalan) dibatalkan lewat jalur baku — tidak ada yang dihapus.
import { prisma } from "../db.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { createOrderForCustomer } from "./orderCreation.js";
import { cancelOrderDeliveryJobs } from "./deliveryJobCancellationService.js";
import { assertOrderUnitsNotV2Owned } from "./productionRunGuards.js";
import { kunciKanonis } from "./finance/urutanKunci.js";
import { ensureDeliveryJobForOrder } from "./armadaAutoJob.js";
import { syncCustomerOrderAggregate } from "./customerOrderAggregate.js";
import { siapkanNotesUkuran, sinkronUkuranUnit } from "../lib/ukuranKasur.js";
import { ukuranCustomWajibSejak } from "./ukuranWajib.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaSpesifikasiPkr, bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "./finance/money.js";

import { PkrOrderError, tolakJikaOrderPkr } from "./pkrGuard.js";
export { PkrOrderError, tolakJikaOrderPkr };
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);

export const KATEGORI_PKR = ["BARU", "LAYANAN"];
const STATUS_UNIT_AWAL = ["AWAITING_PICKUP", "RECEIVED"];
const STATUS_JOB_BERJALAN = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "COMPLETED", "FAILED"];
const TAG_PKR = "Penjualan Karyawan";

const teks = (v, maks, nama) => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t === "" ? null : t;
};

/** Normalisasi masukan spesifikasi (semua opsional). `undefined` = tidak diubah/tidak diisi. */
export function normalisasiSpesifikasi(m = {}) {
  const o = m ?? {};
  const kategori = o.kategori === undefined || o.kategori === null || o.kategori === "" ? undefined : String(o.kategori);
  if (kategori !== undefined && !KATEGORI_PKR.includes(kategori)) throw gagal("Jenis pekerjaan harus Kasur Baru atau Service/Upgrade");
  let jumlahUnit;
  if (o.jumlahUnit !== undefined && o.jumlahUnit !== null && o.jumlahUnit !== "") {
    jumlahUnit = Number(o.jumlahUnit);
    if (!Number.isInteger(jumlahUnit) || jumlahUnit < 1 || jumlahUnit > 20) throw gagal("Jumlah unit harus bilangan bulat 1–20");
  }
  let perluDikirim;
  if (o.perluDikirim !== undefined && o.perluDikirim !== null && o.perluDikirim !== "") {
    if (typeof o.perluDikirim !== "boolean") throw gagal("Pilihan dikirim atau diambil sendiri tidak valid");
    perluDikirim = o.perluDikirim;
  }
  const tanggalKirim = teks(o.tanggalKirim, 10, "Tanggal kirim");
  if (tanggalKirim && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalKirim)) throw gagal("Tanggal kirim harus berformat YYYY-MM-DD");
  return {
    kategori, jumlahUnit, perluDikirim,
    merk: teks(o.merk, 100, "Merk kasur"), ukuran: teks(o.ukuran, 100, "Ukuran"),
    alamat: teks(o.alamat, 500, "Alamat pengiriman"), kota: teks(o.kota, 100, "Kota"), tanggalKirim,
  };
}

const susunNotes = ({ merk, ukuran, pkr, catatan }) => JSON.stringify({
  ...(merk && { merkKasur: merk }), ...(ukuran && { ukuranKasur: ukuran }),
  pkrNomor: pkr.nomor, catatan: `Penjualan Karyawan ${pkr.nomor} — penjual ${pkr.seller.name}${catatan ? `. ${catatan}` : ""}`,
});

async function muatPkr(tx, penjualanId) {
  await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await tx.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId },
    include: { seller: { select: { id: true, name: true } }, orderCrm: { select: { id: true, orderNumber: true } } },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  return pkr;
}

// ── BUAT / TAUTKAN ───────────────────────────────────────────────────────────────────────────────────

/**
 * Buat SATU order CRM untuk PKR (atau tautkan order kosong yang sudah ada). Dipanggil di DALAM transaksi pemanggil. Idempoten: bila PKR sudah punya order, mengembalikannya (`dibuat:false`).
 * `orderId` (opsional) menautkan order yang SUDAH ada — hanya bila benar-benar kosong secara keuangan (tanpa nilai, item, pembayaran, invoice, atau tautan lain).
 */
export async function buatAtauTautkanOrder(tx, { penjualanId, userId = null, spesifikasi = {}, orderId = null, sumber = "dibuat" }) {
  const pkr = await muatPkr(tx, penjualanId);
  if (pkr.orderCrm) return { orderId: pkr.orderCrm.id, orderNumber: pkr.orderCrm.orderNumber, dibuat: false, nomor: pkr.nomor };
  if (pkr.status !== "AKTIF") throw gagal(`${pkr.nomor} sudah dibatalkan — order CRM tidak dibuat`, 409);
  const spek = normalisasiSpesifikasi(spesifikasi);

  if (orderId) {
    await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId);
    const o = await tx.order.findUnique({
      where: { id: orderId },
      include: { _count: { select: { items: true, payments: true } }, invoice: { select: { id: true } } },
    });
    if (!o) throw gagal("Order yang akan ditautkan tidak ditemukan", 404);
    if (o.penjualanKaryawanId) throw gagal("Order itu sudah tertaut ke penjualan karyawan lain", 409);
    if (o.status === "CANCELLED") throw gagal("Order itu sudah dibatalkan", 409);
    if (o.value !== 0 || o._count.items > 0 || o._count.payments > 0 || o.invoice || o.salesOwnerId || o.staffSellerId || o.ongkir) {
      throw gagal("Order itu sudah punya nilai, item, pembayaran, invoice, atau Sales. Menautkannya akan menghitung uang dua kali — hanya order kosong yang boleh ditautkan.", 409, "ORDER_SUDAH_BERNILAI");
    }
    const diperbarui = await tx.order.update({ where: { id: o.id }, data: { penjualanKaryawanId: pkr.id, pkrPerluDikirim: spek.perluDikirim ?? null } });
    await catatAudit(tx, { pkr, orderId: diperbarui.id, userId, aksi: "ditautkan", metadata: { orderNumber: diperbarui.orderNumber } });
    return { orderId: diperbarui.id, orderNumber: diperbarui.orderNumber, dibuat: false, ditautkan: true, nomor: pkr.nomor };
  }

  const kategori = spek.kategori ?? "BARU";
  const jumlahUnit = spek.jumlahUnit ?? 1;
  // Pembeli = pelanggan operasional PER PKR (nama dari PKR). Tanpa nomor/IG supaya tidak menabrak unique, tanpa sales, ditandai tag. Tidak ada percakapan/pipeline sales.
  const customer = await tx.customer.create({
    data: {
      name: pkr.buyerName, tags: [TAG_PKR], leadSource: "OTHER", leadSourceDetail: `Penjualan Karyawan ${pkr.nomor}`, leadSourceConfirmed: true,
      pipelineStage: "TRANSACTION", assignedSalesId: null, ...(spek.kota && { city: spek.kota }),
    },
  });
  const order = await createOrderForCustomer(customer.id, {
    category: kategori, unitCount: jumlahUnit, quantity: jumlahUnit,
    notes: susunNotes({ merk: spek.merk, ukuran: spek.ukuran, pkr, catatan: pkr.notes }),
    ...(spek.alamat && { deliveryAddress: spek.alamat }), ...(spek.kota && { deliveryCity: spek.kota }),
    ...(spek.tanggalKirim && { deliveryConfirmedDate: spek.tanggalKirim }),
  }, userId, {
    tx, tanpaInvoice: true,
    dataTambahan: { salesOwnerId: null, penjualanKaryawanId: pkr.id, pkrPerluDikirim: spek.perluDikirim ?? null },
  });
  await catatAudit(tx, {
    pkr, orderId: order.id, userId, aksi: sumber,
    metadata: { orderNumber: order.orderNumber, kategori, jumlahUnit, unit: (order.units || []).map((u) => u.unitCode), spesifikasi: bacaSpesifikasiPkr(order).lengkap ? "lengkap" : "perlu dilengkapi" },
  });
  return { orderId: order.id, orderNumber: order.orderNumber, dibuat: true, nomor: pkr.nomor, customerId: customer.id };
}

async function catatAudit(tx, { pkr, orderId, userId, aksi, metadata = {} }) {
  const meta = { aksi, nomorPkr: pkr.nomor, penjualanId: pkr.id, orderId, ...metadata };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pkr.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
}

// ── LENGKAPI SPESIFIKASI / ALAMAT / JADWAL ────────────────────────────────────────────────────────────

const alamatGabung = (o) => [o?.deliveryAddress, o?.deliveryCity].filter(Boolean).join(", ") || null;

/**
 * Lengkapi atau ubah spesifikasi + logistik order PKR. Merk/ukuran hanya boleh berubah selama belum ada unit yang mulai dikerjakan Produksi. Alamat disinkronkan ke job yang masih
 * bisa diubah (alamat job yang sama dengan alamat order lama atau kosong; ubahan manual dispatcher tidak ditimpa). Setiap perubahan diaudit (sebelum/sesudah).
 */
export async function lengkapiSpesifikasi(tx, { penjualanId, userId = null, masukan = {} }) {
  const pkr = await muatPkr(tx, penjualanId);
  if (!pkr.orderCrm) throw gagal(`${pkr.nomor} belum punya order CRM — buat dulu`, 409, "BELUM_ADA_ORDER");
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', pkr.orderCrm.id);
  const order = await tx.order.findUnique({ where: { id: pkr.orderCrm.id }, include: { units: { select: { id: true, status: true, currentStageId: true, unitCode: true } } } });
  if (order.status === "CANCELLED" || pkr.status !== "AKTIF") throw gagal("Order ini sudah dibatalkan — tidak bisa diubah", 409);
  const spek = normalisasiSpesifikasi(masukan);
  const sebelumSpek = bacaSpesifikasiPkr(order);
  const unitMulai = order.units.filter((u) => u.currentStageId != null && u.status !== "CANCELLED");
  const data = {}; const perubahan = {};
  const catat = (k, dari, ke) => { perubahan[k] = { sebelum: dari ?? null, sesudah: ke ?? null }; };

  let notesBaru = order.notes;
  const info = bacaNotesOrder(order.notes);
  const info2 = { ...info };
  if (spek.merk !== undefined && spek.merk !== sebelumSpek.merk) {
    if (unitMulai.length) throw gagal("Merk tidak bisa diubah: Produksi sudah mulai mengerjakan unit", 409);
    if (spek.merk) info2.merkKasur = spek.merk; else delete info2.merkKasur;
    catat("merk", sebelumSpek.merk, spek.merk);
  }
  if (spek.ukuran !== undefined && spek.ukuran !== sebelumSpek.ukuran) {
    if (unitMulai.length) throw gagal("Ukuran tidak bisa diubah: Produksi sudah mulai mengerjakan unit", 409);
    if (spek.ukuran) info2.ukuranKasur = spek.ukuran; else delete info2.ukuranKasur;
    catat("ukuran", sebelumSpek.ukuran, spek.ukuran);
  }
  if (perubahan.merk || perubahan.ukuran) {
    notesBaru = siapkanNotesUkuran(JSON.stringify(info2), { wajib: Boolean(await ukuranCustomWajibSejak(tx)), notesLama: order.notes });
    data.notes = notesBaru;
  }

  if (spek.perluDikirim !== undefined && spek.perluDikirim !== order.pkrPerluDikirim) {
    if (spek.perluDikirim === false) {
      const jobKirim = await tx.job.count({ where: { orderId: order.id, type: "DELIVERY" } });
      if (jobKirim > 0) throw gagal("Job pengiriman sudah ada. Batalkan atau ubah lewat Delivery dulu sebelum menandai order ini diambil sendiri.", 409);
    }
    data.pkrPerluDikirim = spek.perluDikirim;
    catat("perluDikirim", order.pkrPerluDikirim, spek.perluDikirim);
  }
  const alamatLama = alamatGabung(order);
  if (spek.alamat !== undefined && spek.alamat !== (order.deliveryAddress ?? null)) { data.deliveryAddress = spek.alamat; catat("alamat", order.deliveryAddress, spek.alamat); }
  if (spek.kota !== undefined && spek.kota !== (order.deliveryCity ?? null)) { data.deliveryCity = spek.kota; catat("kota", order.deliveryCity, spek.kota); }
  if (spek.tanggalKirim !== undefined) {
    const baru = spek.tanggalKirim ? new Date(`${spek.tanggalKirim}T00:00:00.000Z`) : null;
    const lama = order.deliveryConfirmedDate ? order.deliveryConfirmedDate.toISOString().slice(0, 10) : null;
    if ((spek.tanggalKirim ?? null) !== lama) { data.deliveryConfirmedDate = baru; catat("tanggalKirim", lama, spek.tanggalKirim); }
  }
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  const diperbarui = await tx.order.update({ where: { id: order.id }, data });
  if (data.notes !== undefined) {
    await sinkronUkuranUnit(tx, order.id, order.notes, data.notes);
    if (perubahan.merk) await tx.unit.updateMany({ where: { orderId: order.id, status: { not: "CANCELLED" }, OR: [{ merk: null }, { merk: perubahan.merk.sebelum ?? "" }] }, data: { merk: perubahan.merk.sesudah } });
  }
  // Sinkron alamat ke job yang belum selesai: hanya yang alamatnya kosong atau masih sama dengan alamat order lama (ubahan manual dispatcher tidak ditimpa). Cache koordinat dikosongkan.
  let jobDisinkron = 0;
  if (perubahan.alamat || perubahan.kota) {
    const baruTeks = alamatGabung(diperbarui);
    const jobs = await tx.job.findMany({ where: { orderId: order.id, status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "RESCHEDULED"] } }, select: { id: true, addressText: true } });
    for (const j of jobs) {
      if (!j.addressText || j.addressText === alamatLama) { await tx.job.update({ where: { id: j.id }, data: { addressText: baruTeks, lat: null, lng: null } }); jobDisinkron += 1; }
    }
  }
  // Order ditandai perlu dikirim padahal unit sudah siap kirim: buat kerangka job lewat jalur baku (idempoten).
  if (perubahan.perluDikirim?.sesudah === true) await ensureDeliveryJobForOrder(tx, diperbarui);
  await catatAudit(tx, { pkr, orderId: order.id, userId, aksi: "dilengkapi", metadata: { perubahan, jobDisinkron, lengkapSesudah: bacaSpesifikasiPkr(diperbarui).lengkap } });
  return { orderId: order.id, perubahan, jobDisinkron, spesifikasi: bacaSpesifikasiPkr(diperbarui) };
}

// ── PEMBATALAN ───────────────────────────────────────────────────────────────────────────────────────

/** Hambatan pembatalan: Produksi atau Delivery sudah berjalan. Daftar kosong = aman dibatalkan lewat jalur baku. */
export async function hambatanPembatalan(tx, orderId) {
  const [units, jobs, revisi, order] = await Promise.all([
    tx.unit.findMany({ where: { orderId, status: { not: "CANCELLED" } }, select: { unitCode: true, status: true, currentStageId: true } }),
    tx.job.findMany({ where: { orderId, status: { in: STATUS_JOB_BERJALAN } }, select: { type: true, status: true } }),
    tx.scopeRevision.count({ where: { orderId } }),
    tx.order.findUnique({ where: { id: orderId }, select: { status: true } }),
  ]);
  const h = [];
  const mulai = units.filter((u) => u.currentStageId != null || !STATUS_UNIT_AWAL.includes(u.status));
  if (mulai.length) h.push(`Produksi atau pengiriman sudah berjalan pada unit ${mulai.map((u) => u.unitCode).join(", ")}`);
  if (jobs.length) h.push(`${jobs.length} job Delivery sudah berjalan (${[...new Set(jobs.map((j) => j.status))].join(", ")})`);
  if (revisi > 0) h.push(`${revisi} revisi lingkup kerja`);
  if (order?.status === "DELIVERED") h.push("order sudah selesai");
  return h;
}

/**
 * Dipanggil dari pembatalan PKR (di dalam transaksi pemanggil, setelah PKR dikunci). Order yang belum diproses dibatalkan lewat jalur baku (unit CANCELLED, job dibatalkan dengan
 * tombstone, riwayat status); yang sudah berjalan MEMBLOKIR pembatalan PKR. Tidak ada yang dihapus.
 */
export async function batalkanOrderBersamaPkr(tx, { penjualanId, userId = null, alasan }) {
  const order = await tx.order.findUnique({ where: { penjualanKaryawanId: penjualanId } });
  if (!order || order.status === "CANCELLED") return { dibatalkan: false };
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id);
  const hambatan = await hambatanPembatalan(tx, order.id);
  if (hambatan.length) {
    throw gagal(`Penjualan karyawan tidak bisa dibatalkan: ${hambatan.join("; ")}. Gunakan alur pembatalan resmi order (Kendali/Admin) — order, unit, job, dan jurnal tidak dihapus.`, 409, "PRODUKSI_DELIVERY_BERJALAN", { hambatan });
  }
  await kunciKanonis(tx, { orderIds: [order.id] });
  await assertOrderUnitsNotV2Owned(tx, order.id, "Membatalkan penjualan karyawan");
  await tx.unit.updateMany({ where: { orderId: order.id, status: { not: "CANCELLED" } }, data: { status: "CANCELLED" } });
  await cancelOrderDeliveryJobs(tx, { orderId: order.id, actorId: userId, reason: `Penjualan karyawan dibatalkan — ${alasan}` });
  const hasil = await tx.order.update({
    where: { id: order.id },
    data: { status: "CANCELLED", statusLocked: true, statusOverrideById: userId, statusOverrideAt: new Date(), statusOverrideNote: `Penjualan karyawan dibatalkan — ${alasan}` },
  });
  await tx.orderStatusTransition.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "CANCELLED", changedById: userId } });
  const pkr = await tx.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { id: true, nomor: true } });
  await catatAudit(tx, { pkr, orderId: order.id, userId, aksi: "dibatalkan", metadata: { alasan, orderNumber: order.orderNumber } });
  return { dibatalkan: true, orderId: hasil.id, customerId: hasil.customerId };
}

/** Setelah transaksi pembatalan commit: rapikan agregat customer (di luar transaksi, sama dengan pembatalan order baku). */
export async function rapikanAgregatCustomer(customerId) { if (customerId) await syncCustomerOrderAggregate(customerId); }

// ── BACA ─────────────────────────────────────────────────────────────────────────────────────────────

const LABEL_ORDER = { PENDING: "Menunggu", PICKUP: "Pengambilan", PROCESSING: "Diproses", READY: "Siap kirim", DELIVERED: "Selesai", CANCELLED: "Dibatalkan" };
const LABEL_UNIT = {
  AWAITING_PICKUP: "Menunggu pengambilan", IN_TRANSIT_IN: "Dalam perjalanan ke workshop", RECEIVED: "Menunggu produksi", IN_PRODUCTION: "Sedang diproduksi",
  READY_FOR_DELIVERY: "Produksi selesai", READY_ON_CUSTOMER_HOLD: "Produksi selesai (ditahan)", IN_TRANSIT_OUT: "Dalam pengiriman", DELIVERED: "Selesai", CANCELLED: "Dibatalkan",
};
const LABEL_JOB = {
  UNSCHEDULED: "Job dibuat, belum dijadwalkan", SCHEDULED: "Terjadwal", ASSIGNED: "Terjadwal (driver ditetapkan)", EN_ROUTE: "Dalam perjalanan", ARRIVED: "Tiba di lokasi",
  COMPLETED: "Terkirim", FAILED: "Gagal — perlu dijadwalkan ulang", RESCHEDULED: "Dijadwalkan ulang",
};
const LABEL_PEMBAYARAN = { DIBATALKAN: "Dibatalkan", LUNAS: "Lunas", SEBAGIAN: "Dibayar sebagian", BELUM_BAYAR: "Belum dibayar" };

function statusProduksi(order, units, spek) {
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  if (order.status === "CANCELLED" || (units.length > 0 && aktif.length === 0)) return { kode: "DIBATALKAN", label: "Dibatalkan" };
  if (!spek.lengkap && aktif.every((u) => u.currentStageId == null)) return { kode: "PERLU_DILENGKAPI", label: "Perlu dilengkapi" };
  if (aktif.length === 0) return { kode: "BELUM_ADA_UNIT", label: "Belum ada unit" };
  if (aktif.every((u) => ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(u.status))) return { kode: "SELESAI", label: "Produksi selesai" };
  if (aktif.some((u) => u.currentStageId != null || u.status === "IN_PRODUCTION")) return { kode: "BERJALAN", label: "Sedang diproduksi" };
  return { kode: "MENUNGGU", label: "Menunggu produksi" };
}
function statusDelivery(order, jobs, units) {
  if (order.status === "CANCELLED") return { kode: "DIBATALKAN", label: "Dibatalkan" };
  if (order.pkrPerluDikirim === false) return { kode: "AMBIL_SENDIRI", label: "Diambil sendiri (tanpa pengiriman)" };
  if (order.pkrPerluDikirim == null) return { kode: "BELUM_DITENTUKAN", label: "Belum ditentukan (dikirim atau diambil sendiri)" };
  const kirim = jobs.filter((j) => j.type === "DELIVERY");
  if (kirim.length === 0) return { kode: "BELUM_ADA_JOB", label: units.some((u) => u.status === "READY_FOR_DELIVERY") ? "Siap kirim — job belum terbentuk" : "Menunggu produksi selesai" };
  const j = kirim[kirim.length - 1];
  return { kode: j.status, label: LABEL_JOB[j.status] || j.status, jobId: j.id };
}

/**
 * Ringkasan sinkronisasi per PKR untuk layar Finance/CRM: order, spesifikasi, unit, produksi, delivery, dan status pembayaran DARI LEDGER PKR (bukan dari Order).
 * `izinNominal=false` membuang total/terbayar/sisa (tampilan Sales/Produksi/Delivery).
 */
export async function ringkasOrderPkr(db, penjualanIds, { izinNominal = true } = {}) {
  if (!penjualanIds.length) return new Map();
  const pkrs = await db.finPenjualanKaryawan.findMany({
    where: { id: { in: penjualanIds } },
    include: {
      seller: { select: { id: true, name: true } },
      payments: { where: { cancelledAt: null }, select: { amount: true } },
      orderCrm: { include: { units: { orderBy: { seq: "asc" }, select: { id: true, unitCode: true, status: true, currentStageId: true, merk: true, ukuran: true } }, jobs: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, status: true } } } },
    },
  });
  const hasil = new Map();
  for (const p of pkrs) {
    const total = toMoney(p.total);
    const terbayar = p.payments.length ? sumMoney(p.payments.map((x) => x.amount)) : ZERO;
    const batal = p.status === "DIBATALKAN";
    const sisa = batal ? ZERO : total.minus(terbayar);
    const statusBayar = batal ? "DIBATALKAN" : sisa.lessThanOrEqualTo(0) ? "LUNAS" : terbayar.greaterThan(0) ? "SEBAGIAN" : "BELUM_BAYAR";
    const pembayaran = { status: statusBayar, label: LABEL_PEMBAYARAN[statusBayar], sumber: "Penjualan Karyawan (Finance)", ...(izinNominal && { total: moneyToNumber(total), terbayar: moneyToNumber(batal ? ZERO : terbayar), sisa: moneyToNumber(sisa) }) };
    const o = p.orderCrm;
    if (!o) { hasil.set(p.id, { penjualanId: p.id, nomor: p.nomor, statusPkr: p.status, penjual: p.seller, pembeli: p.buyerName, pembayaran, order: null }); continue; }
    const spek = bacaSpesifikasiPkr(o);
    hasil.set(p.id, {
      penjualanId: p.id, nomor: p.nomor, statusPkr: p.status, penjual: p.seller, pembeli: p.buyerName, pembayaran,
      order: { id: o.id, nomor: o.orderNumber, status: o.status, statusLabel: LABEL_ORDER[o.status] || o.status, kategori: o.category, spesifikasi: spek },
      units: o.units.map((u) => ({ id: u.id, kode: u.unitCode, status: u.status, label: LABEL_UNIT[u.status] || u.status, merk: u.merk, ukuran: u.ukuran })),
      produksi: statusProduksi(o, o.units, spek),
      delivery: statusDelivery(o, o.jobs, o.units),
      jobs: o.jobs.map((j) => ({ id: j.id, tipe: j.type, status: j.status, label: LABEL_JOB[j.status] || j.status })),
    });
  }
  return hasil;
}

/** Dry-run PKR lama: dokumen AKTIF yang belum punya order CRM (tidak menulis apa pun). */
export async function dryRunPkrTanpaOrder(db, { batas = 200 } = {}) {
  const rows = await db.finPenjualanKaryawan.findMany({
    where: { status: "AKTIF", orderCrm: null }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: batas,
    select: { id: true, nomor: true, date: true, buyerName: true, total: true, seller: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ penjualanId: r.id, nomor: r.nomor, tanggal: r.date.toISOString().slice(0, 10), pembeli: r.buyerName, penjual: r.seller, total: moneyToNumber(toMoney(r.total)), aksi: "BUAT_ORDER_CRM" }));
}

/** Rujukan PKR ringan untuk model baca Produksi/Delivery/CRM: { nomor, penjualanId } per orderId (hanya order PKR). */
export async function rujukanPkrPerOrder(db, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.order.findMany({ where: { id: { in: ids }, penjualanKaryawanId: { not: null } }, select: { id: true, pkrPerluDikirim: true, penjualanKaryawan: { select: { id: true, nomor: true, buyerName: true, seller: { select: { name: true } } } } } });
  return new Map(rows.map((r) => [r.id, { penjualanId: r.penjualanKaryawan.id, nomor: r.penjualanKaryawan.nomor, penjual: r.penjualanKaryawan.seller.name, perluDikirim: r.pkrPerluDikirim }]));
}
