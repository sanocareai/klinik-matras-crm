// KONFIRMASI MUAT UNIT per job (14 Okt 2026) — "Barang dimuat 3/3 unit".
//   • Satu baris job_unit_loads per (job, unit) → klik ulang/replay tidak menggandakan (createMany skipDuplicates).
//   • Hanya unit yang TERTAUT ke job (job_units) dan belum CANCELLED yang bisa dikonfirmasi; unit lain ditolak.
//   • Penyelesaian pengiriman oleh driver memeriksa kelengkapan (bila DELIVERY_UNIT_CONFIRM_REQUIRED=1) atau memakai PENGECUALIAN resmi (alasan ≥5 + audit).
//   • Tidak mengubah status unit/job; hanya mencatat fakta muat.
const STATUS_BOLEH = ["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UnitLoadError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.name = "UnitLoadError"; this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}

export const wajibKonfirmasiUnit = () => String(process.env.DELIVERY_UNIT_CONFIRM_REQUIRED ?? "") === "1";

async function unitJob(db, jobId) {
  const rows = await db.jobUnit.findMany({ where: { jobId, unit: { status: { not: "CANCELLED" } } }, select: { unitId: true, unit: { select: { unitCode: true, seq: true } } }, orderBy: { unit: { seq: "asc" } } });
  return rows.map((r) => ({ unitId: r.unitId, kode: r.unit.unitCode, label: /-U(\d+)$/i.exec(r.unit.unitCode || "") ? `U${/-U(\d+)$/i.exec(r.unit.unitCode)[1]}` : `U${r.unit.seq}` }));
}

/** Progres muat job: { total, dimuat, belum:[{unitId,kode,label}], lengkap, label }. */
export async function progresMuat(db, jobId) {
  const unit = await unitJob(db, jobId);
  const sudah = new Set((await db.jobUnitLoad.findMany({ where: { jobId }, select: { unitId: true } })).map((l) => l.unitId));
  const belum = unit.filter((u) => !sudah.has(u.unitId));
  const dimuat = unit.length - belum.length;
  return { total: unit.length, dimuat, belum, lengkap: unit.length > 0 && belum.length === 0, label: `Barang dimuat ${dimuat}/${unit.length} unit` };
}

/** Konfirmasi muat. `unitIds` kosong/`semua` = semua unit job. Idempoten. */
export async function konfirmasiMuat(db, { jobId, unitIds = null, semua = false, userId = null }) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, status: true, type: true } });
  if (!job) throw new UnitLoadError("Job tidak ditemukan", 404);
  if (!STATUS_BOLEH.includes(job.status)) throw new UnitLoadError(`Job berstatus ${job.status} — konfirmasi muat tidak diterima`, 409, "STATUS_JOB_TIDAK_VALID");
  const unit = await unitJob(db, jobId);
  const sah = new Set(unit.map((u) => u.unitId));
  let target;
  if (semua || !unitIds || unitIds.length === 0) target = [...sah];
  else {
    if (!Array.isArray(unitIds) || unitIds.some((u) => !UUID.test(String(u)))) throw new UnitLoadError("Daftar unit tidak valid", 400, "UNIT_TIDAK_VALID");
    const asing = unitIds.filter((u) => !sah.has(u));
    if (asing.length) throw new UnitLoadError("Ada unit yang bukan bagian dari job ini", 400, "UNIT_BUKAN_BAGIAN_JOB", { unitAsing: asing });
    target = [...new Set(unitIds)];
  }
  if (target.length === 0) throw new UnitLoadError("Job ini belum punya unit tertaut", 409, "TANPA_UNIT");
  await db.jobUnitLoad.createMany({ data: target.map((unitId) => ({ jobId, unitId, confirmedById: userId })), skipDuplicates: true });
  return progresMuat(db, jobId);
}

/**
 * Gerbang penyelesaian pengiriman. Mengembalikan { perlu:false } bila lolos; melempar 409 UNIT_BELUM_DIKONFIRMASI bila ada unit belum dimuat dan tidak ada pengecualian sah.
 * `pengecualian` = { alasan } (≥5 karakter). Pengecualian dikembalikan sebagai { perlu:true, pengecualian:{alasan, belum[]} } untuk dicatat pemanggil sebagai audit.
 */
export async function periksaGerbangSelesai(db, { job, pengecualian = null, istimewa = false }) {
  if (job.type !== "DELIVERY" || istimewa || !wajibKonfirmasiUnit()) return { perlu: false };
  const p = await progresMuat(db, job.id);
  if (p.total === 0 || p.lengkap) return { perlu: false, progres: p };
  const alasan = String(pengecualian?.alasan ?? "").trim().replace(/\s+/g, " ");
  if (alasan.length >= 5) return { perlu: true, progres: p, pengecualian: { alasan: alasan.slice(0, 500), belum: p.belum.map((u) => u.label) } };
  throw new UnitLoadError(
    `${p.label}: konfirmasi semua unit dimuat dulu, atau selesaikan lewat pengecualian resmi (alasan wajib dan diaudit). Belum dikonfirmasi: ${p.belum.map((u) => u.label).join(", ")}.`,
    409, "UNIT_BELUM_DIKONFIRMASI", { muat: { dimuat: p.dimuat, total: p.total, belum: p.belum.map((u) => u.label) } },
  );
}
