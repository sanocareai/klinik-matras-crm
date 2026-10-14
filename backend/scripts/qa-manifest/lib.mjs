// QA MANIFEST HP — pustaka seed. HANYA untuk database lokal bernama km_qa_*_test (pagar di assertQaDb).
// Tidak menyentuh produksi: tidak ada koneksi ke VPS, tidak ada WAHA/cron (server memakai router asli lewat buildTestApp).
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

export const QA_PASSWORD = "QaManifest2026!"; // hanya untuk DB QA lokal; bukan kredensial produksi
export const QA_DRIVER_EMAIL = "qa.driver@qa.test";
export const QA_ADMIN_EMAIL = "qa.admin@qa.test";

export function assertQaDb(url) {
  const nama = (url.match(/\/([^/?]+)(\?.*)?$/) || [])[1] || "";
  if (!/^km_qa_[a-z0-9_]+_test$/.test(nama)) {
    throw new Error(`Menolak: database "${nama}" bukan database QA (harus cocok km_qa_*_test). Produksi tidak pernah boleh dipakai di sini.`);
  }
  return nama;
}

export async function seedUsers(prisma) {
  const passwordHash = await bcrypt.hash(QA_PASSWORD, 10);
  const mk = async (name, email, role) =>
    prisma.user.upsert({ where: { email }, update: { passwordHash, role }, create: { name, email, passwordHash, role } });
  const driver = await mk("QA Driver", QA_DRIVER_EMAIL, "DRIVER");
  const admin = await mk("QA Admin", QA_ADMIN_EMAIL, "ADMIN");
  return { driver, admin };
}

/**
 * Flag V2 di DB QA. Paritas produksi (dibaca baca-saja 14 Okt 2026): writer rute+eksekusi AKTIF, reader snapshot driver MATI — jadi RN produksi
 * membaca job lewat /armada/my-jobs (V1). `reader: true` hanya dipakai E2E untuk menguji jalur snapshot V2 juga.
 */
export async function aktifkanFlagV2(prisma, { reader = false } = {}) {
  const set = { delivery_v2_writer_route: true, delivery_v2_writer_execution: true, driver_v2_snapshot_reader: reader };
  for (const [key, enabled] of Object.entries(set)) {
    await prisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled, scope: "GLOBAL", config: {}, reason: "QA manifest HP (DB lokal)" }, update: { enabled, scope: "GLOBAL", config: {} } });
  }
}

/** Satu job DELIVERY (ARRIVED) milik `driver`, 3 unit U1–U3 siap kirim, di rute terbit sendiri. */
export async function seedJob(prisma, { driver, label, tanggal = new Date() }) {
  const { buildDeliveryRouteSnapshot, DELIVERY_V2_ROUTE_INCLUDE, deliveryJobSource, deliveryV2Checksum } = await import("../../src/services/deliveryV2Snapshot.js");
  const hari = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate()));
  const sufiks = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const customer = await prisma.customer.create({ data: { name: `Pelanggan QA ${label}`, phone: `62812${String(Date.now()).slice(-8)}` } });
  const order = await prisma.order.create({
    data: { customerId: customer.id, orderNumber: `QA-${label}-${sufiks}`, value: 7_200_000, category: "BARU", quantity: 3, status: "READY",
      notes: JSON.stringify({ merkKasur: "Kasur Sorong 3in1 custom", ukuranKasur: "100x200" }) },
  });
  const units = [];
  for (let i = 1; i <= 3; i += 1) {
    units.push(await prisma.unit.create({ data: { orderId: order.id, unitCode: `${order.orderNumber}-U${i}`, seq: i, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", status: "READY_FOR_DELIVERY" } }));
  }
  const route = await prisma.route.create({ data: { code: `QA-${label}-${sufiks}`, date: hari, status: "IN_PROGRESS", publishedAt: new Date(), driverId: driver.id } });
  const job = await prisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.id, scheduledDate: hari, status: "ARRIVED", arrivedAt: new Date(), sequence: 1 },
  });
  for (const u of units) await prisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
  await prisma.deliveryJobState.create({ data: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: deliveryV2Checksum(deliveryJobSource(job)), migrationSource: "TEST_BASELINE" } });
  const fullRoute = await prisma.route.findUniqueOrThrow({ where: { id: route.id }, include: DELIVERY_V2_ROUTE_INCLUDE });
  const snapshot = buildDeliveryRouteSnapshot(fullRoute, { routeRevision: 1, publicationVersion: 1 });
  const checksum = deliveryV2Checksum(snapshot);
  await prisma.deliveryRouteState.create({ data: { routeId: route.id, routeRevision: 1, currentPublicationVersion: 1, lifecycleStatus: route.status, draftSnapshot: snapshot, draftChecksum: checksum, sourceChecksum: checksum, migrationSource: "TEST_BASELINE" } });
  await prisma.routePublication.create({
    data: { routeId: route.id, publicationVersion: 1, routeRevision: 1, status: "ACTIVE", snapshot, checksum, migrationBaseline: true,
      assignments: { create: [{ jobId: job.id, sequence: 1, driverId: driver.id, status: "ACTIVE", sourceChecksum: deliveryV2Checksum(snapshot.stops[0]) }] } },
  });
  return { customer, order, units, route, job };
}

export const kunci = (p = "qa") => ({ "Idempotency-Key": `${p}-${randomUUID()}` });
