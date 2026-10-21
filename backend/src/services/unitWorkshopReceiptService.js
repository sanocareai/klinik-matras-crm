// PENERIMAAN WORKSHOP OLEH PETUGAS — catatan resmi "unit diterima di workshop" berdasarkan penerimaan fisik nyata (Gudang / Produksi / Admin).
//
// Prinsip (keputusan produk Okt 2026): penerimaan fisik adalah FAKTA yang dicatat sendiri — TANPA mengaktifkan unit ke cohort Produksi V2, tanpa membuka Production Run,
// tanpa memetakan layanan, tanpa tahap/QC/stok/jurnal. Aktivasi Produksi V2 tetap tindakan terpisah (Jadwalkan oleh ADMIN/OWNER) dan TIDAK mencatat tiba dua kali:
// bila Run dibuka sesudah penerimaan, unitCustodyCommandService.adoptWorkshopReceiptInTx memakai catatan ini sebagai kedatangan; bila Run PENDING_ARRIVAL sudah ada lebih dulu,
// penerimaan didelegasikan ke jalur resmi confirmUnitArrival (satu-satunya penulis custody/Run) sehingga tidak ada sumber kebenaran kedua.
// Sumber bukti tunggal milestone: lib/domain/workshopMilestone.js (basis WORKSHOP_RECEIPT). Idempoten secara alami: UNIQUE(unit_id) + kunci baris unit.
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { assertLocationAllowed, confirmUnitArrival, custodyHooks } from "./unitCustodyCommandService.js";
import { requireWorkshopDefaultLocation } from "./productionSettingsService.js";
import { loadMilestoneEvidence, WHERE_PICKUP_DONE_NOT_RECEIVED } from "./workshopMilestoneEvidence.js";
import { RECEIVED_BASIS_LABEL } from "../lib/domain/workshopMilestone.js";

export class PenerimaanError extends Error {
  constructor(message, statusCode, code, extra) { super(message); this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}

const STATUS_BOLEH = ["RECEIVED", "IN_PRODUCTION"]; // pickup selesai (RECEIVED tersimpan) — AWAITING_PICKUP / IN_TRANSIT_IN belum tiba secara fisik
const MAX_NOTE = 500;

const tampilan = (r) => r && ({
  id: r.id, unitId: r.unitId, receivedAt: r.receivedAt,
  receivedBy: r.receivedBy ? { id: r.receivedBy.id, name: r.receivedBy.name } : { id: r.receivedById, name: null },
  location: r.location ? { id: r.location.id, code: r.location.code, zone: r.location.zone } : { id: r.locationId, code: null, zone: null },
  note: r.note ?? null,
});

async function ambilTampilan(client, unitId) {
  const r = await client.unitWorkshopReceipt.findUnique({ where: { unitId }, include: { location: { select: { id: true, code: true, zone: true } } } });
  if (!r) return null;
  const u = await client.user.findUnique({ where: { id: r.receivedById }, select: { id: true, name: true } });
  return tampilan({ ...r, receivedBy: u });
}

/** Penerimaan yang SUDAH tercatat untuk unit (bila ada) — dibaca panel Order Produksi. */
export const ambilPenerimaanWorkshop = (client, unitId) => ambilTampilan(client, unitId);

/**
 * Catat penerimaan fisik unit di workshop.
 * @param {object} p
 * @param {boolean} p.fisikDiterima  WAJIB true — petugas menyatakan unit benar-benar sudah diterima fisik (bukan dugaan dari status pickup)
 * @param {string|null} p.locationId lokasi Receiving/WIP tempat unit diletakkan; kosong = lokasi workshop bawaan Admin (409 berkode bila belum diatur)
 */
export async function catatPenerimaanWorkshop(prisma, { unitId, actorId, locationId = null, note = null, fisikDiterima = false, idempotencyKey = null }) {
  if (!unitId) throw new PenerimaanError("unitId wajib diisi", 400, "PENERIMAAN_UNIT_WAJIB");
  if (!actorId) throw new PenerimaanError("Pelaku penerimaan wajib diketahui", 400, "PENERIMAAN_PELAKU_WAJIB");
  if (fisikDiterima !== true) throw new PenerimaanError("Penerimaan hanya dicatat setelah unit benar-benar diterima fisik di workshop. Centang pernyataan penerimaan fisik.", 400, "PENERIMAAN_FISIK_WAJIB");
  const catatan = typeof note === "string" ? note.trim() : "";
  if (catatan.length > MAX_NOTE) throw new PenerimaanError(`Catatan maksimal ${MAX_NOTE} karakter`, 400, "PENERIMAAN_CATATAN_PANJANG");

  const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true } });
  if (!unit) throw new PenerimaanError("Unit tidak ditemukan", 404, "PENERIMAAN_UNIT_TIDAK_ADA");

  // Sudah ada bukti terima (penerimaan ini, custody, konfirmasi petugas, lahir di workshop): jawaban idempoten, TIDAK ada catatan kedua — termasuk klik ganda / sesudah unit maju status.
  const sudah = (await loadMilestoneEvidence(prisma, [unitId])).get(unitId);
  if (sudah?.receivedBasis) {
    return { replayed: true, alreadyReceived: true, via: "BUKTI_ADA", basis: sudah.receivedBasis, basisLabel: RECEIVED_BASIS_LABEL[sudah.receivedBasis], receipt: await ambilTampilan(prisma, unitId) };
  }
  if (!STATUS_BOLEH.includes(unit.status)) {
    throw new PenerimaanError(unit.status === "AWAITING_PICKUP" || unit.status === "IN_TRANSIT_IN"
      ? "Unit belum selesai dijemput — penerimaan di workshop dicatat setelah pickup selesai dan unit benar-benar tiba."
      : `Unit berstatus ${unit.status}; penerimaan workshop tidak dapat dicatat pada status ini.`, 409, "PENERIMAAN_STATUS_UNIT", { status: unit.status });
  }

  // Run Produksi V2 sudah ada dan menunggu kedatangan: SATU jalur resmi (custody / konfirmasi petugas) — jangan membuat catatan paralel.
  const pending = await prisma.productionRun.findFirst({ where: { unitId, status: "PENDING_ARRIVAL" }, select: { id: true } });
  if (pending) {
    const hasil = await confirmUnitArrival(prisma, { unitId, actorId, idempotencyKey: idempotencyKey || `penerimaan:${unitId}:${actorId}`, locationId });
    return { replayed: !!hasil.replayed, alreadyReceived: false, via: "PRODUKSI_V2", basis: hasil.custody === false ? "STAFF_CONFIRMED" : "CUSTODY", productionRunId: hasil.productionRunId ?? null, receipt: null };
  }

  const lokasiId = locationId || (await requireWorkshopDefaultLocation(prisma)).id;
  const hasil = await prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId); // dua petugas / klik ganda diserialkan di sini
    const ada = await tx.unitWorkshopReceipt.findUnique({ where: { unitId }, select: { id: true } });
    if (ada) return { replayed: true };
    const lokasi = await tx.storageLocation.findUnique({ where: { id: lokasiId } });
    assertLocationAllowed("INBOUND", lokasi); // sama dengan "Unit Tiba": hanya area Receiving / WIP / Karantina yang aktif
    const sekarang = new Date();
    const baris = await tx.unitWorkshopReceipt.create({ data: { unitId, locationId: lokasi.id, receivedAt: sekarang, receivedById: actorId, note: catatan || null } });
    await tx.unit.update({ where: { id: unitId }, data: { storageLocation: lokasi.code } }); // proyeksi legacy "Lokasi Simpan" (locationId di catatan = sumber)
    await tx.domainOutbox.create({
      data: {
        domain: "PRODUCTION", eventType: "production.unit.received-workshop", aggregateType: "Unit", aggregateId: unitId, aggregateRevision: 1,
        dedupeKey: `unit-received-workshop:${unitId}:receipt`,
        payload: { unitId, orderId: unit.orderId, basis: "WORKSHOP_RECEIPT", receiptId: baris.id, locationId: lokasi.id, occurredAt: sekarang.toISOString(), actorId },
      },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.WORKSHOP_RECEIPT_RECORDED, actorId,
      metadata: { unitCode: unit.unitCode, receiptId: baris.id, locationCode: lokasi.code, note: catatan || null },
    });
    return { replayed: false };
  });
  if (!hasil.replayed) Promise.resolve().then(() => custodyHooks.unitReceivedAtWorkshop(unitId)).catch((err) => console.error("[penerimaan] hook unitReceivedAtWorkshop gagal:", err.message)); // sama dengan "Unit Tiba": sekali per transisi, nonaktif selagi DELIVERY_NOTIF_AKTIF=false
  return { replayed: hasil.replayed, alreadyReceived: hasil.replayed, via: "WORKSHOP_RECEIPT", basis: "WORKSHOP_RECEIPT", basisLabel: RECEIVED_BASIS_LABEL.WORKSHOP_RECEIPT, receipt: await ambilTampilan(prisma, unitId) };
}

/** Antrean petugas Gudang: unit yang pickup-nya selesai tetapi belum ada bukti terima di workshop. BACA-SAJA. */
export async function daftarMenungguPenerimaan(prisma, { limit = 100, q = null } = {}) {
  const batas = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const cari = typeof q === "string" ? q.trim() : "";
  const where = {
    AND: [
      WHERE_PICKUP_DONE_NOT_RECEIVED,
      { order: { is: { status: { notIn: ["CANCELLED"] } } } },
      ...(cari ? [{ OR: [{ unitCode: { contains: cari, mode: "insensitive" } }, { order: { is: { orderNumber: { contains: cari, mode: "insensitive" } } } }, { order: { is: { customer: { is: { name: { contains: cari, mode: "insensitive" } } } } } }] }] : []),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.unit.count({ where }),
    prisma.unit.findMany({
      where, take: batas, orderBy: [{ updatedAt: "asc" }, { unitCode: "asc" }],
      select: { id: true, unitCode: true, merk: true, ukuran: true, updatedAt: true, order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } } },
    }),
  ]);
  return {
    total,
    units: rows.map((u) => ({ unitId: u.id, unitCode: u.unitCode, merk: u.merk, ukuran: u.ukuran, orderId: u.order?.id ?? null, orderNumber: u.order?.orderNumber ?? null, customerName: u.order?.customer?.name ?? null, sejak: u.updatedAt })),
  };
}
