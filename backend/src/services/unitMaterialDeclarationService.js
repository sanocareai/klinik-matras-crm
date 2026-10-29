// PERNYATAAN "TANPA BAHAN BARU" per unit — pernyataan EKSPLISIT dan dapat diaudit (alasan wajib, pelaku, waktu, pencabutan tercatat). Tabel: unit_material_declarations.
//
// Dipakai penyaring kelengkapan Order Produksi: unit yang sudah dikerjakan/selesai TANPA catatan pemakaian apa pun tampil "Bahan belum dicatat"; bila unit memang tidak memakai bahan baru, Admin MENYATAKANNYA di sini
// (bukan ditebak sistem). Layanan ini TIDAK membuat stok, Material Issue, Run, tahap, QC, biaya, atau jurnal, dan TIDAK mengubah status kerja/status order.
// Aturan: satu pernyataan AKTIF per unit; ditolak bila unit dibatalkan atau SUDAH punya catatan pemakaian (pernyataan itu akan bertentangan dengan datanya); pencabutan mengubah status (baris tidak dihapus).
import { lockRowForUpdate } from "./inventoryLedger.js";
import { BahanUsulanError, kunciValid } from "../lib/domain/bahanUsulan.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const KIND_TANPA_BAHAN = "TANPA_BAHAN_BARU";
const ALASAN_MIN = 5; const ALASAN_MAKS = 500;
const alasanBersih = (v, nama = "Alasan") => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (t.length < ALASAN_MIN) throw new BahanUsulanError(`${nama} wajib diisi (minimal ${ALASAN_MIN} huruf), supaya pernyataan ini dapat diaudit.`, "ALASAN_WAJIB", 400);
  if (t.length > ALASAN_MAKS) throw new BahanUsulanError(`${nama} terlalu panjang (maksimal ${ALASAN_MAKS} huruf).`, "ALASAN_TERLALU_PANJANG", 400);
  return t;
};
const nama = async (db, ids) => { const u = [...new Set(ids.filter(Boolean))]; return u.length ? new Map((await db.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true } })).map((x) => [x.id, x.name])) : new Map(); };
const tampil = (r, peta) => ({
  id: r.id, status: r.status, alasan: r.reason, oleh: peta.get(r.declaredById) ?? null, at: r.declaredAt,
  dicabutOleh: r.revokedById ? peta.get(r.revokedById) ?? null : null, dicabutAt: r.revokedAt ?? null, alasanCabut: r.revokeReason ?? null,
});

/** Adakah catatan pemakaian apa pun pada unit (pernyataan "tanpa bahan baru" tidak boleh bertentangan dengan datanya). */
async function adaCatatanPemakaian(tx, unitId) {
  const [issue, lama, sementara, catatan] = await Promise.all([
    tx.stockMovement.count({ where: { unitId, type: "ISSUE" } }),
    tx.unitComponentReuseEntry.count({ where: { unitId, outcome: "REUSED", kind: { in: ["CREATED", "CORRECTED"] } } }),
    tx.unitProvisionalUsage.count({ where: { unitId, status: { in: ["PERLU_REKONSILIASI", "DIREKONSILIASI"] } } }),
    tx.unitUsageNote.count({ where: { unitId, state: { not: "TIDAK_DIHITUNG" } } }),
  ]);
  return { issue, lama, sementara, catatan, ada: issue + lama + sementara + catatan > 0 };
}

/** Baca-saja: pernyataan aktif + riwayat (terbaru dulu) untuk drawer. */
export async function ambilPernyataanUnit(db, unitId) {
  const baris = await db.unitMaterialDeclaration.findMany({ where: { unitId }, orderBy: [{ declaredAt: "desc" }, { id: "desc" }] });
  const peta = await nama(db, baris.flatMap((r) => [r.declaredById, r.revokedById]));
  const semua = baris.map((r) => tampil(r, peta));
  return { aktif: semua.find((x) => x.status === "ACTIVE") ?? null, riwayat: semua };
}

/** Nyatakan unit memang tanpa bahan baru. Idempoten per kunci; satu pernyataan AKTIF per unit. */
export async function nyatakanTanpaBahanBaru(prisma, { unitId, alasan, actorId, idempotencyKey }) {
  const kunci = kunciValid(idempotencyKey); const teks = alasanBersih(alasan);
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true } });
    if (!unit) throw new BahanUsulanError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
    const ada = await tx.unitMaterialDeclaration.findUnique({ where: { idempotencyKey: kunci } });
    if (ada) {
      if (ada.unitId !== unitId || ada.reason !== teks) throw new BahanUsulanError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda.", "IDEMPOTENCY_KEY_REUSED", 409);
      return { replayed: true, pernyataan: tampil(ada, await nama(tx, [ada.declaredById, ada.revokedById])) };
    }
    if (unit.status === "CANCELLED") throw new BahanUsulanError(`Unit ${unit.unitCode} dibatalkan; tidak perlu pernyataan bahan.`, "UNIT_DIBATALKAN", 409);
    const aktif = await tx.unitMaterialDeclaration.findFirst({ where: { unitId, status: "ACTIVE" } });
    if (aktif) throw new BahanUsulanError("Unit ini sudah punya pernyataan \"tanpa bahan baru\" yang aktif. Cabut dulu bila ingin menggantinya.", "PERNYATAAN_SUDAH_ADA", 409);
    const catatan = await adaCatatanPemakaian(tx, unitId);
    if (catatan.ada) throw new BahanUsulanError("Unit ini sudah punya catatan pemakaian bahan (Gudang, sementara, komponen lama, atau historis), jadi tidak bisa dinyatakan \"tanpa bahan baru\". Periksa catatan yang ada.", "SUDAH_ADA_CATATAN_BAHAN", 409, catatan);
    const baris = await tx.unitMaterialDeclaration.create({ data: { unitId, kind: KIND_TANPA_BAHAN, reason: teks, declaredById: actorId, idempotencyKey: kunci } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_PERNYATAAN_TANPA_BAHAN, actorId, metadata: { unitCode: unit.unitCode, orderId: unit.orderId, kind: "DINYATAKAN", alasan: teks, declarationId: baris.id } });
    return { replayed: false, pernyataan: tampil(baris, await nama(tx, [actorId])) };
  });
}

/** Cabut pernyataan aktif (alasan wajib). Baris tidak dihapus: status → REVOKED + pelaku/waktu/alasan. Tidak ada pernyataan aktif → 404. */
export async function cabutPernyataanTanpaBahan(prisma, { unitId, alasan, actorId }) {
  const teks = alasanBersih(alasan, "Alasan pencabutan");
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, orderId: true } });
    if (!unit) throw new BahanUsulanError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
    const aktif = await tx.unitMaterialDeclaration.findFirst({ where: { unitId, status: "ACTIVE" } });
    if (!aktif) throw new BahanUsulanError("Unit ini tidak punya pernyataan \"tanpa bahan baru\" yang aktif.", "PERNYATAAN_TIDAK_ADA", 404);
    const baris = await tx.unitMaterialDeclaration.update({ where: { id: aktif.id }, data: { status: "REVOKED", revokedById: actorId, revokedAt: new Date(), revokeReason: teks } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_PERNYATAAN_TANPA_BAHAN, actorId, metadata: { unitCode: unit.unitCode, orderId: unit.orderId, kind: "DICABUT", alasan: teks, declarationId: baris.id } });
    return { pernyataan: tampil(baris, await nama(tx, [baris.declaredById, actorId])) };
  });
}
