// PENERIMAAN WORKSHOP OLEH PETUGAS — catatan resmi "unit diterima di workshop" berdasarkan penerimaan fisik nyata (Gudang / Produksi / Admin).
//
// Prinsip (keputusan produk Okt 2026): penerimaan fisik adalah FAKTA yang dicatat sendiri — TANPA mengaktifkan unit ke cohort Produksi V2, tanpa membuka Production Run,
// tanpa memetakan layanan, tanpa tahap/QC/stok/jurnal. Aktivasi Produksi V2 tetap tindakan terpisah (Jadwalkan oleh ADMIN/OWNER) dan TIDAK mencatat tiba dua kali:
// bila Run dibuka sesudah penerimaan, unitCustodyCommandService.adoptWorkshopReceiptInTx memakai catatan ini sebagai kedatangan; bila Run PENDING_ARRIVAL sudah ada lebih dulu,
// penerimaan didelegasikan ke jalur resmi confirmUnitArrival (satu-satunya penulis custody/Run) sehingga tidak ada sumber kebenaran kedua.
// Sumber bukti tunggal milestone: lib/domain/workshopMilestone.js (basis WORKSHOP_RECEIPT). Idempoten: kunci baris unit + UNIQUE(unit_id, seq).
//
// KOREKSI (append-only; catatan asli TIDAK pernah diubah/dihapus): dua jenis yang dibedakan tegas —
//   LOCATION      "lokasi salah"        unit memang sudah diterima; lokasi efektif berganti (nilai lama + baru, pelaku, alasan disimpan). Bila handoff sudah memakai penerimaan ini,
//                                       lokasi handoff ikut dikoreksi lewat penulis custody (revisi naik); Run/status tidak berubah.
//   NOT_RECEIVED  "belum diterima fisik" penerimaan dinyatakan tidak berlaku (unit kembali ke antrean). HANYA bila belum ada yang bergantung padanya (tidak ada Run/serah-terima/pekerjaan
//                                       dimulai/status maju). Jika ada, DITOLAK 409 dengan daftar dampak — tidak pernah diam-diam membalik Run atau custody; koreksinya harus lewat Kepala Produksi/tim sistem.
// Revisi basi (orang lain sudah mengoreksi) ditolak 409; kunci idempotensi membuat klik ganda menjadi satu baris koreksi.
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { assertLocationAllowed, confirmUnitArrival, custodyHooks, handoffDariPenerimaanInTx, koreksiLokasiHandoffDariPenerimaanInTx } from "./unitCustodyCommandService.js";
import { requireWorkshopDefaultLocation } from "./productionSettingsService.js";
import { loadMilestoneEvidence, WHERE_PICKUP_DONE_NOT_RECEIVED, WHERE_RECEIPT_AKTIF } from "./workshopMilestoneEvidence.js";
import { productionWriterEnabledForUnit } from "./v2FeatureFlags.js";
import { notifikasiPelangganAktif } from "./customerNotifications.js";
import { RECEIVED_BASIS_LABEL } from "../lib/domain/workshopMilestone.js";
import { displayStatusOfUnit } from "../lib/domain/productionDisplay.js";

export class PenerimaanError extends Error {
  constructor(message, statusCode, code, extra) { super(message); this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}

const STATUS_BOLEH = ["RECEIVED", "IN_PRODUCTION"]; // pickup selesai (RECEIVED tersimpan) — AWAITING_PICKUP / IN_TRANSIT_IN belum tiba secara fisik
const MAX_NOTE = 500;
export const JENIS_KOREKSI = Object.freeze({ LOCATION: "LOCATION", NOT_RECEIVED: "NOT_RECEIVED" });
export const JENIS_KOREKSI_LABEL = Object.freeze({ LOCATION: "Lokasi salah", NOT_RECEIVED: "Ternyata belum diterima fisik" });

const lokasiNilai = (l) => (l ? { locationId: l.id, code: l.code, zone: l.zone ?? null } : null);

async function namaPengguna(client, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await client.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(rows.map((u) => [u.id, u.name]));
}

/** Semua penerimaan unit (seq naik) beserta koreksinya, siap tampil. `aktif` = yang tidak dikoreksi "belum diterima". */
async function muatRiwayat(client, unitId) {
  const rows = await client.unitWorkshopReceipt.findMany({
    where: { unitId }, orderBy: { seq: "asc" },
    include: { location: { select: { id: true, code: true, zone: true } }, corrections: { orderBy: { createdAt: "asc" } } },
  });
  const nama = await namaPengguna(client, rows.flatMap((r) => [r.receivedById, ...r.corrections.map((c) => c.actorId)]));
  const tampil = rows.map((r) => {
    const batal = r.corrections.find((c) => c.kind === "NOT_RECEIVED") || null;
    const koreksiLokasi = r.corrections.filter((c) => c.kind === "LOCATION");
    const lokasi = koreksiLokasi.length ? koreksiLokasi[koreksiLokasi.length - 1].newValue : lokasiNilai(r.location);
    return {
      id: r.id, unitId: r.unitId, seq: r.seq, receivedAt: r.receivedAt, receivedBy: { id: r.receivedById, name: nama.get(r.receivedById) ?? null },
      location: { id: lokasi.locationId, code: lokasi.code, zone: lokasi.zone ?? null }, lokasiAwal: lokasiNilai(r.location), note: r.note ?? null,
      aktif: !batal, revisi: r.corrections.length,
      koreksi: r.corrections.map((c) => ({
        id: c.id, jenis: c.kind, jenisLabel: JENIS_KOREKSI_LABEL[c.kind], oleh: { id: c.actorId, name: nama.get(c.actorId) ?? null }, at: c.createdAt,
        alasan: c.reason, lama: c.oldValue, baru: c.newValue ?? null,
      })),
    };
  });
  return { rows, tampil, aktif: [...tampil].reverse().find((t) => t.aktif) ?? null };
}

/** Penerimaan AKTIF unit (atau null) + riwayat lengkap termasuk yang dikoreksi — dibaca panel Order Produksi. */
export async function ambilPenerimaanWorkshop(client, unitId) {
  const { tampil, aktif } = await muatRiwayat(client, unitId);
  return { penerimaan: aktif, riwayat: tampil };
}

/**
 * Dampak koreksi: apa saja yang SUDAH bergantung pada penerimaan ini. Bahasa petugas (tanpa istilah Run/cohort). `bolehNotReceived=false` bila ada yang bergantung — penerimaan tidak
 * dibatalkan dari sini karena akan membalik pekerjaan/serah-terima yang sudah berjalan.
 */
export async function hitungDampakKoreksi(client, unitId, receiptId) {
  const [unit, runs, handoffAcc, mulai, logs, handoffDari, tuanRumahV2] = await Promise.all([
    client.unit.findUnique({ where: { id: unitId }, select: { status: true, unitCode: true } }),
    client.productionRun.findMany({ where: { unitId }, select: { id: true, status: true } }),
    client.unitCustodyHandoff.count({ where: { unitId, direction: "INBOUND", status: "ACCEPTED" } }),
    client.productionOperationRun.count({ where: { run: { unitId }, status: { not: "SKIPPED" } } }),
    client.unitStageLog.count({ where: { unitId } }),
    handoffDariPenerimaanInTx(client, receiptId),
    productionWriterEnabledForUnit(client, unitId),
  ]);
  const butir = [];
  const tambah = (kode, teks, menghalangiBatal = true) => butir.push({ kode, teks, menghalangiBatal });
  if (runs.length) tambah("PEKERJAAN_DIBUKA", "Unit ini sudah masuk Rencana Produksi: pekerjaan produksinya sudah dibuka.");
  if (handoffDari) tambah("SERAH_TERIMA_MEMAKAI_PENERIMAAN", "Serah-terima unit ke workshop sudah dicatat memakai penerimaan ini (atas nama penerima aslinya).");
  else if (handoffAcc) tambah("SERAH_TERIMA_ADA", "Unit ini sudah punya catatan serah-terima ke workshop.");
  if (mulai > 0 || logs > 0) tambah("PEKERJAAN_DIMULAI", "Pekerjaan pada unit ini sudah dimulai (ada tahap atau operasi tercatat).");
  if (unit && (!STATUS_BOLEH.includes(unit.status) || unit.status === "IN_PRODUCTION")) tambah("STATUS_UNIT_MAJU", `Status unit sudah ${displayStatusOfUnit(unit.status)?.label ?? unit.status}.`);
  if (tuanRumahV2 && !runs.length) tambah("UNIT_DI_ALUR_PRODUKSI", "Unit ini sudah diaktifkan di alur Rencana Produksi.");
  if (notifikasiPelangganAktif()) tambah("PELANGGAN_DIBERI_TAHU", "Pesan \"unit diterima di workshop\" mungkin sudah terkirim ke pelanggan — koreksi tidak menarik pesan itu; beri tahu pelanggan bila perlu.", false);
  const halangi = butir.filter((b) => b.menghalangiBatal);
  return {
    unitStatus: unit?.status ?? null, butir, handoffDariPenerimaan: handoffDari ? handoffDari.id : null,
    bolehNotReceived: halangi.length === 0,
    alasanNotReceivedTertolak: halangi.length ? "Penerimaan ini sudah dipakai proses lain, jadi tidak bisa dinyatakan \"belum diterima\" dari sini. Membatalkannya berarti membalik pekerjaan atau serah-terima yang sudah berjalan — minta Kepala Produksi atau tim sistem menanganinya lewat jalur resmi." : null,
  };
}

/** Pratinjau koreksi untuk layar: penerimaan aktif + revisi + dampak + apakah tiap jenis boleh. */
export async function pratinjauKoreksi(client, unitId) {
  const { aktif } = await muatRiwayat(client, unitId);
  if (!aktif) throw new PenerimaanError("Unit ini belum punya catatan penerimaan petugas yang berlaku, jadi tidak ada yang dikoreksi di sini.", 404, "PENERIMAAN_TIDAK_ADA");
  const dampak = await hitungDampakKoreksi(client, unitId, aktif.id);
  return { penerimaan: aktif, revisi: aktif.revisi, dampak, boleh: { LOCATION: true, NOT_RECEIVED: dampak.bolehNotReceived } };
}

/**
 * Catat penerimaan fisik unit di workshop.
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
    return { replayed: true, alreadyReceived: true, via: "BUKTI_ADA", basis: sudah.receivedBasis, basisLabel: RECEIVED_BASIS_LABEL[sudah.receivedBasis], receipt: (await ambilPenerimaanWorkshop(prisma, unitId)).penerimaan };
  }
  if (!STATUS_BOLEH.includes(unit.status)) {
    throw new PenerimaanError(unit.status === "AWAITING_PICKUP" || unit.status === "IN_TRANSIT_IN"
      ? "Unit belum selesai dijemput — penerimaan di workshop dicatat setelah pickup selesai dan unit benar-benar tiba."
      : `Unit berstatus ${unit.status}; penerimaan workshop tidak dapat dicatat pada status ini.`, 409, "PENERIMAAN_STATUS_UNIT", { status: unit.status });
  }

  // Run Produksi sudah ada dan menunggu kedatangan: SATU jalur resmi (custody / konfirmasi petugas) — jangan membuat catatan paralel.
  const pending = await prisma.productionRun.findFirst({ where: { unitId, status: "PENDING_ARRIVAL" }, select: { id: true } });
  if (pending) {
    const hasil = await confirmUnitArrival(prisma, { unitId, actorId, idempotencyKey: idempotencyKey || `penerimaan:${unitId}:${actorId}`, locationId });
    return { replayed: !!hasil.replayed, alreadyReceived: false, via: "PRODUKSI_V2", basis: hasil.custody === false ? "STAFF_CONFIRMED" : "CUSTODY", productionRunId: hasil.productionRunId ?? null, receipt: null };
  }

  const lokasiId = locationId || (await requireWorkshopDefaultLocation(prisma)).id;
  const hasil = await prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId); // dua petugas / klik ganda diserialkan di sini
    const ada = await tx.unitWorkshopReceipt.findFirst({ where: { unitId, ...WHERE_RECEIPT_AKTIF }, select: { id: true } });
    if (ada) return { replayed: true };
    const lokasi = await tx.storageLocation.findUnique({ where: { id: lokasiId } });
    assertLocationAllowed("INBOUND", lokasi); // sama dengan "Unit Tiba": hanya area Receiving / WIP / Karantina yang aktif
    const terakhir = await tx.unitWorkshopReceipt.findFirst({ where: { unitId }, orderBy: { seq: "desc" }, select: { seq: true } });
    const seq = (terakhir?.seq ?? 0) + 1; // >1 = penerimaan ulang sesudah koreksi "belum diterima"
    const dulu = await tx.unit.findUnique({ where: { id: unitId }, select: { storageLocation: true } });
    const sekarang = new Date();
    const baris = await tx.unitWorkshopReceipt.create({ data: { unitId, seq, locationId: lokasi.id, receivedAt: sekarang, receivedById: actorId, note: catatan || null, prevStorageLocation: dulu?.storageLocation ?? null } });
    await tx.unit.update({ where: { id: unitId }, data: { storageLocation: lokasi.code } }); // proyeksi legacy "Lokasi Simpan" (locationId di catatan = sumber)
    await tx.domainOutbox.create({
      data: {
        domain: "PRODUCTION", eventType: "production.unit.received-workshop", aggregateType: "Unit", aggregateId: unitId, aggregateRevision: seq,
        dedupeKey: seq === 1 ? `unit-received-workshop:${unitId}:receipt` : `unit-received-workshop:${unitId}:receipt:${seq}`,
        payload: { unitId, orderId: unit.orderId, basis: "WORKSHOP_RECEIPT", receiptId: baris.id, seq, locationId: lokasi.id, occurredAt: sekarang.toISOString(), actorId },
      },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.WORKSHOP_RECEIPT_RECORDED, actorId,
      metadata: { unitCode: unit.unitCode, receiptId: baris.id, seq, locationCode: lokasi.code, note: catatan || null },
    });
    return { replayed: false, seq };
  });
  // Pesan pelanggan hanya untuk penerimaan PERTAMA unit ini; penerimaan ulang sesudah koreksi tidak mengirim pesan kedua (pelanggan sudah diberi tahu / koreksi bukan peristiwa baru).
  if (!hasil.replayed && hasil.seq === 1) Promise.resolve().then(() => custodyHooks.unitReceivedAtWorkshop(unitId, { basis: "WORKSHOP_RECEIPT" })).catch((err) => console.error("[penerimaan] hook unitReceivedAtWorkshop gagal:", err.message));
  return { replayed: hasil.replayed, alreadyReceived: hasil.replayed, via: "WORKSHOP_RECEIPT", basis: "WORKSHOP_RECEIPT", basisLabel: RECEIVED_BASIS_LABEL.WORKSHOP_RECEIPT, receipt: (await ambilPenerimaanWorkshop(prisma, unitId)).penerimaan };
}

/**
 * Koreksi penerimaan (lihat kepala berkas). Catatan asli tidak diubah: koreksi = satu baris baru (nilai lama + baru, alasan, pelaku, dampak).
 * @param {"LOCATION"|"NOT_RECEIVED"} p.jenis
 * @param {number} p.expectedRevisi jumlah koreksi yang dilihat pengguna — tidak cocok = 409 KOREKSI_REVISI_BASI
 */
export async function koreksiPenerimaanWorkshop(prisma, { unitId, actorId, jenis, locationId = null, alasan, expectedRevisi, idempotencyKey = null }) {
  if (!unitId) throw new PenerimaanError("unitId wajib diisi", 400, "PENERIMAAN_UNIT_WAJIB");
  if (!actorId) throw new PenerimaanError("Pelaku koreksi wajib diketahui", 400, "PENERIMAAN_PELAKU_WAJIB");
  if (!Object.values(JENIS_KOREKSI).includes(jenis)) throw new PenerimaanError("Jenis koreksi tidak dikenal: pilih \"Lokasi salah\" atau \"Ternyata belum diterima fisik\".", 400, "KOREKSI_JENIS_TIDAK_VALID");
  const sebab = typeof alasan === "string" ? alasan.trim() : "";
  if (sebab.length < 3) throw new PenerimaanError("Alasan koreksi wajib diisi (minimal 3 karakter).", 400, "KOREKSI_ALASAN_WAJIB");
  if (sebab.length > MAX_NOTE) throw new PenerimaanError(`Alasan maksimal ${MAX_NOTE} karakter`, 400, "KOREKSI_ALASAN_PANJANG");
  if (!Number.isInteger(expectedRevisi) || expectedRevisi < 0) throw new PenerimaanError("Muat ulang panel: versi catatan penerimaan yang Anda lihat tidak terbaca.", 400, "KOREKSI_REVISI_WAJIB");
  if (jenis === JENIS_KOREKSI.LOCATION && !locationId) throw new PenerimaanError("Pilih lokasi yang benar.", 400, "KOREKSI_LOKASI_WAJIB");
  const kunci = typeof idempotencyKey === "string" && idempotencyKey.trim() ? idempotencyKey.trim().slice(0, 128) : null;

  const hasil = await prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    // Ulangan niat yang SAMA (klik ganda / retry jaringan): jawaban tersimpan, tidak ada baris kedua.
    if (kunci) {
      const prior = await tx.unitWorkshopReceiptCorrection.findFirst({ where: { unitId, idempotencyKey: kunci }, select: { id: true, kind: true } });
      if (prior) return { replayed: true, koreksiId: prior.id, jenis: prior.kind };
    }
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, storageLocation: true } });
    if (!unit) throw new PenerimaanError("Unit tidak ditemukan", 404, "PENERIMAAN_UNIT_TIDAK_ADA");
    const { rows, aktif } = await muatRiwayat(tx, unitId);
    if (!aktif) throw new PenerimaanError("Unit ini tidak punya catatan penerimaan petugas yang berlaku (mungkin sudah dikoreksi orang lain). Muat ulang panel.", 409, "PENERIMAAN_TIDAK_ADA");
    if (aktif.revisi !== expectedRevisi) throw new PenerimaanError("Catatan penerimaan ini sudah dikoreksi orang lain sejak Anda membukanya. Muat ulang panel lalu periksa lagi.", 409, "KOREKSI_REVISI_BASI", { revisi: aktif.revisi });
    const baris = rows.find((r) => r.id === aktif.id);
    const dampak = await hitungDampakKoreksi(tx, unitId, aktif.id);
    const nilaiLama = jenis === JENIS_KOREKSI.LOCATION
      ? { locationId: aktif.location.id, code: aktif.location.code, zone: aktif.location.zone }
      : { locationId: aktif.location.id, code: aktif.location.code, receivedAt: aktif.receivedAt, receivedById: aktif.receivedBy.id, seq: aktif.seq };
    let nilaiBaru = null; let handoff = null;
    if (jenis === JENIS_KOREKSI.LOCATION) {
      const lokasi = await tx.storageLocation.findUnique({ where: { id: locationId } });
      assertLocationAllowed("INBOUND", lokasi);
      if (lokasi.id === aktif.location.id) throw new PenerimaanError("Lokasi yang dipilih sama dengan lokasi tercatat — tidak ada yang dikoreksi.", 409, "KOREKSI_LOKASI_SAMA");
      nilaiBaru = lokasiNilai(lokasi);
      handoff = await koreksiLokasiHandoffDariPenerimaanInTx(tx, { receiptId: aktif.id, newLocation: lokasi, actorId, reason: sebab });
      if (unit.storageLocation === aktif.location.code || unit.storageLocation == null) await tx.unit.update({ where: { id: unitId }, data: { storageLocation: lokasi.code } });
    } else {
      if (!dampak.bolehNotReceived) throw new PenerimaanError(dampak.alasanNotReceivedTertolak, 409, "KOREKSI_PERLU_JALUR_RESMI", { dampak: dampak.butir });
      // Kembalikan proyeksi lokasi hanya bila masih menunjuk lokasi penerimaan ini (jangan menimpa perpindahan lain sesudahnya).
      if (unit.storageLocation === aktif.location.code) await tx.unit.update({ where: { id: unitId }, data: { storageLocation: baris.prevStorageLocation ?? null } });
    }
    const dibuat = await tx.unitWorkshopReceiptCorrection.create({
      data: { receiptId: aktif.id, unitId, kind: jenis, oldValue: nilaiLama, newValue: nilaiBaru ?? undefined, reason: sebab, impact: dampak.butir, idempotencyKey: kunci, actorId },
    });
    await tx.domainOutbox.create({
      data: {
        domain: "PRODUCTION", eventType: "production.unit.workshop-receipt-corrected", aggregateType: "Unit", aggregateId: unitId, aggregateRevision: aktif.revisi + 1,
        dedupeKey: `workshop-receipt-corrected:${dibuat.id}`,
        payload: { unitId, receiptId: aktif.id, correctionId: dibuat.id, kind: jenis, from: nilaiLama, to: nilaiBaru, handoffId: handoff?.handoffId ?? null, occurredAt: new Date().toISOString(), actorId },
      },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.WORKSHOP_RECEIPT_CORRECTED, actorId,
      metadata: { unitCode: unit.unitCode, receiptId: aktif.id, correctionId: dibuat.id, kind: jenis, kindLabel: JENIS_KOREKSI_LABEL[jenis], fromCode: nilaiLama.code, toCode: nilaiBaru?.code ?? null, reason: sebab },
    });
    return { replayed: false, koreksiId: dibuat.id, jenis };
  });
  return { ...hasil, ...(await ambilPenerimaanWorkshop(prisma, unitId)) };
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
