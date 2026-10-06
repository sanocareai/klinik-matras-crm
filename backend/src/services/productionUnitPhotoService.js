// P9B.1 — resolusi "foto identitas unit" untuk kartu Status Produksi/Rencana Produksi, dan command unggah manual.
//
// Prioritas resolusi (deterministik, TIDAK PERNAH menebak):
//   1. Foto pickup driver — HANDOFF INBOUND unit ini (status OFFERED **atau** ACCEPTED — foto harus tersedia
//      SEJAK unit masuk Status Produksi/"Dalam Perjalanan", bukan baru setelah Gudang accept; direction INBOUND
//      sendiri sudah memastikan sumbernya SELALU Job bertipe PICKUP, tidak pernah Job DELIVERY/pengiriman —
//      lihat armada.js projectJobCompleteV1: offerUnitCustody(direction:"INBOUND") hanya dipanggil untuk
//      job.type==="PICKUP"). Diambil handoff PALING BARU (orderBy offeredAt, bukan acceptedAt yang null untuk
//      baris OFFERED) — untuk kasus jarang unit di-offer ulang lewat Job berbeda (mis. setelah REJECTED),
//      supaya tidak mengembalikan handoff basi. Foto boleh diatribusikan HANYA bila Job itu punya TEPAT SATU
//      JobUnit (single-unit pickup) DAN Job itu punya proofPhotoUrls. Job/JobUnit tidak punya kolom foto
//      per-unit sama sekali (JobUnit murni tabel penghubung) — untuk job multi-unit tidak ada cara aman
//      mengaitkan satu entri proofPhotoUrls ke satu unit tertentu (termasuk sibling unit dalam order/job yang
//      sama), jadi unit-unit itu TIDAK PERNAH mendapat foto pickup (jatuh ke langkah 2/3), sekalipun Job-nya
//      punya foto.
//   1b. (Rencana Produksi order nyata) Foto pickup dari JOB PICKUP milik unit ini sendiri (JobUnit), walau unit belum punya handoff custody
//      V2 (unit di luar cohort/tanpa Run — fotonya tetap terlihat di Delivery, jadi kartu Rencana harus bisa menampilkannya). Aturan atribusi
//      SAMA persis dengan langkah 1: HANYA bila job itu punya TEPAT SATU JobUnit dan punya proofPhotoUrls; job multi-unit TIDAK PERNAH
//      diatribusikan (hasilnya "ambigu" — lihat diagnoseUnitPhotosBulk, dipakai kartu untuk MENJELASKAN, bukan menebak). Job TERBARU menang.
//   2. Unggahan manual Production (unit_photos, PRODUCTION_MANUAL) TERBARU yang belum di-supersede — hanya
//      relevan bila langkah 1 kosong. Bila langkah 1 KEMUDIAN tersedia (mis. custody yang tadinya belum ada
//      offer akhirnya di-offer), resolusi otomatis pindah ke DRIVER_PICKUP pada request berikutnya TANPA
//      menyentuh/menghapus baris manual (baris manual tetap ada, hanya tidak lagi disurfacekan) — tidak pernah
//      ambigu (satu fungsi murni, satu jawaban per panggilan) dan tidak pernah menduplikasi baris.
//   3. null — frontend menampilkan placeholder, TIDAK PERNAH menebak/memakai foto unit lain.
const LIVE_HANDOFF_STATUSES = Object.freeze(["OFFERED", "ACCEPTED"]);
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { UNIT_PHOTO_DIR } from "../lib/productionUnitPhotoStore.js";

const JOB_PHOTO_URL_PATTERN = /^\/media\/job-photos\/([A-Za-z0-9._-]+)$/;
const JOB_PHOTO_EXT_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif" };

function jobPhotoFilename(url) {
  const m = JOB_PHOTO_URL_PATTERN.exec(String(url || ""));
  if (!m) return null;
  const filename = m[1];
  // Regex di atas sudah menolak "/", tapi belum menolak ".." murni (dua titik, tanpa garis miring) — tolak
  // eksplisit supaya path.join tidak pernah bisa naik direktori sekalipun proofPhotoUrls berisi nilai aneh.
  if (filename.includes("..")) return null;
  return filename;
}

// Job PICKUP milik unit (via JobUnit) yang punya foto bukti — terbaru dulu. Dasar langkah 1b + diagnosis.
const PICKUP_PHOTO_JOB_SELECT = { id: true, proofPhotoUrls: true, completedAt: true, createdAt: true, units: { select: { id: true }, take: 2 } };
function attributablePickup(job) {
  if (!job || job.units.length !== 1 || job.proofPhotoUrls.length === 0) return null;
  const filename = jobPhotoFilename(job.proofPhotoUrls[0]);
  if (!filename) return null;
  const mimeType = JOB_PHOTO_EXT_MIME[filename.split(".").pop()?.toLowerCase()] || null;
  return mimeType ? { source: "DRIVER_PICKUP", jobPhotoFilename: filename, mimeType } : null;
}
const jobTime = (j) => (j.completedAt ?? j.createdAt).getTime();

// Resolusi kanonis (dipakai read-model kartu DAN endpoint sajikan foto) — mengembalikan deskriptor internal,
// TIDAK PERNAH sebuah path filesystem/URL mentah ke pemanggil di luar module ini.
export async function resolveUnitPhoto(prisma, unitId) {
  const handoff = await prisma.unitCustodyHandoff.findFirst({
    where: { unitId, direction: "INBOUND", status: { in: LIVE_HANDOFF_STATUSES } },
    orderBy: { offeredAt: "desc" },
    select: { deliveryJob: { select: { proofPhotoUrls: true, units: { select: { id: true }, take: 2 } } } },
  });
  const job = handoff?.deliveryJob;
  if (job && job.units.length === 1 && job.proofPhotoUrls.length > 0) {
    const filename = jobPhotoFilename(job.proofPhotoUrls[0]);
    if (filename) {
      const ext = filename.split(".").pop()?.toLowerCase();
      const mimeType = JOB_PHOTO_EXT_MIME[ext] || null;
      if (mimeType) return { source: "DRIVER_PICKUP", jobPhotoFilename: filename, mimeType };
    }
  }
  // 1b. Job PICKUP milik unit sendiri (tanpa handoff custody V2): job terbaru yang punya foto; hanya single-unit yang diatribusikan.
  const pickupJob = (await prisma.job.findMany({
    where: { type: "PICKUP", units: { some: { unitId } }, proofPhotoUrls: { isEmpty: false } },
    select: PICKUP_PHOTO_JOB_SELECT, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 1,
  }))[0];
  const fromJob = attributablePickup(pickupJob);
  if (fromJob) return fromJob;
  const manual = await prisma.unitPhoto.findFirst({
    where: { unitId, source: "PRODUCTION_MANUAL", supersededAt: null },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, mimeType: true },
  });
  if (manual) return { source: "PRODUCTION_MANUAL", storageKey: manual.storageKey, mimeType: manual.mimeType };
  return null;
}

// Job PICKUP berfoto TERBARU per unit (satu query untuk semua unit). `units` memuat SEMUA unit job (job pickup kecil) — dipakai untuk menentukan
// single-unit vs multi-unit (atribusi hanya bila tepat satu).
async function newestPickupPhotoJobByUnit(prisma, unitIds) {
  const jobs = await prisma.job.findMany({
    where: { type: "PICKUP", proofPhotoUrls: { isEmpty: false }, units: { some: { unitId: { in: unitIds } } } },
    select: { id: true, proofPhotoUrls: true, completedAt: true, createdAt: true, units: { select: { unitId: true } } },
  });
  const wanted = new Set(unitIds);
  const out = new Map();
  for (const job of jobs.sort((a, b) => jobTime(b) - jobTime(a))) {
    for (const { unitId } of job.units) if (wanted.has(unitId) && !out.has(unitId)) out.set(unitId, job);
  }
  return out;
}

// Diagnosis BACA-SAJA mengapa kartu tidak punya foto pickup — untuk MENJELASKAN ke pengguna (tidak pernah menebak atribusi):
//   AMBIGUOUS  = pickup berfoto ada, tetapi job itu memuat >1 unit (tidak bisa dipastikan foto milik unit yang mana)
//   NO_PHOTO   = ada job pickup untuk unit ini tetapi belum ada foto bukti (belum selesai/driver belum mengunggah)
//   NO_PICKUP  = unit ini tidak punya job pickup sama sekali (mis. diantar sendiri / dibuat di workshop)
export async function diagnoseUnitPhotosBulk(prisma, unitIds) {
  const ids = [...new Set(unitIds)].filter(Boolean);
  const out = new Map(ids.map((id) => [id, { status: "NO_PICKUP", jobUnitCount: null }]));
  if (ids.length === 0) return out;
  const withPhoto = await newestPickupPhotoJobByUnit(prisma, ids);
  for (const [unitId, job] of withPhoto) out.set(unitId, attributablePickup(job) ? { status: "OK", jobUnitCount: 1 } : { status: "AMBIGUOUS", jobUnitCount: job.units.length });
  const rest = ids.filter((id) => !withPhoto.has(id));
  if (rest.length) {
    const jobs = await prisma.job.findMany({ where: { type: "PICKUP", units: { some: { unitId: { in: rest } } } }, select: { units: { select: { unitId: true } } } });
    const restSet = new Set(rest);
    for (const job of jobs) for (const { unitId } of job.units) if (restSet.has(unitId)) out.set(unitId, { status: "NO_PHOTO", jobUnitCount: job.units.length });
  }
  return out;
}

// Versi BATCH dari resolveUnitPhoto() — dipakai read-model kartu (Status Produksi/Rencana Produksi, bisa
// puluhan unit sekaligus) supaya TIDAK query per unit (N+1). Dua query total, bukan 2×N.
export async function resolveUnitPhotosBulk(prisma, unitIds) {
  const ids = [...new Set(unitIds)].filter(Boolean);
  const result = new Map(ids.map((id) => [id, null]));
  if (ids.length === 0) return result;

  const [handoffs, manualRows] = await Promise.all([
    prisma.unitCustodyHandoff.findMany({
      where: { unitId: { in: ids }, direction: "INBOUND", status: { in: LIVE_HANDOFF_STATUSES } },
      orderBy: { offeredAt: "desc" },
      select: { unitId: true, deliveryJob: { select: { proofPhotoUrls: true, units: { select: { id: true }, take: 2 } } } },
    }),
    prisma.unitPhoto.findMany({
      where: { unitId: { in: ids }, source: "PRODUCTION_MANUAL", supersededAt: null },
      orderBy: { createdAt: "desc" },
      select: { unitId: true, storageKey: true, mimeType: true },
    }),
  ]);

  const manualByUnit = new Map();
  for (const row of manualRows) if (!manualByUnit.has(row.unitId)) manualByUnit.set(row.unitId, row); // sudah orderBy desc -> pertama = terbaru

  const pickupByUnit = new Map();
  for (const h of handoffs) {
    if (pickupByUnit.has(h.unitId)) continue; // sudah orderBy desc -> pertama = terbaru
    const job = h.deliveryJob;
    if (!job || job.units.length !== 1 || job.proofPhotoUrls.length === 0) continue;
    const filename = jobPhotoFilename(job.proofPhotoUrls[0]);
    if (!filename) continue;
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeType = JOB_PHOTO_EXT_MIME[ext] || null;
    if (mimeType) pickupByUnit.set(h.unitId, { source: "DRIVER_PICKUP", jobPhotoFilename: filename, mimeType });
  }

  // 1b. Job PICKUP milik unit sendiri (tanpa handoff custody V2) — hanya untuk unit yang belum dapat foto dari custody.
  const needJob = ids.filter((id) => !pickupByUnit.has(id));
  const jobByUnit = needJob.length ? await newestPickupPhotoJobByUnit(prisma, needJob) : new Map();
  for (const [unitId, job] of jobByUnit) { const d = attributablePickup(job); if (d) pickupByUnit.set(unitId, d); }

  for (const id of ids) {
    const pickup = pickupByUnit.get(id);
    if (pickup) { result.set(id, pickup); continue; }
    const manual = manualByUnit.get(id);
    if (manual) result.set(id, { source: "PRODUCTION_MANUAL", storageKey: manual.storageKey, mimeType: manual.mimeType });
  }
  return result;
}

// Unit boleh diberi tombol "Unggah Foto Manual" hanya bila resolusi kanonis kosong ATAU sumbernya sudah
// manual (revisi foto manual yang sama) — TIDAK PERNAH bila sumbernya DRIVER_PICKUP (pickup foto tidak
// boleh "ditimpa" oleh unggahan manual selama masih ada).
export async function canUploadManualPhoto(prisma, unitId) {
  const resolved = await resolveUnitPhoto(prisma, unitId);
  return !resolved || resolved.source === "PRODUCTION_MANUAL";
}

function sha1Buffer(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

// Sniff byte magic — pertahanan lapis kedua di atas Content-Type klien (yang bisa dipalsukan). Hanya tiga
// format yang didukung kartu unit (JPEG/PNG/WebP); video/HEIC/dll ditolak sekalipun ekstensinya dipalsukan.
export function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mimeType: "image/jpeg" };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { ext: "png", mimeType: "image/png" };
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mimeType: "image/webp" };
  return null;
}

export function unitPhotoError(message, status, code) {
  return Object.assign(new Error(message), { statusCode: status, code });
}

// Unggah manual — idempoten by content (nama berkas = sha1 isi; unggah ulang berkas identik untuk unit yang
// sama tidak menambah baris). Menggantikan (supersede) unggahan manual AKTIF sebelumnya untuk unit ini bila
// isinya berbeda — baris lama TIDAK dihapus (audit), hanya ditandai supersededAt.
export async function uploadManualUnitPhoto(prisma, { unitId, actorId, tmpFilePath, declaredMimeType }) {
  if (!(await canUploadManualPhoto(prisma, unitId))) {
    throw unitPhotoError("Unit ini sudah punya foto pickup dari driver — unggah manual tidak diperlukan", 409, "UNIT_PHOTO_PICKUP_EXISTS");
  }
  const buf = fs.readFileSync(tmpFilePath);
  const sniffed = sniffImageType(buf);
  if (!sniffed) throw unitPhotoError("Berkas bukan JPEG/PNG/WebP yang valid", 415, "UNIT_PHOTO_INVALID_TYPE");
  if (declaredMimeType && declaredMimeType !== sniffed.mimeType) {
    throw unitPhotoError("Tipe berkas yang diunggah tidak sesuai isinya", 415, "UNIT_PHOTO_TYPE_MISMATCH");
  }
  const digest = sha1Buffer(buf);
  const storageKey = `${digest}.${sniffed.ext}`;
  const abs = path.join(UNIT_PHOTO_DIR, storageKey);
  if (!fs.existsSync(abs)) fs.renameSync(tmpFilePath, abs);
  else fs.unlinkSync(tmpFilePath);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.unitPhoto.findFirst({ where: { unitId, source: "PRODUCTION_MANUAL", supersededAt: null } });
    if (existing) {
      if (existing.storageKey === storageKey) return existing; // replay/berkas identik — no-op idempoten
      await tx.unitPhoto.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
    }
    return tx.unitPhoto.create({
      data: { unitId, source: "PRODUCTION_MANUAL", storageKey, mimeType: sniffed.mimeType, sizeBytes: buf.length, uploadedById: actorId },
    });
  });
}
