// Pengaturan Admin Production (Simplifikasi slice 2). SATU-SATUNYA penulis production_settings dan price_items.production_service_id.
//
//  - workshop_default_location_id : lokasi Receiving/WIP bawaan untuk "Unit Tiba di Workshop" (satu aksi, tanpa pilihan lokasi). TIDAK PERNAH ditebak:
//    belum dikonfigurasi / tidak valid -> 409 dengan pesan kebutuhan konfigurasi untuk Admin (tidak memilih lokasi acak, tidak memalsukan tiba).
//  - adaptation_default_policy   : "ADAPTATION_V1" | null — kebijakan adaptasi yang dicatat pada run BARU. Run yang sudah ada tidak berubah.
//  - Pemetaan layanan Sales -> layanan produksi = price_items.production_service_id (tautan kanonis yang sudah ada sejak katalog harga). Diagnosis memakai
//    pemetaan ini; bila belum ada, kebutuhan mapping diarahkan ke Pengaturan Admin — operator tidak dimintai layanan dan nama tidak ditebak.
import { ENTITY_TYPES, EVENT_TYPES, recordActivity } from "../lib/activityLog.js";

export const SETTING_KEYS = Object.freeze({
  WORKSHOP_LOCATION: "workshop_default_location_id",
  ADAPTATION_DEFAULT: "adaptation_default_policy",
});
export const ADAPTATION_POLICY = "ADAPTATION_V1";
// Versi kebijakan gerbang QC sebelum bongkar (Fase 2 LAYANAN). Dipin pada Run BARU; run yang sudah berjalan tidak pernah diubah otomatis.
export const QC_GATE_POLICY = "QC_GATE_V1";
// Fase 4: V2 = gerbang V1 (sebelum bongkar) + gerbang PERAKITAN (uji fondasi baru, hasil aktual, uji kasur jadi). Run BARU dipin V2; Run V1/NULL tidak pernah terkunci oleh gerbang perakitan
// (V1 hanya bila Fase 2/3 sudah rilis lebih dulu; NULL = Run lama). Menaikkan V1 -> V2 hanya lewat penerapan eksplisit tercatat.
export const QC_GATE_POLICY_V2 = "QC_GATE_V2";
export const QC_GATE_POLICIES = Object.freeze([QC_GATE_POLICY, QC_GATE_POLICY_V2]);
export const ARRIVAL_LOCATION_TYPES = Object.freeze(["RECEIVING_AREA", "WIP_AREA"]);

function settingsError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

async function readSetting(client, key) {
  const row = await client.productionSetting.findUnique({ where: { key } });
  return row ? row.value : null;
}

async function writeSetting(tx, { key, value, actorId, label, to }) {
  await tx.productionSetting.upsert({ where: { key }, create: { key, value, updatedById: actorId || null }, update: { value, updatedById: actorId || null } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.PRODUCTION_SETTING, entityId: key, eventType: EVENT_TYPES.PRODUCTION_SETTING_CHANGED, actorId: actorId || null,
    metadata: { key, label, to },
  });
}

// ---------------------------------------------------------------- lokasi workshop bawaan ----------------------------------------------------------------
/** Lokasi bawaan + keabsahannya (tidak melempar). */
export async function inspectWorkshopDefaultLocation(client) {
  const value = await readSetting(client, SETTING_KEYS.WORKSHOP_LOCATION);
  const locationId = value?.locationId ?? null;
  if (!locationId) return { configured: false, valid: false, location: null, problem: "NOT_CONFIGURED" };
  const location = await client.storageLocation.findUnique({ where: { id: locationId }, select: { id: true, code: true, zone: true, locationType: true, active: true } });
  if (!location) return { configured: true, valid: false, location: null, problem: "MISSING" };
  if (!location.active) return { configured: true, valid: false, location, problem: "INACTIVE" };
  if (!ARRIVAL_LOCATION_TYPES.includes(location.locationType)) return { configured: true, valid: false, location, problem: "WRONG_TYPE" };
  return { configured: true, valid: true, location, problem: null };
}

/** Untuk command kedatangan: lokasi valid atau 409 berkode (kebutuhan konfigurasi untuk Admin). */
export async function requireWorkshopDefaultLocation(client) {
  const state = await inspectWorkshopDefaultLocation(client);
  if (state.valid) return state.location;
  const code = state.problem === "NOT_CONFIGURED" ? "WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED" : "WORKSHOP_DEFAULT_LOCATION_INVALID";
  const why = state.problem === "NOT_CONFIGURED" ? "belum dikonfigurasi" : "tidak valid (nonaktif, hilang, atau bukan area Receiving/WIP)";
  throw settingsError(`Lokasi workshop bawaan ${why}. Admin perlu mengaturnya di Pengaturan Produksi › Alur Kerja sebelum kedatangan unit bisa dikonfirmasi.`, 409, code, { problem: state.problem, needs: "ADMIN_CONFIGURATION" });
}

export async function listArrivalLocationChoices(client) {
  return client.storageLocation.findMany({
    where: { active: true, locationType: { in: [...ARRIVAL_LOCATION_TYPES] } },
    select: { id: true, code: true, zone: true, locationType: true }, orderBy: [{ locationType: "asc" }, { code: "asc" }],
  });
}

export async function setWorkshopDefaultLocation(prisma, { locationId, actorId }) {
  if (!locationId) throw settingsError("locationId wajib diisi", 400, "SETTING_LOCATION_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const location = await tx.storageLocation.findUnique({ where: { id: locationId }, select: { id: true, code: true, zone: true, locationType: true, active: true } });
    if (!location || !location.active || !ARRIVAL_LOCATION_TYPES.includes(location.locationType)) {
      throw settingsError("Lokasi harus aktif dan berjenis Receiving atau WIP", 422, "SETTING_LOCATION_INVALID");
    }
    await writeSetting(tx, { key: SETTING_KEYS.WORKSHOP_LOCATION, value: { locationId }, actorId, label: "Lokasi workshop bawaan", to: location.code });
    return { locationId: location.id, code: location.code };
  });
}

// ---------------------------------------------------------------- kebijakan adaptasi bawaan ------------------------------------------------------------
export async function defaultAdaptationPolicy(client) {
  const value = await readSetting(client, SETTING_KEYS.ADAPTATION_DEFAULT);
  return value?.policy === ADAPTATION_POLICY ? ADAPTATION_POLICY : null;
}

export async function setAdaptationDefault(prisma, { enabled, actorId }) {
  if (typeof enabled !== "boolean") throw settingsError("enabled wajib berupa true/false", 400, "SETTING_ENABLED_REQUIRED");
  return prisma.$transaction(async (tx) => {
    await writeSetting(tx, { key: SETTING_KEYS.ADAPTATION_DEFAULT, value: { policy: enabled ? ADAPTATION_POLICY : null }, actorId, label: "Mode adaptasi untuk run baru", to: enabled ? "aktif" : "nonaktif" });
    return { enabled };
  });
}

export async function getProductionSettings(client) {
  const location = await inspectWorkshopDefaultLocation(client);
  return {
    workshopLocation: { configured: location.configured, valid: location.valid, problem: location.problem, location: location.location ? { id: location.location.id, code: location.location.code, zone: location.location.zone, locationType: location.location.locationType } : null },
    adaptationDefault: { enabled: (await defaultAdaptationPolicy(client)) === ADAPTATION_POLICY, policy: ADAPTATION_POLICY },
    locationChoices: await listArrivalLocationChoices(client),
  };
}

// ---------------------------------------------------------------- pemetaan layanan Sales -> produksi ---------------------------------------------------
export async function listServiceMappings(client) {
  const [items, services] = await Promise.all([
    client.priceItem.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, kind: true, productLine: true, productionServiceId: true, productionService: { select: { id: true, code: true, labelId: true } } } }),
    client.serviceCatalog.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { labelId: "asc" }], select: { id: true, code: true, labelId: true, serviceLine: true } }),
  ]);
  return {
    items: items.map((i) => ({ id: i.id, code: i.code, name: i.name, kind: i.kind, productLine: i.productLine, mapped: !!i.productionServiceId, service: i.productionService })),
    services,
  };
}

export async function setServiceMapping(prisma, { priceItemId, serviceId = null, actorId }) {
  if (!priceItemId) throw settingsError("priceItemId wajib diisi", 400, "MAPPING_ITEM_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const item = await tx.priceItem.findUnique({ where: { id: priceItemId }, select: { id: true, name: true, productionServiceId: true } });
    if (!item) throw settingsError("Layanan Sales tidak ditemukan", 404, "MAPPING_ITEM_NOT_FOUND");
    let service = null;
    if (serviceId) {
      service = await tx.serviceCatalog.findUnique({ where: { id: serviceId }, select: { id: true, labelId: true, active: true } });
      if (!service || !service.active) throw settingsError("Layanan produksi tidak ditemukan atau nonaktif", 422, "MAPPING_SERVICE_INVALID");
    }
    await tx.priceItem.update({ where: { id: priceItemId }, data: { productionServiceId: serviceId || null } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.PRODUCTION_SETTING, entityId: `mapping:${priceItemId}`, eventType: EVENT_TYPES.PRODUCTION_SETTING_CHANGED, actorId: actorId || null,
      metadata: { key: `mapping:${priceItemId}`, label: `Pemetaan layanan Sales "${item.name}"`, from: item.productionServiceId, to: service ? service.labelId : "(dihapus)" },
    });
    return { priceItemId, serviceId: serviceId || null };
  });
}

/**
 * Layanan produksi unit untuk Diagnosis TANPA meminta operator memilih. Urutan: pemetaan kanonis (item order -> price_items.production_service_id; tepat SATU layanan produksi
 * berbeda) > layanan yang SUDAH tercatat pada unit (data historis) > kebutuhan mapping (409). Nama layanan TIDAK PERNAH dicocokkan/ditebak.
 */
export async function resolveProductionServiceForUnit(client, unit) {
  const items = await client.orderItem.findMany({ where: { orderId: unit.orderId }, select: { layananName: true, priceItemId: true, priceItem: { select: { productionServiceId: true, name: true } } } });
  const mapped = [...new Set(items.map((i) => i.priceItem?.productionServiceId).filter(Boolean))];
  if (mapped.length === 1) return { serviceId: mapped[0], source: "MAPPING" };
  if (mapped.length > 1) {
    throw settingsError("Order ini memetakan lebih dari satu layanan produksi — Admin perlu memperjelas pemetaan layanan Sales di Pengaturan Produksi › Alur Kerja.", 409, "DIAGNOSIS_SERVICE_MAPPING_AMBIGUOUS", { needs: "ADMIN_CONFIGURATION" });
  }
  if (unit.serviceId) return { serviceId: unit.serviceId, source: "UNIT" };
  const unmapped = [...new Set(items.filter((i) => !i.priceItem?.productionServiceId).map((i) => i.layananName).filter(Boolean))];
  throw settingsError(
    `Layanan Sales${unmapped.length ? ` (${unmapped.join(", ")})` : ""} belum dipetakan ke layanan produksi. Admin perlu memetakannya di Pengaturan Produksi › Alur Kerja — Anda tidak perlu memilih layanan.`,
    409, "DIAGNOSIS_SERVICE_MAPPING_NEEDED", { needs: "ADMIN_CONFIGURATION", salesServices: unmapped },
  );
}
