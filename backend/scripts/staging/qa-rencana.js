#!/usr/bin/env node
// Seeder staging QA Rencana Produksi — ORDER NYATA (bukan demo/matriks): order Diproses seperti di production (order → unit → Job pickup selesai + foto bukti driver; satu order
// multi-unit; unit tanpa pickup; pengecualian). TANPA Run, TANPA operator profil, cohort V2 hanya SATU unit — persis keadaan production sebelum onboarding. Dijalankan DI DALAM container
// backend staging; hanya APP_ENV=staging|test dan DATABASE_URL bertanda staging/qa/test (assertQaPv2Safe); production ditolak sebelum query apa pun.
//   node scripts/staging/qa-rencana.js seed      master (akun, workshop, lokasi) + order nyata (idempoten, ensure-by-kode)
//   node scripts/staging/qa-rencana.js status    ringkasan
// Kredensial acak ditulis ke data/qa-rn-credentials.json (0600) — tidak dicetak.
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { assertQaPv2Safe } from "./qaPv2Safety.js";

const [cmd = "help"] = process.argv.slice(2);
if (cmd === "help") { console.log("perintah: seed | status"); process.exit(0); }
try { assertQaPv2Safe(); } catch (e) { console.error(e.message); process.exit(2); }
const { prisma } = await import("../../src/db.js");

const PREFIX = "QA-RN"; const EMAIL_PREFIX = "qa-rn-";
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.QA_PV2_DATA_DIR || path.resolve(here, "../../data");
const JOB_PHOTOS_DIR = path.join(dataDir, "job-photos");
const credsFile = path.join(dataDir, "qa-rn-credentials.json");
const log = (m) => console.log(`[qa-rencana] ${m}`);

// PNG polos 120x120 berwarna (foto pickup sintetis yang jelas terlihat & berbeda per unit) — encoder minimal (CRC + zlib).
function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n += 1) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function solidPng(r, g, b, size = 120) {
  const row = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x += 1) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const ACCOUNTS = [
  { key: "owner", name: `${PREFIX} Owner`, role: "OWNER" }, { key: "admin", name: `${PREFIX} Admin`, role: "ADMIN" }, { key: "lead", name: `${PREFIX} Kepala Produksi`, role: "PRODUCTION_LEAD" },
  { key: "worker1", name: `${PREFIX} Meja Andi`, role: "PRODUCTION_WORKER" }, { key: "worker2", name: `${PREFIX} Meja Budi`, role: "PRODUCTION_WORKER" }, { key: "worker3", name: `${PREFIX} Corner Citra`, role: "PRODUCTION_WORKER" },
  { key: "gudang", name: `${PREFIX} Gudang`, role: "WAREHOUSE" }, { key: "driver", name: `${PREFIX} Driver`, role: "DRIVER" },
];
const emailOf = (key) => `${EMAIL_PREFIX}${key}@staging.invalid`;

// Order nyata. kind: single|multi|nojob|nophoto + pengecualian. services meniru nama layanan Sales production.
const SERVICES = ["Paket Upgrade Fondasi + Lapisan MS", "Ganti Kain", "Rubah Texture Menjadi Empuk/Keras", "Full Service (Service + Tambah Busa + Ganti Kain)", "Service Fondasi + Tambah Busa", "Upgrade Fondasi Matras Sehat (150kg)"];
const COLORS = [[200, 90, 60], [60, 140, 200], [90, 170, 90], [200, 170, 50], [150, 90, 190], [60, 170, 160], [220, 120, 150], [120, 120, 120]];
const SPECS = [
  { key: "01", kind: "single", unitStatus: "RECEIVED" }, { key: "02", kind: "single", unitStatus: "IN_PRODUCTION", priority: "HIGH" }, { key: "03", kind: "single", unitStatus: "RECEIVED" },
  { key: "04", kind: "single", unitStatus: "RECEIVED" }, { key: "05", kind: "single", unitStatus: "IN_PRODUCTION" }, { key: "06", kind: "single", unitStatus: "RECEIVED" },
  { key: "07", kind: "multi", units: 3, unitStatus: "RECEIVED" }, { key: "08", kind: "nojob", unitStatus: "RECEIVED" }, { key: "09", kind: "nojob", unitStatus: "IN_PRODUCTION" },
  { key: "10", kind: "nophoto", unitStatus: "RECEIVED" },
  { key: "11", kind: "born", unitStatus: "RECEIVED", category: "BARU" }, { key: "12", kind: "born", unitStatus: "RECEIVED", category: "BARU" }, // kasur BARU dibuat di workshop: tanpa pickup (seperti 6 unit NEW-* di production)
  { key: "X1", kind: "v1progress", unitStatus: "IN_PRODUCTION" }, { key: "X2", kind: "ready", unitStatus: "READY_FOR_DELIVERY", orderStatus: "READY" }, { key: "X3", kind: "pickup", unitStatus: "AWAITING_PICKUP", orderStatus: "PICKUP" },
  { key: "X4", kind: "spam", unitStatus: "RECEIVED", stage: "SPAM" }, { key: "X5", kind: "staff", unitStatus: "RECEIVED", staff: true },
];

async function ensureMaster() {
  const creds = fs.existsSync(credsFile) ? JSON.parse(fs.readFileSync(credsFile, "utf8")) : {}; let changed = false; const users = {};
  for (const a of ACCOUNTS) {
    const email = emailOf(a.key); let u = await prisma.user.findUnique({ where: { email } });
    if (!u || !creds[email]) {
      const pw = crypto.randomBytes(12).toString("base64url"); creds[email] = pw; changed = true; const passwordHash = await bcrypt.hash(pw, 10);
      u = u ? await prisma.user.update({ where: { id: u.id }, data: { passwordHash, active: true, role: a.role, name: a.name } }) : await prisma.user.create({ data: { name: a.name, email, passwordHash, role: a.role } });
    }
    if (!(await prisma.userRole.findFirst({ where: { userId: u.id, role: a.role } }))) await prisma.userRole.create({ data: { userId: u.id, role: a.role } });
    users[a.key] = u;
  }
  if (changed) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(credsFile, JSON.stringify(creds, null, 2), { mode: 0o600 }); }
  const wc = (await prisma.workCenter.findUnique({ where: { code: `${PREFIX}-WC-1` } })) || (await prisma.workCenter.create({ data: { code: `${PREFIX}-WC-1`, name: "Workshop Utama (QA-RN)" } }));
  const wh = (await prisma.warehouse.findUnique({ where: { code: `${PREFIX}-WH` } })) || (await prisma.warehouse.create({ data: { code: `${PREFIX}-WH`, name: "Gudang QA-RN" } }));
  const loc = (await prisma.storageLocation.findUnique({ where: { code: `${PREFIX}-RCV` } })) || (await prisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `${PREFIX}-RCV` } }));
  return { users, wc, loc };
}

async function ensureOrder(M, spec, idx) {
  const orderNumber = `${PREFIX}-ORD-${spec.key}`;
  const existing = await prisma.order.findFirst({ where: { orderNumber }, include: { units: true } });
  if (existing) return existing;
  const customer = await prisma.customer.create({ data: { name: `Pelanggan RN ${spec.key}`, pipelineStage: spec.stage || "NEW", isInternalStaff: !!spec.staff } });
  const order = await prisma.order.create({ data: { customerId: customer.id, orderNumber, value: 1_500_000, category: spec.category || "LAYANAN", status: spec.orderStatus || "PROCESSING", beratBadan: 60 + idx } });
  await prisma.orderItem.create({ data: { orderId: order.id, layananName: SERVICES[idx % SERVICES.length], harga: 1_500_000, sortOrder: 0 } });
  const n = spec.units || 1; const units = [];
  for (let i = 0; i < n; i += 1) units.push(await prisma.unit.create({ data: { unitCode: `${PREFIX}-U${spec.key}${n > 1 ? `-${i + 1}` : ""}`, orderId: order.id, seq: i + 1, status: spec.unitStatus, merk: ["Serta", "King Koil", "Comforta", "Spring Air"][idx % 4], ukuran: ["160x200", "180x200", "120x200"][idx % 3], ...(spec.priority ? { priority: spec.priority } : {}) } }));
  if (spec.kind === "single" || spec.kind === "multi" || spec.kind === "nophoto") {
    const withPhoto = spec.kind !== "nophoto"; const file = `qa-rn-${spec.key}.png`;
    const job = await prisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", completedAt: new Date(Date.now() - (idx + 1) * 3600_000), driverId: M.users.driver.id, proofPhotoUrls: withPhoto ? [`/media/job-photos/${file}`] : [] } });
    for (const u of units) await prisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
    if (withPhoto) { fs.mkdirSync(JOB_PHOTOS_DIR, { recursive: true }); const [r, g, b] = COLORS[idx % COLORS.length]; fs.writeFileSync(path.join(JOB_PHOTOS_DIR, file), solidPng(r, g, b)); }
  }
  if (spec.kind === "v1progress") {
    const stage = await prisma.routingStage.findFirstOrThrow({ orderBy: { sequence: "asc" } }).catch(() => prisma.routingStage.findFirstOrThrow());
    await prisma.unitStageLog.create({ data: { unitId: units[0].id, stageId: stage.id, action: "START", actorId: M.users.lead.id, startedAt: new Date() } });
  }
  return { ...order, units };
}

async function seed() {
  const M = await ensureMaster(); let idx = 0;
  for (const spec of SPECS) { await ensureOrder(M, spec, idx); idx += 1; }
  // Keadaan production: cohort V2 = SATU unit (tanpa Run). Unit lain menunggu aktivasi Owner.
  const first = await prisma.unit.findFirstOrThrow({ where: { unitCode: `${PREFIX}-U01` } });
  for (const key of ["production_v2_writer", "production_v2_reader"]) {
    await prisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: true, scope: "GLOBAL", config: { unitIds: [first.id] }, reason: `${PREFIX} staging cohort awal (1 unit, meniru production)` }, update: {} });
  }
  log(`selesai: ${SPECS.length} order, kredensial di ${credsFile} (TIDAK dicetak); workshop ${M.wc.code}, lokasi ${M.loc.code}`);
}

async function status() {
  const units = await prisma.unit.count({ where: { unitCode: { startsWith: `${PREFIX}-` } } });
  const runs = await prisma.productionRun.count({ where: { unit: { unitCode: { startsWith: `${PREFIX}-` } } } });
  const ops = await prisma.productionOperator.count();
  console.log(JSON.stringify({ units, runs, operatorProfiles: ops }, null, 1));
}

try { if (cmd === "seed") await seed(); else if (cmd === "status") await status(); else { console.error("perintah tidak dikenal"); process.exitCode = 1; } }
catch (e) { console.error("[qa-rencana] GAGAL:", e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
