#!/usr/bin/env node
// Rehearsal UPGRADE migration P6 (Production Workshop + Warehouse V2). Read-only terhadap semua database selain yang dibuatnya sendiri.
//  1. Membuat database unik km_it_<waktu>_<pid>_test (pola aman) — TIDAK menyentuh database lain.
//  2. Menerapkan SEMUA migration KECUALI P6 (salinan folder prisma sementara) = keadaan production sebelum rilis.
//  3. Menanam baris berbentuk lama (custody INBOUND dengan Job, planned BOM, material issue V1) lewat SQL mentah.
//  4. Menerapkan P6 lewat `prisma migrate deploy` (persis jalur rilis), lalu memverifikasi: baris lama utuh, kolom baru NULL, CHECK/trigger/index
//     aktif, dan bentuk tulis KODE LAMA (tanpa kolom baru) tetap valid (rollback aplikasi aman).
//   node scripts/production-delivery-v2/p6-upgrade-rehearsal.js
import { TEST_DATABASE_URL } from "../../tests/integration/setup/env.js"; // pagar keamanan: hanya database tes lokal
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const P6_MIGRATION = "20261003080000_production_qc_finished_goods_v2";
const SAFE = /^km_it_[a-z0-9]+_\d+_test$/;
const dbName = `km_it_${Date.now().toString(36)}_${process.pid}_test`;
if (!SAFE.test(dbName)) throw new Error(`Nama database tidak aman: ${dbName}`);

const base = new URL(TEST_DATABASE_URL);
const dbUrl = new URL(base); dbUrl.pathname = `/${dbName}`;
const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
const ident = (n) => `"${n.replace(/"/g, '""')}"`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "OK  " : "GAGAL"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) process.exitCode = 1; };

function deploy(schemaPath) {
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schemaPath], { cwd: backendRoot, env: { ...process.env, DATABASE_URL: dbUrl.toString() }, stdio: "pipe", shell: true });
}

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  await admin.$executeRawUnsafe(`CREATE DATABASE ${ident(dbName)}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p6-rehearsal-"));
  const db = new PrismaClient({ datasources: { db: { url: dbUrl.toString() } } });
  try {
    // 2. keadaan sebelum rilis: semua migration kecuali P6.
    const tmpPrisma = path.join(tmp, "prisma");
    fs.mkdirSync(path.join(tmpPrisma, "migrations"), { recursive: true });
    fs.copyFileSync(path.join(backendRoot, "prisma", "schema.prisma"), path.join(tmpPrisma, "schema.prisma"));
    const migrations = fs.readdirSync(path.join(backendRoot, "prisma", "migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const name of migrations.filter((n) => n !== P6_MIGRATION)) fs.cpSync(path.join(backendRoot, "prisma", "migrations", name), path.join(tmpPrisma, "migrations", name), { recursive: true });
    fs.copyFileSync(path.join(backendRoot, "prisma", "migrations", "migration_lock.toml"), path.join(tmpPrisma, "migrations", "migration_lock.toml"));
    deploy(path.join(tmpPrisma, "schema.prisma"));
    const pendingBefore = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM _prisma_migrations WHERE migration_name = ${P6_MIGRATION}`;
    check("keadaan sebelum rilis: P6 belum diterapkan", pendingBefore[0].n === 0);

    // 3. data berbentuk lama.
    const cols = async (table) => (await db.$queryRawUnsafe(`SELECT column_name, is_nullable, column_default, data_type FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`));
    const required = async (table) => (await cols(table)).filter((c) => c.is_nullable === "NO" && c.column_default === null).map((c) => c.column_name);
    console.log("[rehearsal] kolom wajib: Customer =", await required("Customer"), "| Order =", await required("Order"), "| units =", await required("units"), "| jobs =", await required("jobs"), "| material_issues =", await required("material_issues"));
    const exec = async (text) => { for (const statement of text.split(/;\s*\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean)) await db.$executeRawUnsafe(statement); };
    await exec(`
      INSERT INTO "Customer" (id, name, "updatedAt") VALUES ('cust-reh-1', 'Pelanggan Rehearsal', now());
      INSERT INTO "Order" (id, "customerId", "orderNumber", value, category, "updatedAt") VALUES ('order-reh-1', 'cust-reh-1', 'REH-1', 1000, 'LAYANAN', now());
      INSERT INTO units (id, unit_code, order_id, seq, status, updated_at) VALUES ('00000000-0000-0000-0000-0000000000b1', 'UNIT-REH-1', 'order-reh-1', 1, 'RECEIVED', now());
      INSERT INTO jobs (id, type, order_id, status, sequence, scheduled_date, updated_at) VALUES ('00000000-0000-0000-0000-0000000000d1', 'PICKUP', 'order-reh-1', 'COMPLETED', 1, now(), now());
      INSERT INTO unit_custody_handoffs_v2 (id, unit_id, delivery_job_id, direction, status, updated_at) VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'INBOUND', 'ACCEPTED', now());
      INSERT INTO material_issues (id, issue_number, source_type, status, updated_at) VALUES ('00000000-0000-0000-0000-0000000000f1', 'MI-REH-01', 'PRODUCTION_WORK_ORDER', 'ISSUED', now());
    `);
    const before = {
      custody: await db.$queryRaw`SELECT id, direction::text AS direction, status::text AS status, delivery_job_id FROM unit_custody_handoffs_v2`,
      issues: await db.$queryRaw`SELECT id, issue_number, status::text AS status, revision FROM material_issues`,
    };
    check("baris lama tertanam (custody INBOUND + material issue V1)", before.custody.length === 1 && before.issues.length === 1);

    // 4. rilis: terapkan P6 lewat migrate deploy.
    fs.cpSync(path.join(backendRoot, "prisma", "migrations", P6_MIGRATION), path.join(tmpPrisma, "migrations", P6_MIGRATION), { recursive: true });
    deploy(path.join(tmpPrisma, "schema.prisma"));
    const applied = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM _prisma_migrations WHERE migration_name = ${P6_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    check("P6 diterapkan bersih (migrate deploy, finished_at terisi)", applied[0].n === 1);

    const after = {
      custody: await db.$queryRaw`SELECT id, direction::text AS direction, status::text AS status, delivery_job_id FROM unit_custody_handoffs_v2`,
      issues: await db.$queryRaw`SELECT id, issue_number, status::text AS status, revision FROM material_issues`,
    };
    check("baris lama utuh setelah upgrade", JSON.stringify(before) === JSON.stringify(after));
    const issueNew = await db.$queryRaw`SELECT rework_inspection_id FROM material_issues`;
    check("kolom baru pada baris lama = NULL (perilaku V1 tidak berubah)", issueNew.length === 1 && issueNew[0].rework_inspection_id === null);

    const rejects = async (sql) => { try { await db.$executeRawUnsafe(sql); return false; } catch { return true; } };
    check("CHECK: INBOUND tanpa Job ditolak", await rejects(`INSERT INTO unit_custody_handoffs_v2 (id, unit_id, delivery_job_id, direction, status, updated_at) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', NULL, 'INBOUND', 'CANCELLED', now())`));
    check("CHECK: FINISHED_GOODS dengan Job ditolak", await rejects(`INSERT INTO unit_custody_handoffs_v2 (id, unit_id, delivery_job_id, direction, status, updated_at) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', 'FINISHED_GOODS', 'CANCELLED', now())`));
    check("FINISHED_GOODS tanpa Job diterima", !(await rejects(`INSERT INTO unit_custody_handoffs_v2 (id, unit_id, delivery_job_id, direction, status, updated_at) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', NULL, 'FINISHED_GOODS', 'CANCELLED', now())`)));
    // bentuk tulis KODE LAMA (tanpa kolom baru): INBOUND dengan Job pada unit/job lain tetap valid -> rollback aplikasi aman.
    await db.$executeRawUnsafe(`INSERT INTO jobs (id, type, order_id, status, sequence, scheduled_date, updated_at) VALUES ('00000000-0000-0000-0000-0000000000d2', 'PICKUP', 'order-reh-1', 'COMPLETED', 2, now(), now())`);
    check("kode lama (tanpa kolom baru) masih dapat menulis custody INBOUND", !(await rejects(`INSERT INTO unit_custody_handoffs_v2 (id, unit_id, delivery_job_id, direction, status, updated_at) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d2', 'INBOUND', 'CANCELLED', now())`)));
    check("kode lama masih dapat menulis material issue V1 tanpa kolom baru", !(await rejects(`INSERT INTO material_issues (id, issue_number, source_type, status, updated_at) VALUES (gen_random_uuid(), 'MI-REH-02', 'PRODUCTION_WORK_ORDER', 'DRAFT', now())`)));

    const triggers = await db.$queryRaw`SELECT tgname FROM pg_trigger WHERE tgname IN ('quality_inspections_v2_immutable', 'quality_inspection_items_v2_immutable')`;
    check("trigger immutability inspeksi terpasang", triggers.length === 2);
    const idx = await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname IN ('planned_bom_lines_v2_active_material_key', 'production_run_exceptions_v2_open_run_key', 'material_issues_active_rework_key')`;
    check("index unik (BOM aktif dibuat ulang, exception OPEN, rework aktif) ada", idx.length === 3);
    const direction = await db.$queryRaw`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'UnitCustodyDirection' ORDER BY e.enumsortorder`;
    check("enum UnitCustodyDirection = INBOUND, RETURN, FINISHED_GOODS", JSON.stringify(direction.map((r) => r.enumlabel)) === JSON.stringify(["INBOUND", "RETURN", "FINISHED_GOODS"]));
  } finally {
    await db.$disconnect();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (SAFE.test(dbName)) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`);
    await admin.$disconnect();
    console.log(`[rehearsal] database ${dbName} dihapus.`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nHasil rehearsal upgrade P6: ${results.length - failed}/${results.length} lolos`);
}

main().catch((error) => { console.error("Rehearsal gagal:", error.stderr?.toString() || error.message); process.exitCode = 1; });
