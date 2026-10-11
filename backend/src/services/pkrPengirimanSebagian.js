// PENGIRIMAN ORDER PKR — satu job gabungan, dan pengiriman sebagian HANYA lewat aksi eksplisit.
//
// Keputusan Owner:
//   • Delivery MENUNGGU seluruh unit yang DIKIRIM siap (READY_FOR_DELIVERY), lalu membuat SATU job berisi semuanya. Item yang diambil sendiri tidak ikut.
//   • TIDAK ADA job kedua otomatis: begitu order punya job pengiriman (selain yang dibatalkan), jalur otomatis tidak menambah atau membuat job lagi.
//   • Pengiriman sebagian hanya lewat kirimSebagian(): unit dipilih, alasan wajib, audit, pengaman duplikasi (kunci baris order + kunci idempotensi unik per order +
//     penolakan unit yang sudah berada di job pengiriman).
//
// File ini TIDAK menjadwalkan apa pun (tanggal/driver tetap keputusan dispatcher): hanya membuat kerangka job UNSCHEDULED lewat jalur lintas-batas yang sama dengan job otomatis.
import { executeDeliveryCrossBoundaryCommand } from "./deliveryCrossBoundaryCommandService.js";
import { PkrOrderError } from "./pkrGuard.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;

const alamatDariOrder = (o) => [o?.deliveryAddress, o?.deliveryCity].filter(Boolean).join(", ") || null;
/** Job pengiriman yang masih "hidup": bukan yang dibatalkan (FAILED + tombstone pembatalan). */
const JOB_KIRIM_HIDUP = { type: "DELIVERY", OR: [{ status: { not: "FAILED" } }, { cancellationV2: { is: null } }] };

/**
 * Unit order PKR yang HARUS dikirim (aktif), dengan kesiapan & keanggotaan job. Order multi-item: unit milik item perluDikirim=true. Order lama (tanpa item): semua unit bila
 * order ditandai perlu dikirim.
 */
export async function unitYangDikirim(db, orderId) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, status: true, penjualanKaryawanId: true, pkrPerluDikirim: true, deliveryAddress: true, deliveryCity: true,
      penjualanKaryawan: { select: { nomor: true } },
      pkrItems: {
        where: { removedAt: null }, orderBy: { seq: "asc" },
        select: { seq: true, perluDikirim: true, productName: true, categoryName: true, units: { select: { unitId: true } } },
      },
      units: {
        orderBy: { seq: "asc" },
        select: { id: true, unitCode: true, status: true, jobUnits: { select: { job: { select: { id: true, type: true, status: true, cancellationV2: { select: { id: true } } } } } } },
      },
    },
  });
  if (!order || !order.penjualanKaryawanId) return { order: null, unit: [] };
  const modeItem = order.pkrItems.length > 0;
  const dikirimItem = new Map(); // unitId -> item
  if (modeItem) for (const it of order.pkrItems) for (const x of it.units) dikirimItem.set(x.unitId, it);
  const unit = [];
  for (const u of order.units) {
    if (u.status === "CANCELLED") continue;
    const item = dikirimItem.get(u.id) ?? null;
    const dikirim = modeItem ? item?.perluDikirim === true : order.pkrPerluDikirim === true;
    if (!dikirim) continue;
    const job = u.jobUnits.map((j) => j.job).find((j) => j.type === "DELIVERY" && !(j.status === "FAILED" && j.cancellationV2));
    unit.push({
      id: u.id, unitCode: u.unitCode, status: u.status, siap: u.status === "READY_FOR_DELIVERY",
      itemNo: item?.seq ?? null, itemNama: item ? (item.productName || item.categoryName) : null, jobId: job?.id ?? null, jobStatus: job?.status ?? null,
    });
  }
  return { order, unit };
}

/**
 * Gerbang JOB OTOMATIS untuk order PKR: boleh membuat SATU job gabungan bila (a) ada unit yang dikirim, (b) SEMUA unit yang dikirim sudah READY_FOR_DELIVERY,
 * (c) order belum punya job pengiriman hidup. Selain itu otomatis TIDAK melakukan apa pun (menunggu, atau perlu aksi eksplisit).
 */
export async function gerbangJobOtomatis(tx, orderId) {
  const { unit } = await unitYangDikirim(tx, orderId);
  if (unit.length === 0) return { boleh: false, alasan: "TIDAK_ADA_UNIT_DIKIRIM", unitIds: [] };
  if (unit.some((u) => u.jobId)) return { boleh: false, alasan: "SUDAH_ADA_JOB", unitIds: [] };
  const jobHidup = await tx.job.count({ where: { orderId, ...JOB_KIRIM_HIDUP } });
  if (jobHidup > 0) return { boleh: false, alasan: "SUDAH_ADA_JOB", unitIds: [] };
  if (!unit.every((u) => u.siap)) return { boleh: false, alasan: "MENUNGGU_UNIT", unitIds: [], menunggu: unit.filter((u) => !u.siap).map((u) => u.unitCode) };
  return { boleh: true, alasan: null, unitIds: unit.map((u) => u.id) };
}

/** Buat SATU job pengiriman (UNSCHEDULED) berisi `unitIds` lewat jalur lintas-batas baku. Mengembalikan id job. */
export async function buatJobKirimGabungan(tx, { orderId, unitIds, alamat, commandType = "PRODUCTION_DELIVERY_HANDOFF_CREATE" }) {
  const urut = [...unitIds].sort();
  return executeDeliveryCrossBoundaryCommand(tx, {
    commandType, aggregateHint: orderId, request: { orderId, unitIds: urut },
    mutate: async (commandTx) => {
      const job = await commandTx.job.create({
        data: { type: "DELIVERY", orderId, status: "UNSCHEDULED", addressText: alamat, units: { create: urut.map((unitId) => ({ unitId })) } },
        select: { id: true },
      });
      return { value: job.id, jobIds: [job.id] };
    },
  });
}

/** Keadaan pengiriman order PKR untuk layar Delivery. */
export async function bacaPengirimanOrder(db, orderId) {
  const { order, unit } = await unitYangDikirim(db, orderId);
  if (!order) throw gagal("Order Penjualan Karyawan tidak ditemukan", 404, "BUKAN_ORDER_PKR");
  const diambil = order.pkrItems.filter((i) => i.perluDikirim !== true).map((i) => ({ itemNo: i.seq, nama: i.productName || i.categoryName, perluDikirim: i.perluDikirim }));
  const sudahDalamJob = unit.filter((u) => u.jobId);
  const bisaDipilih = unit.filter((u) => u.siap && !u.jobId);
  const menunggu = unit.filter((u) => !u.siap && !u.jobId);
  const jobs = await db.job.findMany({ where: { orderId, ...JOB_KIRIM_HIDUP }, select: { id: true, status: true, createdAt: true, units: { select: { unitId: true } } }, orderBy: { createdAt: "asc" } });
  const riwayat = await db.pkrPengirimanSebagian.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take: 10 });
  const dibatalkan = order.status === "CANCELLED";
  return {
    orderId: order.id, nomorOrder: order.orderNumber, nomorPkr: order.penjualanKaryawan?.nomor ?? null, statusOrder: order.status,
    unit, diambilSendiri: diambil, jobHidup: jobs.map((j) => ({ id: j.id, status: j.status, jumlahUnit: j.units.length })),
    ringkas: { dikirim: unit.length, siap: unit.filter((u) => u.siap).length, menunggu: menunggu.length, sudahDalamJob: sudahDalamJob.length },
    // Aksi eksplisit tersedia bila ada unit siap yang belum di job DAN masih ada yang menunggu (kalau tak ada yang menunggu, job gabungan terbentuk otomatis).
    bisaKirimSebagian: !dibatalkan && bisaDipilih.length > 0,
    sebagian: bisaDipilih.length > 0 && menunggu.length > 0,
    petunjuk: dibatalkan ? "Order dibatalkan."
      : menunggu.length > 0 ? `Menunggu ${menunggu.length} unit lain siap (${menunggu.map((u) => u.unitCode).join(", ")}). Job pengiriman dibuat otomatis begitu semua siap; bila perlu berangkat dulu, pakai Kirim sebagian.`
      : sudahDalamJob.length > 0 ? "Seluruh unit yang dikirim sudah punya job pengiriman." : "Semua unit siap — job gabungan dibuat otomatis.",
    riwayatSebagian: riwayat.map((r) => ({ id: r.id, jobId: r.jobId, unit: r.unitCodes, ditunda: r.unitDitunda, alasan: r.reason, waktu: r.createdAt })),
  };
}

/** Daftar order PKR yang punya unit siap tetapi menunggu unit lain (belum ada job): untuk layar Delivery. */
export async function daftarMenunggu(db) {
  const orders = await db.order.findMany({
    where: {
      penjualanKaryawanId: { not: null }, status: { notIn: ["CANCELLED", "DELIVERED"] },
      units: { some: { status: "READY_FOR_DELIVERY" } },
      jobs: { none: JOB_KIRIM_HIDUP },
    },
    select: { id: true }, take: 200, orderBy: { createdAt: "desc" },
  });
  const hasil = [];
  for (const o of orders) {
    const d = await bacaPengirimanOrder(db, o.id);
    if (d.sebagian) hasil.push({ orderId: d.orderId, nomorOrder: d.nomorOrder, nomorPkr: d.nomorPkr, ringkas: d.ringkas, petunjuk: d.petunjuk });
  }
  return hasil;
}

/**
 * Aksi EKSPLISIT "Kirim sebagian": buat satu job berisi unit yang dipilih (semuanya READY_FOR_DELIVERY, belum di job pengiriman, memang unit yang dikirim). Di dalam transaksi
 * pemanggil. Idempoten per (order, kunci): permintaan ulang dengan isi sama mengembalikan hasil lama; isi berbeda = 409.
 */
export async function kirimSebagian(tx, { orderId, unitIds, alasan, idempotencyKey, userId = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk pengiriman sebagian", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teks = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teks.length < 5) throw gagal("Alasan pengiriman sebagian wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teks.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (!Array.isArray(unitIds) || unitIds.length === 0) throw gagal("Pilih minimal satu unit yang akan dikirim", 400, "UNIT_WAJIB");
  if (unitIds.length > 50 || unitIds.some((u) => !UUID.test(String(u)))) throw gagal("Daftar unit tidak valid", 400, "UNIT_TIDAK_VALID");
  const pilih = [...new Set(unitIds.map(String))].sort();
  if (typeof orderId !== "string" || orderId.length < 8 || orderId.length > 64) throw gagal("Order tidak ditemukan", 404); // Order.id = teks (cuid), bukan UUID

  // Kunci order lalu unit terpilih (urut id): dua permintaan paralel diserialkan, yang kedua melihat job yang sudah ada dan ditolak.
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId);
  const ada = await tx.pkrPengirimanSebagian.findUnique({ where: { orderId_idempotencyKey: { orderId, idempotencyKey: String(idempotencyKey) } } });
  if (ada) {
    const sama = JSON.stringify([...ada.unitIds].sort()) === JSON.stringify(pilih) && ada.reason === teks;
    if (!sama) throw gagal("Idempotency-Key ini sudah dipakai untuk pengiriman sebagian lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { replayed: true, jobId: ada.jobId, unit: ada.unitCodes, ditunda: ada.unitDitunda };
  }
  await tx.$queryRawUnsafe('SELECT id FROM units WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', pilih);

  const { order, unit } = await unitYangDikirim(tx, orderId);
  if (!order) throw gagal("Order ini bukan order Penjualan Karyawan", 409, "BUKAN_ORDER_PKR");
  if (order.status === "CANCELLED") throw gagal("Order sudah dibatalkan", 409, "ORDER_DIBATALKAN");
  const peta = new Map(unit.map((u) => [u.id, u]));
  for (const id of pilih) {
    const u = peta.get(id);
    if (!u) throw gagal("Ada unit yang bukan unit yang dikirim pada order ini (atau item-nya diambil sendiri)", 409, "UNIT_BUKAN_DIKIRIM");
    if (u.jobId) throw gagal(`Unit ${u.unitCode} sudah berada di job pengiriman. Tidak dibuat job ganda.`, 409, "UNIT_SUDAH_DI_JOB");
    if (!u.siap) throw gagal(`Unit ${u.unitCode} belum siap kirim (${u.status}).`, 409, "UNIT_BELUM_SIAP");
  }
  const ditunda = unit.filter((u) => !pilih.includes(u.id) && !u.jobId).map((u) => u.unitCode);
  const jobId = await buatJobKirimGabungan(tx, { orderId, unitIds: pilih, alamat: alamatDariOrder(order), commandType: "PKR_PARTIAL_DELIVERY_CREATE" });
  const kode = pilih.map((id) => peta.get(id).unitCode);
  await tx.pkrPengirimanSebagian.create({
    data: {
      orderId, penjualanId: order.penjualanKaryawanId, jobId, unitIds: pilih, unitCodes: kode, unitDitunda: ditunda, reason: teks, actorId: userId, idempotencyKey: String(idempotencyKey),
    },
  });
  const meta = { aksi: "pengiriman_sebagian", nomorPkr: order.penjualanKaryawan?.nomor ?? null, penjualanId: order.penjualanKaryawanId, orderId, jobId, unit: kode, ditunda, alasan: teks };
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: order.penjualanKaryawanId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  return { replayed: false, jobId, unit: kode, ditunda };
}
