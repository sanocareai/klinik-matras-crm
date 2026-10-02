// Target harian Produksi V2 yang tersimpan historis (P11.1). SATU-SATUNYA penulis production_daily_targets_v2, CREATE-ONLY (tabel append-only,
// trigger DB menolak UPDATE/DELETE): koreksi = baris baru dengan alasan. Berlaku mulai effective_from (tanggal kalender WIB). Laporan P11 membaca
// riwayat ini; hari tanpa target tercatat memakai konfigurasi sistem (BOARD_DEFAULTS.dailyTarget).
import { BOARD_DEFAULTS } from "../lib/domain/productionBoard.js";
import { addDays, buildTargetResolver, dateKeyOfDateColumn, isCalendarKey, wibKey } from "../lib/domain/productionMetrics.js";

export const MIN_EFFECTIVE_DATE = "2026-01-01";
export const MAX_TARGET_UNITS = 500;
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

const toRow = (r, names) => ({ id: r.id, effectiveFrom: dateKeyOfDateColumn(r.effectiveFrom), targetUnits: r.targetUnits, reason: r.reason, actorName: r.actorId ? names.get(r.actorId) || null : null, createdAt: r.createdAt.toISOString() });
const resolverOf = (rows) => buildTargetResolver(rows.map((r) => ({ effectiveFrom: dateKeyOfDateColumn(r.effectiveFrom), targetUnits: r.targetUnits, createdAt: r.createdAt })), BOARD_DEFAULTS.dailyTarget);

export async function listTargets(prisma, { now = new Date() } = {}) {
  const rows = await prisma.productionDailyTarget.findMany({ orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], take: 200 });
  const ids = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const resolver = resolverOf(rows);
  const today = wibKey(now);
  return { today, currentTarget: resolver.targetFor(today), currentSource: resolver.recorded(today) ? "tercatat" : "konfigurasi", fallback: BOARD_DEFAULTS.dailyTarget, minEffectiveDate: MIN_EFFECTIVE_DATE, maxTargetUnits: MAX_TARGET_UNITS, rows: rows.map((r) => toRow(r, names)) };
}

export async function setDailyTarget(prisma, { effectiveFrom, targetUnits, reason, actorId, now = new Date() }) {
  if (!isCalendarKey(effectiveFrom)) throw fail(400, "TARGET_DATE_INVALID", "Tanggal berlaku harus berformat YYYY-MM-DD (kalender WIB)");
  if (effectiveFrom < MIN_EFFECTIVE_DATE) throw fail(400, "TARGET_DATE_INVALID", `Tanggal berlaku paling awal ${MIN_EFFECTIVE_DATE}`);
  if (effectiveFrom > addDays(wibKey(now), 365)) throw fail(400, "TARGET_DATE_INVALID", "Tanggal berlaku maksimal 365 hari ke depan");
  const units = typeof targetUnits === "string" && /^\d+$/.test(targetUnits) ? Number(targetUnits) : targetUnits;
  if (!Number.isInteger(units) || units < 1 || units > MAX_TARGET_UNITS) throw fail(400, "TARGET_UNITS_INVALID", `Target harian harus bilangan bulat 1–${MAX_TARGET_UNITS} unit`);
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 5 || why.length > 300) throw fail(400, "TARGET_REASON_INVALID", "Alasan wajib diisi (5–300 karakter)");
  const resolver = resolverOf(await prisma.productionDailyTarget.findMany({ select: { effectiveFrom: true, targetUnits: true, createdAt: true } }));
  if (resolver.recorded(effectiveFrom) && resolver.targetFor(effectiveFrom) === units) throw fail(409, "TARGET_UNCHANGED", `Target pada ${effectiveFrom} sudah ${units} unit/hari`);
  const row = await prisma.productionDailyTarget.create({ data: { effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`), targetUnits: units, reason: why, actorId: actorId ? String(actorId) : null } });
  return toRow(row, new Map());
}
